import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SafeHttpClient } from '@aivoryx/scanner-core';
import type { AssessmentScope } from '@aivoryx/shared-types';
import { runWebDiscovery, type WebDiscoveryContext } from './crawler.js';
import type { ReportDiscoveredUrlInput } from '@aivoryx/scanner-core';

function startServer(
  handler: Parameters<typeof createServer>[0],
): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, '127.0.0.1', () =>
      resolve({ server, port: (server.address() as AddressInfo).port }),
    );
  });
}

function sendPage(res: Parameters<Parameters<typeof createServer>[0]>[1], body: string): void {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(body);
}

describe('runWebDiscovery', () => {
  let server: { server: Server; port: number };
  let requestLog: string[];

  beforeEach(async () => {
    requestLog = [];
    server = await startServer((req, res) => {
      requestLog.push(req.url ?? '');
      const url = req.url ?? '/';

      if (url === '/') {
        sendPage(
          res,
          `
          <a href="/about">About</a>
          <a href="/login">Login</a>
          <a href="/products">Products</a>
          <a href="/products?id=1">Product 1</a>
          <script src="/static/app.js"></script>
          <iframe src="/frame"></iframe>
          <a href="http://evil.example.net/">External</a>
          <a href="/redirect-ok">Redirect</a>
        `,
        );
        return;
      }
      if (url === '/about') {
        sendPage(res, '<a href="/contact">Contact</a>');
        return;
      }
      if (url === '/contact') {
        sendPage(res, '<p>contact</p>');
        return;
      }
      if (url === '/products') {
        sendPage(res, '<a href="/products?id=2">Product 2</a>');
        return;
      }
      if (url === '/products?id=1' || url === '/products?id=2') {
        sendPage(res, '<p>product</p>');
        return;
      }
      if (url === '/login') {
        sendPage(
          res,
          '<form action="/login" method="POST"><input name="username" type="text"><input name="password" type="password"></form>',
        );
        return;
      }
      if (url === '/frame') {
        sendPage(res, '<p>frame</p>');
        return;
      }
      if (url === '/redirect-ok') {
        res.writeHead(302, { Location: '/redirected' });
        res.end();
        return;
      }
      if (url === '/redirected') {
        sendPage(res, '<p>redirected</p>');
        return;
      }
      if (url === '/static/app.js') {
        // Should never actually be hit — resources are recorded, not fetched.
        res.writeHead(200, { 'Content-Type': 'application/javascript' });
        res.end('should-never-be-fetched();');
        return;
      }
      if (url === '/robots.txt') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(
          `User-agent: *\nDisallow: /admin\nSitemap: http://127.0.0.1:${server.port}/sitemap.xml\n`,
        );
        return;
      }
      if (url === '/sitemap.xml') {
        res.writeHead(200, { 'Content-Type': 'application/xml' });
        res.end(
          `<urlset><url><loc>http://127.0.0.1:${server.port}/from-sitemap</loc></url></urlset>`,
        );
        return;
      }
      if (url === '/from-sitemap') {
        sendPage(res, '<p>from sitemap</p>');
        return;
      }
      res.writeHead(404);
      res.end();
    });
  });

  afterEach(() => {
    server.server.close();
  });

  function scope(): AssessmentScope {
    return {
      schemes: ['http', 'https'],
      hosts: ['127.0.0.1'],
      ports: [server.port],
      allowedPathPrefixes: [],
      exclusions: { hosts: [], paths: [] },
    };
  }

  function makeCtx(): { ctx: WebDiscoveryContext; discovered: ReportDiscoveredUrlInput[] } {
    const discovered: ReportDiscoveredUrlInput[] = [];
    const ctx: WebDiscoveryContext = {
      httpClient: new SafeHttpClient({
        connectTimeoutMs: 2000,
        requestTimeoutMs: 5000,
        maxRedirects: 3,
        maxResponseBytes: 1_000_000,
        maxHeaderBytes: 32_768,
        allowPrivateRanges: true,
      }),
      scope: scope(),
      assetType: 'WEB',
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      reportFinding: vi.fn(async () => undefined),
      reportDiscoveredUrl: vi.fn(async (input: ReportDiscoveredUrlInput) => {
        discovered.push(input);
      }),
    };
    return { ctx, discovered };
  }

  it('discovers the seed and in-scope pages/resources, preserving query strings', async () => {
    const { ctx, discovered } = makeCtx();
    await runWebDiscovery(`http://127.0.0.1:${server.port}/`, ctx, { maxDepth: 2 });

    const urls = discovered.map((d) => d.url);
    expect(urls).toContain(`http://127.0.0.1:${server.port}/`);
    expect(urls).toContain(`http://127.0.0.1:${server.port}/about`);
    expect(urls).toContain(`http://127.0.0.1:${server.port}/login`);
    expect(urls).toContain(`http://127.0.0.1:${server.port}/products`);
    expect(urls).toContain(`http://127.0.0.1:${server.port}/products?id=1`);
    // depth-2 discovery via /products -> /products?id=2
    expect(urls).toContain(`http://127.0.0.1:${server.port}/products?id=2`);
    expect(urls).toContain(`http://127.0.0.1:${server.port}/static/app.js`);
  });

  it('records resources without ever fetching them', async () => {
    const { ctx } = makeCtx();
    await runWebDiscovery(`http://127.0.0.1:${server.port}/`, ctx, { maxDepth: 2 });
    expect(requestLog).not.toContain('/static/app.js');
  });

  it('never requests an out-of-scope URL', async () => {
    const { ctx } = makeCtx();
    const result = await runWebDiscovery(`http://127.0.0.1:${server.port}/`, ctx, { maxDepth: 2 });
    expect(requestLog.some((u) => u.includes('evil.example.net'))).toBe(false);
    expect(
      result.events.some(
        (e) => e.type === 'URL_SKIPPED_OUT_OF_SCOPE' && e.url?.includes('evil.example.net'),
      ),
    ).toBe(true);
  });

  it('throws (does not silently no-op) when the SEED itself is out of scope', async () => {
    const { ctx } = makeCtx();
    ctx.scope = {
      schemes: ['http', 'https'],
      hosts: ['not-the-real-host.example.com'],
      ports: [server.port],
      allowedPathPrefixes: [],
      exclusions: { hosts: [], paths: [] },
    };
    await expect(
      runWebDiscovery(`http://127.0.0.1:${server.port}/`, ctx, { maxDepth: 2 }),
    ).rejects.toThrow(/scope/i);
    expect(requestLog).toHaveLength(0); // never even attempted the fetch's connection
  });

  it('follows an in-scope redirect through SafeHttpClient', async () => {
    const { ctx, discovered } = makeCtx();
    await runWebDiscovery(`http://127.0.0.1:${server.port}/`, ctx, { maxDepth: 2 });
    expect(discovered.map((d) => d.url)).toContain(`http://127.0.0.1:${server.port}/redirected`);
  });

  it('suppresses duplicate (url, type) pairs (e.g. a URL reached via multiple links)', async () => {
    const { ctx, discovered } = makeCtx();
    await runWebDiscovery(`http://127.0.0.1:${server.port}/`, ctx, { maxDepth: 2 });
    // The same URL can legitimately appear once per distinct role (e.g.
    // /login as both a PAGE and, separately, a FORM_ACTION) — that's not a
    // duplicate, it mirrors the database's (assessmentId, url, urlType)
    // uniqueness. A true duplicate would be the identical (url, type) pair twice.
    const pairs = discovered.map((d) => `${d.type}:${d.url}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it('respects crawl depth (0 = seed only, no further PAGE fetches)', async () => {
    const { ctx, discovered } = makeCtx();
    await runWebDiscovery(`http://127.0.0.1:${server.port}/`, ctx, { maxDepth: 0 });
    // Resources referenced by the seed are still recorded (no extra fetch
    // required to know they exist), but no further PAGE was fetched.
    const pageUrls = discovered.filter((d) => d.type === 'PAGE').map((d) => d.url);
    expect(pageUrls).toEqual([`http://127.0.0.1:${server.port}/`]);
    expect(requestLog).toEqual(['/']);
  });

  it('respects crawl depth 1 (seed + direct links only, not /contact or ?id=2)', async () => {
    const { ctx, discovered } = makeCtx();
    await runWebDiscovery(`http://127.0.0.1:${server.port}/`, ctx, { maxDepth: 1 });
    const urls = discovered.map((d) => d.url);
    expect(urls).toContain(`http://127.0.0.1:${server.port}/about`);
    expect(urls).not.toContain(`http://127.0.0.1:${server.port}/contact`);
    expect(urls).not.toContain(`http://127.0.0.1:${server.port}/products?id=2`);
  });

  it('enforces maxUrls', async () => {
    const { ctx, discovered } = makeCtx();
    const result = await runWebDiscovery(`http://127.0.0.1:${server.port}/`, ctx, {
      maxDepth: 2,
      maxUrls: 3,
    });
    expect(discovered.length).toBeLessThanOrEqual(3);
    expect(result.limitsHit).toContain('maxUrls');
  });

  it('enforces maxTotalRequests', async () => {
    const { ctx } = makeCtx();
    const result = await runWebDiscovery(`http://127.0.0.1:${server.port}/`, ctx, {
      maxDepth: 2,
      maxTotalRequests: 1,
    });
    expect(result.requestCount).toBeLessThanOrEqual(1);
  });

  it('records discovered forms without submitting them', async () => {
    const { ctx, discovered } = makeCtx();
    await runWebDiscovery(`http://127.0.0.1:${server.port}/`, ctx, { maxDepth: 2 });
    const form = discovered.find((d) => d.type === 'FORM_ACTION');
    expect(form).toBeDefined();
    expect(form?.metadata).toMatchObject({ method: 'POST' });
    // The only way the form could have been "submitted" is a POST/PUT/PATCH/
    // DELETE request appearing in the server's request log — it never does.
    expect(requestLog.filter((u) => u === '/login')).toHaveLength(1); // one GET only
  });

  it('reports the seed reachability finding and passive findings from the SAME fetch (no duplicate request for the seed)', async () => {
    const { ctx } = makeCtx();
    await runWebDiscovery(`http://127.0.0.1:${server.port}/`, ctx, { maxDepth: 0 });
    const seedRequests = requestLog.filter((u) => u === '/');
    expect(seedRequests).toHaveLength(1);
    expect(ctx.reportFinding).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'reachability', key: 'reachable' }),
    );
  });

  it('runs passive checks on every fetched HTML page, not only the seed', async () => {
    const { ctx } = makeCtx();
    await runWebDiscovery(`http://127.0.0.1:${server.port}/`, ctx, { maxDepth: 1 });
    const calls = (ctx.reportFinding as ReturnType<typeof vi.fn>).mock.calls;
    const targets = new Set(calls.map((c) => c[0].target));
    expect(targets.size).toBeGreaterThan(1); // findings attributed to more than just the seed URL
  });

  it('does not fetch robots.txt/sitemap.xml when disabled (the default)', async () => {
    const { ctx } = makeCtx();
    await runWebDiscovery(`http://127.0.0.1:${server.port}/`, ctx, { maxDepth: 0 });
    expect(requestLog).not.toContain('/robots.txt');
    expect(requestLog).not.toContain('/sitemap.xml');
  });

  it('discovers a sitemap referenced from robots.txt, scope-checked like any other URL', async () => {
    const { ctx, discovered } = makeCtx();
    await runWebDiscovery(`http://127.0.0.1:${server.port}/`, ctx, {
      maxDepth: 1,
      robotsEnabled: true,
      sitemapEnabled: true,
    });
    expect(requestLog).toContain('/robots.txt');
    expect(requestLog).toContain('/sitemap.xml');
    const urls = discovered.map((d) => d.url);
    expect(urls).toContain(`http://127.0.0.1:${server.port}/from-sitemap`);
    expect(discovered.some((d) => d.type === 'ROBOTS')).toBe(true);
    expect(discovered.some((d) => d.type === 'SITEMAP')).toBe(true);
  });
});
