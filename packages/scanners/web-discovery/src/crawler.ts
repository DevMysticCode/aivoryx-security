import type { AssessmentScope, AssetType } from '@aivoryx/shared-types';
import {
  buildHttpObservation,
  runPassiveChecks,
  checkUrlAgainstScope,
  ScopeViolationError,
  SsrfViolationError,
  type SafeHttpClient,
  type SafeHttpResponse,
  type ScannerLogger,
  type ReportFindingInput,
  type ReportDiscoveredUrlInput,
} from '@aivoryx/scanner-core';
import { WEB_PASSIVE_CHECKS } from '@aivoryx/scanner-web-passive';
import { normalizeUrl, redactSensitiveQueryParams } from './url-normalize.js';
import { extractFromHtml } from './html-extract.js';
import { parseRobots } from './robots.js';
import { parseSitemap } from './sitemap.js';
import { RequestScheduler } from './rate-limiter.js';
import {
  DEFAULT_CRAWL_LIMITS,
  type CrawlLimits,
  type DiscoveryEvent,
  type DiscoveryEventType,
  type QueueItem,
  type WebDiscoveryResult,
} from './types.js';

export interface WebDiscoveryContext {
  httpClient: SafeHttpClient;
  scope: AssessmentScope;
  assetType: AssetType;
  logger: ScannerLogger;
  reportFinding: (input: ReportFindingInput) => Promise<void>;
  reportDiscoveredUrl: (input: ReportDiscoveredUrlInput) => Promise<void>;
}

/**
 * Scope-aware BFS web crawler (Part 13). Reuses the caller-provided
 * SafeHttpClient for every request — this module never opens a socket
 * itself. For the seed URL specifically, reproduces the Batch 4/5
 * reachability + passive-analysis finding so worker-level behavior is
 * unchanged; every subsequently discovered HTML page also gets passive
 * analysis, reusing the SAME fetch response (never a second request for the
 * same URL). See Part 18.
 */
