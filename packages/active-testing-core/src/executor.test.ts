import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SafeHttpClient, type ReportFindingInput } from '@aivoryx/scanner-core';
import type { AssessmentScope } from '@aivoryx/shared-types';
import { runActiveTestPlan } from './executor.js';
import type { ActiveTestDefinition, ActiveTestExecutionResult } from './types.js';

function startServer(handler: Parameters<typeof createServer>[0]): Promise<{
  server: Server;
  port: number;
}> {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, '127.0.0.1', () =>
      resolve({ server, port: (server.address() as AddressInfo).port }),
    );
  });
}

/** Reflects the `q` query parameter straight into the body — a deliberately
 * simple, controlled fixture standing in for a future real scanner, used
 * only in this test, never registered in production (see registry.ts). */
function reflectiveHandler(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const q = url.searchParams.get('q') ?? '';
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(`<html><body>query was: ${q}</body></html>`);
}

function buildClient(): SafeHttpClient {
  return new SafeHttpClient({
    connectTimeoutMs: 2000,
    requestTimeoutMs: 5000,
    maxRedirects: 3,
    maxResponseBytes: 1_000_000,
    maxHeaderBytes: 32_768,
    allowPrivateRanges: true,
  });
}

function fixtureDefinition(overrides: Partial<ActiveTestDefinition> = {}): ActiveTestDefinition {
  return {
    id: 'TEST-REFLECTION',
    name: 'Test-only reflection fixture',
    description: 'Detects whether a marker value is reflected unescaped in the response body',
    category: 'test',
    potentialSeverity: 'MEDIUM',
    supportedAssetTypes: ['WEB'],
    supportedAssessmentTypes: ['WEB'],
    safety: 'SAFE_READ_ONLY',
    httpMethod: 'GET',
    requiredCapabilities: ['http-egress'],
    requiresAuthContext: false,
    requestBudgetEstimate: 5,
    version: '1.0.0',
    markers: ['AIVORYX_TEST_MARKER'],
    mutations: () => [{ kind: 'query-param', name: 'q', value: 'AIVORYX_TEST_MARKER' }],
    classify: (diff) =>
      diff.markersDetected.length > 0
        ? {
            title: 'Reflected marker',
            description: 'The marker was reflected unescaped',
            severity: 'MEDIUM',
            confidence: 'HIGH',
            key: 'reflected-marker',
          }
        : null,
    ...overrides,
  };
}

function scopeFor(port: number): AssessmentScope {
  return {
    schemes: ['http', 'https'],
    hosts: ['127.0.0.1'],
    ports: [port],
    allowedPathPrefixes: [],
    exclusions: { hosts: [], paths: [] },
  };
}

const noopLogger = { info: () => {}, warn: () => {}, error: () => {} };

