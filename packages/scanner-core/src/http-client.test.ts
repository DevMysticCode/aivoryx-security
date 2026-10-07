import { createServer, type Server } from 'node:http';
import { lookup as dnsLookup } from 'node:dns/promises';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AssessmentScope } from '@aivoryx/shared-types';
import { SafeHttpClient } from './http-client.js';
import { ScopeViolationError, SsrfViolationError, ResourceLimitExceededError } from './errors.js';

// This entire suite talks to 127.0.0.1 test fixtures, so it always passes
// allowPrivateRanges: true explicitly — the same test-only mechanism
// packages/config exposes via SSRF_ALLOW_PRIVATE_RANGES (refused in
// production by the config schema). See Part W.

function startServer(
  handler: Parameters<typeof createServer>[0],
  /** Omit to bind dual-stack (both 127.0.0.1 and ::1) — needed for a 'localhost' target, since which family wins DNS resolution is system-dependent. */
  host: string | undefined = '127.0.0.1',
): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer(handler);
    const onListening = () => resolve({ server, port: (server.address() as AddressInfo).port });
    if (host) {
      server.listen(0, host, onListening);
    } else {
      server.listen(0, onListening);
    }
  });
}

describe('SafeHttpClient', () => {
  let okServer: { server: Server; port: number };
  let redirectServer: { server: Server; port: number };
  let bigServer: { server: Server; port: number };
  let slowServer: { server: Server; port: number };

  beforeAll(async () => {
    okServer = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain', Server: 'test-fixture' });
      res.end('ok');
    });

    bigServer = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      res.end(Buffer.alloc(1_000_000, 'x'));
    });

    slowServer = await startServer((_req, res) => {
      setTimeout(() => {
        res.writeHead(200);
        res.end('late');
      }, 2000);
    });

    redirectServer = await startServer((req, res) => {
      if (req.url === '/to-self') {
        res.writeHead(302, { Location: `http://127.0.0.1:${okServer.port}/` });
        res.end();
      } else if (req.url === '/to-out-of-scope') {
        res.writeHead(302, { Location: 'http://evil.example.net/' });
        res.end();
      } else if (req.url === '/to-metadata') {
        res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' });
        res.end();
      } else if (req.url === '/loop') {
        res.writeHead(302, { Location: `http://127.0.0.1:${redirectServer.port}/loop` });
        res.end();
      } else {
        res.writeHead(404);
        res.end();
      }
    });
  });

  afterAll(() => {
    okServer.server.close();
    bigServer.server.close();
    slowServer.server.close();
    redirectServer.server.close();
  });

  function scopeFor(...ports: number[]): AssessmentScope {
    return {
      schemes: ['http', 'https'],
      hosts: ['127.0.0.1'],
      ports,
      allowedPathPrefixes: [],
      exclusions: { hosts: [], paths: [] },
    };
  }

  it('performs a basic in-scope GET request', async () => {
    const client = new SafeHttpClient({
      connectTimeoutMs: 2000,
      requestTimeoutMs: 5000,
      maxRedirects: 3,
      maxResponseBytes: 1_000_000,
      maxHeaderBytes: 32_768,
      allowPrivateRanges: true,
    });

    const response = await client.request(
      `http://127.0.0.1:${okServer.port}/`,
      scopeFor(okServer.port),
    );
    expect(response.status).toBe(200);
    expect(response.headers['server']).toBe('test-fixture');
    expect(response.redirectCount).toBe(0);
  });

  it('rejects a request whose host is not in scope, without connecting', async () => {
    const client = new SafeHttpClient({
      connectTimeoutMs: 2000,
      requestTimeoutMs: 5000,
      maxRedirects: 3,
      maxResponseBytes: 1_000_000,
      maxHeaderBytes: 32_768,
      allowPrivateRanges: true,
    });

    await expect(client.request('http://out-of-scope.example.com/', scopeFor(80))).rejects.toThrow(
      ScopeViolationError,
    );
  });

  it('rejects a loopback target when the SSRF test bypass is disabled (production behavior)', async () => {
    const client = new SafeHttpClient({
      connectTimeoutMs: 2000,
      requestTimeoutMs: 5000,
      maxRedirects: 3,
      maxResponseBytes: 1_000_000,
      maxHeaderBytes: 32_768,
      allowPrivateRanges: false,
    });

    await expect(
      client.request(`http://127.0.0.1:${okServer.port}/`, scopeFor(okServer.port)),
    ).rejects.toThrow(SsrfViolationError);
  });

  it('follows an in-scope redirect', async () => {
    const client = new SafeHttpClient({
      connectTimeoutMs: 2000,
      requestTimeoutMs: 5000,
      maxRedirects: 3,
      maxResponseBytes: 1_000_000,
      maxHeaderBytes: 32_768,
      allowPrivateRanges: true,
    });

    const response = await client.request(
      `http://127.0.0.1:${redirectServer.port}/to-self`,
      scopeFor(redirectServer.port, okServer.port),
    );
    expect(response.status).toBe(200);
    expect(response.redirectCount).toBe(1);
    expect(response.finalUrl).toBe(`http://127.0.0.1:${okServer.port}/`);
  });

  it('rejects a redirect to an out-of-scope public host', async () => {
    const client = new SafeHttpClient({
      connectTimeoutMs: 2000,
      requestTimeoutMs: 5000,
      maxRedirects: 3,
      maxResponseBytes: 1_000_000,
      maxHeaderBytes: 32_768,
      allowPrivateRanges: true,
    });

    await expect(
      client.request(
        `http://127.0.0.1:${redirectServer.port}/to-out-of-scope`,
        scopeFor(redirectServer.port),
      ),
    ).rejects.toThrow(ScopeViolationError);
  });

  it('rejects a redirect to a cloud metadata address even when the bypass is enabled for the initial host', async () => {
    // allowPrivateRanges is a blanket test toggle here, so this test instead
    // proves the redirect target is scope-rejected (metadata host isn't in
    // the allow-list) — the SSRF layer is proven separately in ssrf.test.ts
    // and in the "bypass disabled" test above.
    const client = new SafeHttpClient({
      connectTimeoutMs: 2000,
      requestTimeoutMs: 5000,
      maxRedirects: 3,
      maxResponseBytes: 1_000_000,
      maxHeaderBytes: 32_768,
      allowPrivateRanges: true,
    });

    await expect(
      client.request(
        `http://127.0.0.1:${redirectServer.port}/to-metadata`,
        scopeFor(redirectServer.port),
      ),
    ).rejects.toThrow(ScopeViolationError);
  });

  it('rejects a redirect loop', async () => {
    const client = new SafeHttpClient({
      connectTimeoutMs: 2000,
      requestTimeoutMs: 5000,
      maxRedirects: 5,
      maxResponseBytes: 1_000_000,
      maxHeaderBytes: 32_768,
      allowPrivateRanges: true,
    });

    await expect(
      client.request(`http://127.0.0.1:${redirectServer.port}/loop`, scopeFor(redirectServer.port)),
    ).rejects.toThrow(ResourceLimitExceededError);
  });

  it('enforces a maximum redirect count', async () => {
    const client = new SafeHttpClient({
      connectTimeoutMs: 2000,
      requestTimeoutMs: 5000,
      maxRedirects: 0,
      maxResponseBytes: 1_000_000,
      maxHeaderBytes: 32_768,
      allowPrivateRanges: true,
    });

    await expect(
      client.request(
        `http://127.0.0.1:${redirectServer.port}/to-self`,
        scopeFor(redirectServer.port, okServer.port),
      ),
    ).rejects.toThrow(ResourceLimitExceededError);
  });

  it('truncates a response exceeding maxResponseBytes instead of buffering it fully', async () => {
    const client = new SafeHttpClient({
      connectTimeoutMs: 2000,
      requestTimeoutMs: 5000,
      maxRedirects: 3,
      maxResponseBytes: 1000,
      maxHeaderBytes: 32_768,
      allowPrivateRanges: true,
    });

    const response = await client.request(
      `http://127.0.0.1:${bigServer.port}/`,
      scopeFor(bigServer.port),
    );
    expect(response.bodyTruncated).toBe(true);
    expect(response.bodyBytesRead).toBeLessThan(1_000_000);
  });

  it('enforces a request timeout against a slow server', async () => {
    const client = new SafeHttpClient({
      connectTimeoutMs: 2000,
      requestTimeoutMs: 200,
      maxRedirects: 3,
      maxResponseBytes: 1_000_000,
      maxHeaderBytes: 32_768,
      allowPrivateRanges: true,
    });

    await expect(
      client.request(`http://127.0.0.1:${slowServer.port}/`, scopeFor(slowServer.port)),
    ).rejects.toThrow(ResourceLimitExceededError);
  }, 3000);

  it('only ever issues GET/HEAD — never a mutating method', async () => {
    const client = new SafeHttpClient({
      connectTimeoutMs: 2000,
      requestTimeoutMs: 5000,
      maxRedirects: 3,
      maxResponseBytes: 1_000_000,
      maxHeaderBytes: 32_768,
      allowPrivateRanges: true,
    });

    const response = await client.request(
      `http://127.0.0.1:${okServer.port}/`,
      scopeFor(okServer.port),
      { method: 'HEAD' },
    );
    expect(response.status).toBe(200);
  });

  it('connects successfully to a hostname target, not just a literal IP', async () => {
    // Regression test: Node 20+ enables Happy Eyeballs (`autoSelectFamily`) by
    // default, which only engages for a *hostname* target — a literal IP (as
    // every other test in this file uses) skips the custom `lookup` callback
    // entirely, so it never exercised this code path. When Happy Eyeballs is
    // active, Node calls `lookup` with `{ all: true }` and expects the
    // callback to receive an ARRAY of addresses, not the legacy single
    // `(err, address, family)` triple. Getting this wrong previously crashed
    // every hostname-based request (so effectively every real-world target)
    // deep inside Node's net internals with "Invalid IP address: undefined".
    // Bind to whatever address this system's resolver actually returns for
    // 'localhost' first — SafeHttpClient will resolve and connect to that
    // same address, and which family (::1 vs 127.0.0.1) wins is otherwise
    // platform-dependent.
    const { address: localhostAddress } = await dnsLookup('localhost');
    const hostnameServer = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
    }, localhostAddress);

    try {
      const client = new SafeHttpClient({
        connectTimeoutMs: 2000,
        requestTimeoutMs: 5000,
        maxRedirects: 3,
        maxResponseBytes: 1_000_000,
        maxHeaderBytes: 32_768,
        allowPrivateRanges: true,
      });

      const response = await client.request(`http://localhost:${hostnameServer.port}/`, {
        schemes: ['http', 'https'],
        hosts: ['localhost'],
        ports: [hostnameServer.port],
        allowedPathPrefixes: [],
        exclusions: { hosts: [], paths: [] },
      });
      expect(response.status).toBe(200);
    } finally {
      hostnameServer.server.close();
    }
  });
});
