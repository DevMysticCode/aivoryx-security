import {
  ScopeViolationError,
  SsrfViolationError,
  buildHttpObservation,
  runPassiveChecks,
} from '@aivoryx/scanner-core';
import type { ScannerContext, ScannerPlugin } from '@aivoryx/scanner-core';
import type { WebAssetConfig } from '@aivoryx/shared-types';
import { WEB_PASSIVE_CHECKS } from '@aivoryx/scanner-web-passive';

const SCANNER_NAME = 'http-reachability';

// Headers safe to persist as evidence — never Set-Cookie, Authorization,
// WWW-Authenticate, or anything else that could carry a credential/session.
// See Part N.
const SAFE_EVIDENCE_HEADERS = [
  'content-type',
  'content-length',
  'server',
  'date',
  'via',
  'x-powered-by',
  'cache-control',
  'location',
] as const;

function filterSafeHeaders(headers: Record<string, string>): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const name of SAFE_EVIDENCE_HEADERS) {
    if (headers[name] !== undefined) safe[name] = headers[name];
  }
  return safe;
}

function primaryTargetUrl(context: ScannerContext): string {
  const config = context.asset.config as Partial<WebAssetConfig>;
  if (!config.baseUrl) {
    throw new Error(`Asset ${context.asset.id} has no baseUrl configured`);
  }
  return config.baseUrl;
}

/**
 * The first real scanner (Part L): determines whether an authorized WEB
 * target is reachable and records basic, non-invasive HTTP observations.
 * Issues exactly one outbound request. Never submits forms, never mutates
 * state, never crawls or fuzzes.
 */
export const httpReachabilityScanner: ScannerPlugin = {
  name: SCANNER_NAME,
  supportedAssetTypes: ['WEB'],
  supportedAssessmentTypes: ['WEB'],
  requiredCapabilities: ['http-egress'],

  async run(context: ScannerContext): Promise<void> {
    const target = primaryTargetUrl(context);
    context.logger.info({ target }, 'http-reachability: requesting target');

    try {
      const response = await context.httpClient.request(target, context.scope, { method: 'GET' });

      await context.reportFinding({
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
          hops: response.hops,
          durationMs: response.durationMs,
          headers: filterSafeHeaders(response.headers),
          bodyBytesRead: response.bodyBytesRead,
          bodyTruncated: response.bodyTruncated,
        },
      });

      // Passive analysis (Batch 5): reuses this SAME response — no
      // additional outbound request is made. See Part Q/Y.
      const observation = buildHttpObservation(response);
      const passiveFindings = runPassiveChecks(WEB_PASSIVE_CHECKS, observation, {
        target,
        assetType: context.asset.assetType,
      });
      for (const finding of passiveFindings) {
        await context.reportFinding(finding);
      }
    } catch (error) {
      // Scope/SSRF rejections are security-relevant (e.g. a redirect tried to
      // leave the authorized scope) — the worker must classify these as a
      // permanent failure distinct from ordinary unreachability, so they are
      // rethrown rather than turned into a routine finding. See Part R.
      if (error instanceof ScopeViolationError || error instanceof SsrfViolationError) {
        throw error;
      }

      context.logger.warn(
        { target, err: error instanceof Error ? error.message : String(error) },
        'http-reachability: target unreachable',
      );

      await context.reportFinding({
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
  },
};

export const SCANNER_REGISTRY = [httpReachabilityScanner];