export async function runWebDiscovery(
  seedUrl: string,
  ctx: WebDiscoveryContext,
  limitsOverride: Partial<CrawlLimits> = {},
): Promise<WebDiscoveryResult> {
  const limits: CrawlLimits = { ...DEFAULT_CRAWL_LIMITS, ...limitsOverride };
  const events: DiscoveryEvent[] = [];
  const limitsHit = new Set<string>();
  const visited = new Set<string>();
  const queue: QueueItem[] = [];
  let requestCount = 0;
  let urlsRecorded = 0;

  function recordEvent(type: DiscoveryEventType, url?: string, detail?: string): void {
    events.push({ type, url, detail });
  }

  function isInScope(url: string): boolean {
    try {
      return checkUrlAgainstScope(new URL(url), ctx.scope).allowed;
    } catch {
      return false;
    }
  }

  function tryNormalize(raw: string, base: string): string | null {
    try {
      return normalizeUrl(raw, base);
    } catch {
      return null;
    }
  }

  /** Enforces depth/dedup/scope/maxUrls before an item ever reaches the queue — out-of-scope URLs are never scheduled, let alone requested. */
  function enqueue(item: QueueItem): void {
    if (item.depth > limits.maxDepth) {
      limitsHit.add('maxDepth');
      recordEvent('URL_SKIPPED_LIMIT', item.url, 'maxDepth');
      return;
    }
    if (visited.has(item.url)) {
      recordEvent('URL_SKIPPED_DUPLICATE', item.url);
      return;
    }
    if (!isInScope(item.url)) {
      recordEvent('URL_SKIPPED_OUT_OF_SCOPE', item.url);
      return;
    }
    if (urlsRecorded + queue.length >= limits.maxUrls) {
      limitsHit.add('maxUrls');
      recordEvent('URL_SKIPPED_LIMIT', item.url, 'maxUrls');
      return;
    }
    visited.add(item.url);
    queue.push(item);
  }

  /** Persists one discovered URL (bounded by maxUrls) and records an event. */
  async function report(
    item: QueueItem,
    extra: Partial<ReportDiscoveredUrlInput> = {},
  ): Promise<void> {
    if (urlsRecorded >= limits.maxUrls) {
      limitsHit.add('maxUrls');
      recordEvent('URL_SKIPPED_LIMIT', item.url, 'maxUrls');
      return;
    }
    urlsRecorded += 1;
    await ctx.reportDiscoveredUrl({
      url: redactSensitiveQueryParams(item.url),
      sourceUrl: item.sourceUrl,
      type: item.type,
      discoveryMethod: item.discoveryMethod,
      depth: item.depth,
      ...extra,
    });
  }

  async function reportReachableFinding(target: string, response: SafeHttpResponse): Promise<void> {
    await ctx.reportFinding({
      title: `Target reachable (HTTP ${response.status})`,
      description:
        `A GET request to the authorized target returned HTTP ${response.status} after ` +
        `${response.redirectCount} redirect(s) in ${response.durationMs}ms. This is an ` +
        `informational reachability observation, not a vulnerability.`,
      severity: 'INFO',
      confidence: 'CONFIRMED',
      category: 'reachability',
      key: 'reachable',
      target,
      evidence: {
        requestedUrl: response.requestedUrl,
        finalUrl: response.finalUrl,
        status: response.status,
        httpVersion: response.httpVersion,
        redirectCount: response.redirectCount,
        durationMs: response.durationMs,
        bodyBytesRead: response.bodyBytesRead,
        bodyTruncated: response.bodyTruncated,
      },
    });
  }

  async function reportUnreachableFinding(target: string, error: unknown): Promise<void> {
    await ctx.reportFinding({
      title: 'Target unreachable',
      description:
        'A GET request to the authorized target could not be completed. This is an ' +
        'informational observation — it does not by itself indicate a vulnerability.',
      severity: 'INFO',
      confidence: 'CONFIRMED',
      category: 'reachability',
      key: 'unreachable',
      target,
      evidence: {
        requestedUrl: target,
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }

  async function processPage(item: QueueItem, response: SafeHttpResponse): Promise<void> {
    await report(item, {
      statusCode: response.status,
      contentType: response.headers['content-type'] ?? null,
      responseBytes: response.bodyBytesRead,
    });

    if (item.discoveryMethod === 'SEED') {
      await reportReachableFinding(item.url, response);
    }

    const contentType = response.headers['content-type'] ?? '';
    if (!contentType.toLowerCase().includes('html')) return;

    const observation = buildHttpObservation(response);
    const passiveFindings = runPassiveChecks(WEB_PASSIVE_CHECKS, observation, {
      target: item.url,
      assetType: ctx.assetType,
    });
    for (const finding of passiveFindings) {
      await ctx.reportFinding(finding);
    }

    const extraction = extractFromHtml(response.body, limits.maxLinksPerPage);

    for (const rawLink of extraction.navigational) {
      const normalized = tryNormalize(rawLink, item.url);
      if (!normalized) continue;
      enqueue({
        url: normalized,
        type: 'PAGE',
        discoveryMethod: 'HTML_LINK',
        depth: item.depth + 1,
        sourceUrl: item.url,
      });
    }

    // Resources are recorded, never crawled recursively (Part 5) — no
    // request is made for them at all, keeping the request budget focused
    // on navigable pages (the actual attack surface).
    for (const rawResource of extraction.resources) {
      const normalized = tryNormalize(rawResource, item.url);
      if (!normalized || !isInScope(normalized) || visited.has(normalized)) continue;
      visited.add(normalized);
      await report({
        url: normalized,
        type: 'RESOURCE',
        discoveryMethod: 'HTML_RESOURCE',
        depth: item.depth + 1,
        sourceUrl: item.url,
      });
    }

    for (const form of extraction.forms) {
      const actionUrl = tryNormalize(form.actionUrl, item.url);
      if (!actionUrl || !isInScope(actionUrl)) continue;
      recordEvent('FORM_DISCOVERED', actionUrl);
      await report(
        {
          url: actionUrl,
          type: 'FORM_ACTION',
          discoveryMethod: 'FORM',
          depth: item.depth,
          sourceUrl: item.url,
        },
        {
          metadata: {
            method: form.method,
            inputs: form.inputs.slice(0, 50),
            textareas: form.textareas.slice(0, 50),
            selects: form.selects.slice(0, 50),
          },
        },
      );
    }
  }

  async function processRobots(item: QueueItem, response: SafeHttpResponse): Promise<void> {
    await report(item, {
      statusCode: response.status,
      contentType: response.headers['content-type'] ?? null,
      responseBytes: response.bodyBytesRead,
    });
    recordEvent('ROBOTS_FETCHED', item.url);
    if (response.status < 200 || response.status >= 300 || !limits.sitemapEnabled) return;

    const parsed = parseRobots(response.body);
    for (const rawSitemapUrl of parsed.sitemapUrls) {
      const normalized = tryNormalize(rawSitemapUrl, item.url);
      // robots.txt is NOT a security boundary — a sitemap directive is
      // scope-checked exactly like any other discovered URL, never trusted
      // just because robots.txt named it. See Part 8.
      if (!normalized) continue;
      enqueue({
        url: normalized,
        type: 'SITEMAP',
        discoveryMethod: 'ROBOTS',
        depth: item.depth,
        sourceUrl: item.url,
      });
    }
  }

  async function processSitemap(item: QueueItem, response: SafeHttpResponse): Promise<void> {
    await report(item, {
      statusCode: response.status,
      contentType: response.headers['content-type'] ?? null,
      responseBytes: response.bodyBytesRead,
    });
    recordEvent('SITEMAP_FETCHED', item.url);
    if (response.status < 200 || response.status >= 300) return;

    const locs = parseSitemap(response.body, limits.maxSitemapUrls);
    for (const rawLoc of locs) {
      const normalized = tryNormalize(rawLoc, item.url);
      if (!normalized) continue;
      enqueue({
        url: normalized,
        type: 'PAGE',
        discoveryMethod: 'SITEMAP',
        depth: Math.max(item.depth, 1),
        sourceUrl: item.url,
      });
    }
  }

  async function processItem(item: QueueItem): Promise<void> {
    recordEvent('URL_FETCHED', item.url);

    let response: SafeHttpResponse;
    try {
      response = await ctx.httpClient.request(item.url, ctx.scope, { method: 'GET' });
    } catch (error) {
      if (item.discoveryMethod === 'SEED') {
        if (error instanceof ScopeViolationError || error instanceof SsrfViolationError) {
          // Security-relevant: propagate so the worker classifies this as a
          // permanent failure, exactly like Batch 4's reachability scanner.
          throw error;
        }
        // Ordinary connectivity failure on the seed — informational, not a failure.
        await reportUnreachableFinding(item.url, error);
        return;
      }
      if (error instanceof ScopeViolationError || error instanceof SsrfViolationError) {
        recordEvent(
          'REDIRECT_OUT_OF_SCOPE',
          item.url,
          error instanceof Error ? error.message : undefined,
        );
        return;
      }
      // A single unreachable non-seed URL never aborts the rest of the crawl.
      recordEvent('URL_SKIPPED_LIMIT', item.url, 'fetch-failed');
      return;
    }

    // SafeHttpClient already followed any redirect chain internally (with
    // its own scope/SSRF validation on every hop — Part 14). Record the
    // final destination as its own discovery when it differs from what was
    // linked, so the persisted attack surface reflects what was actually
    // reached, not just what was pointed to.
    if (response.finalUrl !== item.url && !visited.has(response.finalUrl)) {
      visited.add(response.finalUrl);
      await report({
        url: response.finalUrl,
        type: item.type === 'ROBOTS' || item.type === 'SITEMAP' ? item.type : 'PAGE',
        discoveryMethod: 'REDIRECT',
        depth: item.depth,
        sourceUrl: item.url,
      });
    }

    if (item.type === 'ROBOTS') {
      await processRobots(item, response);
    } else if (item.type === 'SITEMAP') {
      await processSitemap(item, response);
    } else {
      await processPage(item, response);
    }
  }

  // The seed is queued directly — NOT via enqueue() — because enqueue()
  // silently skips an out-of-scope URL (correct for links discovered mid-
  // crawl, which are just candidates). The seed is the explicit assessment
  // target: if it's out of scope, that must surface as a loud, thrown
  // ScopeViolationError from the actual fetch attempt below (processItem),
  // exactly like Batch 4/5's reachability scanner — never a silent
  // zero-request "success".
  const normalizedSeed = normalizeUrl(seedUrl);
  visited.add(normalizedSeed);
  queue.push({
    url: normalizedSeed,
    type: 'PAGE',
    discoveryMethod: 'SEED',
    depth: 0,
    sourceUrl: null,
  });

  if (limits.robotsEnabled) {
    const robotsUrl = tryNormalize('/robots.txt', normalizedSeed);
    if (robotsUrl) {
      enqueue({
        url: robotsUrl,
        type: 'ROBOTS',
        discoveryMethod: 'ROBOTS',
        depth: 0,
        sourceUrl: normalizedSeed,
      });
    }
  }
  if (limits.sitemapEnabled) {
    const sitemapUrl = tryNormalize('/sitemap.xml', normalizedSeed);
    if (sitemapUrl) {
      enqueue({
        url: sitemapUrl,
        type: 'SITEMAP',
        discoveryMethod: 'SITEMAP',
        depth: 0,
        sourceUrl: normalizedSeed,
      });
    }
  }

  const scheduler = new RequestScheduler(limits.maxConcurrentRequests, limits.requestsPerSecond);
  // A running task's own processPage()/processRobots()/processSitemap() can
  // enqueue MORE items — the drain loop below keeps dispatching newly
  // queued items as long as anything is still in flight, rather than only
  // considering the queue's contents at the moment it started (which would
  // silently stop after the seed and never crawl any of the URLs it found).
  const inFlight = new Set<Promise<void>>();

  for (;;) {
    while (queue.length > 0 && requestCount < limits.maxTotalRequests) {
      const item = queue.shift();
      if (!item) break;
      requestCount += 1;
      const release = await scheduler.acquire();
      const task: Promise<void> = processItem(item).finally(() => {
        release();
        inFlight.delete(task);
      });
      inFlight.add(task);
    }
    if (queue.length > 0 && requestCount >= limits.maxTotalRequests) {
      limitsHit.add('maxTotalRequests');
    }
    if (inFlight.size === 0) break;
    // Waits for at least one task to settle, then loops back to pick up
    // whatever it discovered. A rejection here (only ever the SEED's own
    // Scope/SSRF violation — see processItem) propagates out of this
    // function immediately, exactly like Batch 4/5's reachability scanner.
    await Promise.race(inFlight);
  }

  return { requestCount, events, limitsHit: Array.from(limitsHit) };
}
