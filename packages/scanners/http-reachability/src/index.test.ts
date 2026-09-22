import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SafeHttpClient, ScopeViolationError } from '@aivoryx/scanner-core';
import type { AssessmentScope } from '@aivoryx/shared-types';
import { httpReachabilityScanner } from './index.js';

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

describe('httpReachabilityScanner', () => {
  let okServer: { server: Server; port: number };

  beforeAll(async () => {
    okServer = await startServer((_req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/plain',
        'Set-Cookie': 'secret=should-never-appear',
      });
      res.end('ok');
    });
  });

  afterAll(() => okServer.server.close());

  function makeContext(baseUrl: string, scope: AssessmentScope) {
    const findings: unknown[] = [];
    return {
      findings,
      context: {
        assessment: { id: 'assessment-1', assessmentType: 'WEB' as const },
        asset: { id: 'asset-1', assetType: 'WEB' as const, config: { baseUrl } },
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
        signal: new AbortController().signal,
      },
    };
  }

  it('reports an INFO reachability finding and never persists Set-Cookie', async () => {
    const scope: AssessmentScope = {
      schemes: ['http', 'https'],
      hosts: ['127.0.0.1'],
      ports: [okServer.port],
      allowedPathPrefixes: [],
      exclusions: { hosts: [], paths: [] },
    };
    const { context, findings } = makeContext(`http://127.0.0.1:${okServer.port}/`, scope);

    await httpReachabilityScanner.run(context);

    expect(findings).toHaveLength(1);
    const finding = findings[0] as {
      severity: string;
      key: string;
      evidence: Record<string, unknown>;
    };
    expect(finding.severity).toBe('INFO');
    expect(finding.key).toBe('reachable');
    expect(JSON.stringify(finding.evidence)).not.toContain('should-never-appear');
    expect(JSON.stringify(finding.evidence)).not.toContain('Set-Cookie');
  });

  it('reports an unreachable finding for a plain connection failure', async () => {
    const scope: AssessmentScope = {
      schemes: ['http', 'https'],
      hosts: ['127.0.0.1'],
      ports: [65530],
      allowedPathPrefixes: [],
      exclusions: { hosts: [], paths: [] },
    };
    const { context, findings } = makeContext('http://127.0.0.1:65530/', scope);

    await httpReachabilityScanner.run(context);

    expect(findings).toHaveLength(1);
    expect((findings[0] as { key: string }).key).toBe('unreachable');
  });

  it('propagates a scope violation instead of swallowing it as a routine finding', async () => {
    const scope: AssessmentScope = {
      schemes: ['http', 'https'],
      hosts: ['some-other-host.example.com'],
      ports: [80],
      allowedPathPrefixes: [],
      exclusions: { hosts: [], paths: [] },
    };
    const { context } = makeContext(`http://127.0.0.1:${okServer.port}/`, scope);

    await expect(httpReachabilityScanner.run(context)).rejects.toThrow(ScopeViolationError);
  });

  it('declares only the http-egress capability and applies only to WEB/WEB', () => {
    expect(httpReachabilityScanner.requiredCapabilities).toEqual(['http-egress']);
    expect(httpReachabilityScanner.supportedAssetTypes).toEqual(['WEB']);
    expect(httpReachabilityScanner.supportedAssessmentTypes).toEqual(['WEB']);
  });
});