describe('runActiveTestPlan', () => {
  let server: { server: Server; port: number };

  beforeAll(async () => {
    server = await startServer(reflectiveHandler);
  });

  afterAll(() => {
    server.server.close();
  });

  it('runs baseline + mutation through SafeHttpClient and reports a finding when classify() detects something', async () => {
    const findings: ReportFindingInput[] = [];
    const executions: ActiveTestExecutionResult[] = [];

    const result = await runActiveTestPlan({
      baselineTargets: [{ url: `http://127.0.0.1:${server.port}/search`, method: 'GET' }],
      definitions: [fixtureDefinition()],
      httpClient: buildClient(),
      scope: scopeFor(server.port),
      logger: noopLogger,
      signal: new AbortController().signal,
      requestBudget: 50,
      maxConcurrentRequests: 2,
      requestsPerSecond: 50,
      reportFinding: async (input) => {
        findings.push(input);
      },
      onExecution: async (execution) => {
        executions.push(execution);
      },
    });

    expect(result.status).toBe('COMPLETED');
    expect(result.testsCompletedCount).toBe(1);
    expect(result.requestsUsed).toBe(2); // one baseline + one mutation
    expect(findings).toHaveLength(1);
    expect(findings[0]!.key).toBe('TEST-REFLECTION:reflected-marker');
    expect(findings[0]!.target).toContain('AIVORYX_TEST_MARKER');
    expect(executions).toHaveLength(1);
    expect(executions[0]!.status).toBe('COMPLETED');
    expect(executions[0]!.mutationsAttempted).toBe(1);
    expect(executions[0]!.findingsReported).toBe(1);
    expect(executions[0]!.mutationResults).toHaveLength(1);
    expect(executions[0]!.mutationResults[0]!.findingKey).toBe('reflected-marker');
    // The raw response body is never present in anything the executor hands
    // back for persistence — only summarized facts (see summarizeObservation).
    expect(JSON.stringify(executions[0])).not.toContain('query was');
  });

  it('tests every mutation independently and reports a finding for EACH one that classifies positively — never stopping at the first hit', async () => {
    // Reflects BOTH `q` and `other` independently, so a mutation targeting
    // either parameter alone produces a genuine, independent reflection —
    // proving two separately-vulnerable parameters both get found, not just
    // whichever one happens to be tried first.
    const twoParamServer = await startServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const q = url.searchParams.get('q') ?? '';
      const other = url.searchParams.get('other') ?? '';
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<html><body>q was: ${q} / other was: ${other}</body></html>`);
    });

    try {
      const findings: ReportFindingInput[] = [];
      const executions: ActiveTestExecutionResult[] = [];

      const multiParam = fixtureDefinition({
        mutations: () => [
          { kind: 'query-param', name: 'q', value: 'AIVORYX_TEST_MARKER' },
          { kind: 'query-param', name: 'other', value: 'AIVORYX_TEST_MARKER' },
        ],
        classify: (diff, _baseline, _mutated, mutation) =>
          diff.markersDetected.length > 0 && mutation.kind === 'query-param'
            ? {
                title: 'Reflected marker',
                description: 'The marker was reflected unescaped',
                severity: 'MEDIUM',
                confidence: 'HIGH',
                key: `reflected-marker:${mutation.name}`,
              }
            : null,
      });

      const result = await runActiveTestPlan({
        baselineTargets: [{ url: `http://127.0.0.1:${twoParamServer.port}/search`, method: 'GET' }],
        definitions: [multiParam],
        httpClient: buildClient(),
        scope: scopeFor(twoParamServer.port),
        logger: noopLogger,
        signal: new AbortController().signal,
        requestBudget: 50,
        maxConcurrentRequests: 2,
        requestsPerSecond: 50,
        reportFinding: async (input) => {
          findings.push(input);
        },
        onExecution: async (execution) => {
          executions.push(execution);
        },
      });

      expect(result.status).toBe('COMPLETED');
      expect(findings).toHaveLength(2);
      expect(findings.map((f) => f.key).sort()).toEqual([
        'TEST-REFLECTION:reflected-marker:other',
        'TEST-REFLECTION:reflected-marker:q',
      ]);
      expect(executions).toHaveLength(1);
      expect(executions[0]!.mutationsAttempted).toBe(2);
      expect(executions[0]!.findingsReported).toBe(2);
    } finally {
      twoParamServer.server.close();
    }
  });

  it('reports no finding when the marker is never reflected', async () => {
    const neverReflects = fixtureDefinition({
      mutations: () => [{ kind: 'query-param', name: 'q', value: 'something-else-entirely' }],
    });
    const findings: ReportFindingInput[] = [];

    const result = await runActiveTestPlan({
      baselineTargets: [{ url: `http://127.0.0.1:${server.port}/search`, method: 'GET' }],
      definitions: [neverReflects],
      httpClient: buildClient(),
      scope: scopeFor(server.port),
      logger: noopLogger,
      signal: new AbortController().signal,
      requestBudget: 50,
      maxConcurrentRequests: 2,
      requestsPerSecond: 50,
      reportFinding: async (input) => {
        findings.push(input);
      },
      onExecution: async () => {},
    });

    expect(result.status).toBe('COMPLETED');
    expect(findings).toHaveLength(0);
  });

  it('stops immediately once the shared request budget is exhausted, marking remaining pairs BUDGET_EXHAUSTED', async () => {
    const executions: ActiveTestExecutionResult[] = [];
    const targets = [
      { url: `http://127.0.0.1:${server.port}/a`, method: 'GET' as const },
      { url: `http://127.0.0.1:${server.port}/b`, method: 'GET' as const },
      { url: `http://127.0.0.1:${server.port}/c`, method: 'GET' as const },
    ];

    const result = await runActiveTestPlan({
      baselineTargets: targets,
      definitions: [fixtureDefinition()],
      httpClient: buildClient(),
      scope: scopeFor(server.port),
      logger: noopLogger,
      signal: new AbortController().signal,
      // Each pair needs 2 requests (baseline + 1 mutation); a budget of 2
      // allows exactly the first pair through and nothing more.
      requestBudget: 2,
      maxConcurrentRequests: 2,
      requestsPerSecond: 50,
      reportFinding: async () => {},
      onExecution: async (execution) => {
        executions.push(execution);
      },
    });

    expect(result.status).toBe('BUDGET_EXHAUSTED');
    expect(executions).toHaveLength(3);
    expect(executions[0]!.status).toBe('COMPLETED');
    expect(executions[1]!.status).toBe('BUDGET_EXHAUSTED');
    expect(executions[2]!.status).toBe('BUDGET_EXHAUSTED');
    // Never exceeds the budget it was given.
    expect(result.requestsUsed).toBeLessThanOrEqual(2);
  });

  it('stops cooperatively once the signal is aborted, marking remaining pairs CANCELLED without issuing further requests', async () => {
    const controller = new AbortController();
    const executions: ActiveTestExecutionResult[] = [];
    const targets = [
      { url: `http://127.0.0.1:${server.port}/a`, method: 'GET' as const },
      { url: `http://127.0.0.1:${server.port}/b`, method: 'GET' as const },
    ];

    // Abort before the plan even starts — the simplest deterministic way to
    // prove the cooperative check actually stops execution, without relying
    // on timing a mid-flight abort.
    controller.abort();

    const result = await runActiveTestPlan({
      baselineTargets: targets,
      definitions: [fixtureDefinition()],
      httpClient: buildClient(),
      scope: scopeFor(server.port),
      logger: noopLogger,
      signal: controller.signal,
      requestBudget: 50,
      maxConcurrentRequests: 2,
      requestsPerSecond: 50,
      reportFinding: async () => {},
      onExecution: async (execution) => {
        executions.push(execution);
      },
    });

    expect(result.status).toBe('CANCELLED');
    expect(result.requestsUsed).toBe(0);
    expect(executions).toHaveLength(2);
    expect(executions.every((e) => e.status === 'CANCELLED')).toBe(true);
  });

  it('never exceeds the configured concurrency limit', async () => {
    let active = 0;
    let maxActive = 0;
    const trackedSlow = await startServer((_req, res) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      setTimeout(() => {
        active -= 1;
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html>ok</html>');
      }, 30);
    });

    try {
      const targets = Array.from({ length: 5 }, (_, i) => ({
        url: `http://127.0.0.1:${trackedSlow.port}/${i}`,
        method: 'GET' as const,
      }));

      await runActiveTestPlan({
        baselineTargets: targets,
        definitions: [fixtureDefinition({ mutations: () => [] })],
        httpClient: buildClient(),
        scope: scopeFor(trackedSlow.port),
        logger: noopLogger,
        signal: new AbortController().signal,
        requestBudget: 50,
        maxConcurrentRequests: 2,
        requestsPerSecond: 50,
        reportFinding: async () => {},
        onExecution: async () => {},
      });

      expect(maxActive).toBeLessThanOrEqual(2);
    } finally {
      trackedSlow.server.close();
    }
  });
});
