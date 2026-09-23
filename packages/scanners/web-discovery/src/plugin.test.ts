import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SafeHttpClient } from '@aivoryx/scanner-core';
import type { AssessmentScope } from '@aivoryx/shared-types';
import { webDiscoveryScanner } from './plugin.js';

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

describe('webDiscoveryScanner', () => {
  let okServer: { server: Server; port: number };

  beforeAll(async () => {
    okServer = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<a href="/x">x</a>');
    });
  });

  afterAll(() => okServer.server.close());

  function makeContext(baseUrl: string, scope: AssessmentScope, withDiscoveryReporter: boolean) {
    const findings: unknown[] = [];
    const discovered: unknown[] = [];
    return {
      findings,
      discovered,
      context: {
        assessment: { id: 'a1', assessmentType: 'WEB' as const },
        asset: { id: 'asset1', assetType: 'WEB' as const, config: { baseUrl } },
        scope,
        httpClient: new SafeHttpClient({
          connectTimeoutMs: 2000,
          requestTimeoutMs: 5000,
          maxRedirects: 3,
          maxResponseBytes: 1_000_000,
          maxHeaderBytes: 32_768,
          allowPrivateRanges: true,
        }),
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        reportFinding: vi.fn(async (input: unknown) => {
          findings.push(input);
        }),
        reportDiscoveredUrl: withDiscoveryReporter
          ? vi.fn(async (input: unknown) => {
              discovered.push(input);
            })
          : undefined,
        signal: new AbortController().signal,
      },
    };
  }

  it('declares only the http-egress capability and applies only to WEB/WEB', () => {
    expect(webDiscoveryScanner.requiredCapabilities).toEqual(['http-egress']);
    expect(webDiscoveryScanner.supportedAssetTypes).toEqual(['WEB']);
    expect(webDiscoveryScanner.supportedAssessmentTypes).toEqual(['WEB']);
  });

  it('throws if the worker does not support reportDiscoveredUrl', async () => {
    const scope: AssessmentScope = {
      schemes: ['http', 'https'],
      hosts: ['127.0.0.1'],
      ports: [okServer.port],
      allowedPathPrefixes: [],
      exclusions: { hosts: [], paths: [] },
    };
    const { context } = makeContext(`http://127.0.0.1:${okServer.port}/`, scope, false);
    await expect(webDiscoveryScanner.run(context)).rejects.toThrow(/reportDiscoveredUrl/);
  });

  it('runs a crawl and reports both findings and discovered URLs', async () => {
    const scope: AssessmentScope = {
      schemes: ['http', 'https'],
      hosts: ['127.0.0.1'],
      ports: [okServer.port],
      allowedPathPrefixes: [],
      exclusions: { hosts: [], paths: [] },
    };
    const { context, findings, discovered } = makeContext(
      `http://127.0.0.1:${okServer.port}/`,
      scope,
      true,
    );
    await webDiscoveryScanner.run(context);
    expect(findings.length).toBeGreaterThan(0);
    expect(discovered.length).toBeGreaterThan(0);
  });
});
