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

let nextFakeFindingId = 0;
/** Mirrors the real reportFinding contract (Batch 10): returns the created finding's id. */
async function fakeReportFinding(
  findings: ReportFindingInput[],
  input: ReportFindingInput,
): Promise<string> {
  findings.push(input);
  nextFakeFindingId += 1;
  return `fake-finding-${nextFakeFindingId}`;
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
            securityResult: 'FINDING',
            candidate: {
              title: 'Reflected marker',
              description: 'The marker was reflected unescaped',
              severity: 'MEDIUM',
              confidence: 'HIGH',
              key: 'reflected-marker',
            },
          }
        : { securityResult: 'NO_FINDING' },
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
      reportFinding: (input) => fakeReportFinding(findings, input),
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
                securityResult: 'FINDING',
                candidate: {
                  title: 'Reflected marker',
                  description: 'The marker was reflected unescaped',
                  severity: 'MEDIUM',
                  confidence: 'HIGH',
                  key: `reflected-marker:${mutation.name}`,
                },
              }
            : { securityResult: 'NO_FINDING' },
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
        reportFinding: (input) => fakeReportFinding(findings, input),
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
      reportFinding: (input) => fakeReportFinding(findings, input),
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
      reportFinding: async () => null,
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
      reportFinding: async () => null,
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
        // A non-empty mutations() is required so the baseline is actually
        // fetched (Batch 10: an empty mutations() now skips the pair
        // entirely before any request — see the NO_PARAMETERS test below) —
        // both the baseline and the one mutation go through the slow
        // handler, exercising the scheduler's concurrency cap properly.
        definitions: [
          fixtureDefinition({
            mutations: () => [{ kind: 'query-param', name: 'q', value: 'unused' }],
            classify: () => ({ securityResult: 'NO_FINDING' }),
          }),
        ],
        httpClient: buildClient(),
        scope: scopeFor(trackedSlow.port),
        logger: noopLogger,
        signal: new AbortController().signal,
        requestBudget: 50,
        maxConcurrentRequests: 2,
        requestsPerSecond: 50,
        reportFinding: async () => null,
        onExecution: async () => {},
      });

      expect(maxActive).toBeLessThanOrEqual(2);
    } finally {
      trackedSlow.server.close();
    }
  });

  it('skips a target with no applicable mutations WITHOUT spending a request — status SKIPPED, skipReason NO_PARAMETERS (Batch 10)', async () => {
    const executions: ActiveTestExecutionResult[] = [];
    const noOpDefinition = fixtureDefinition({ mutations: () => [] });

    const result = await runActiveTestPlan({
      baselineTargets: [{ url: `http://127.0.0.1:${server.port}/noparams`, method: 'GET' }],
      definitions: [noOpDefinition],
      httpClient: buildClient(),
      scope: scopeFor(server.port),
      logger: noopLogger,
      signal: new AbortController().signal,
      requestBudget: 50,
      maxConcurrentRequests: 2,
      requestsPerSecond: 50,
      reportFinding: async () => null,
      onExecution: async (execution) => {
        executions.push(execution);
      },
    });

    expect(result.status).toBe('COMPLETED');
    expect(result.requestsUsed).toBe(0);
    expect(executions).toHaveLength(1);
    expect(executions[0]!.status).toBe('SKIPPED');
    expect(executions[0]!.skipReason).toBe('NO_PARAMETERS');
    expect(executions[0]!.securityResult).toBeNull();
    expect(executions[0]!.requestsUsed).toBe(0);
  });

  it('preserves the ACCURATE partial request count when the budget is exhausted mid-pair, instead of discarding it (Batch 10 fix)', async () => {
    const executions: ActiveTestExecutionResult[] = [];
    const twoMutations = fixtureDefinition({
      mutations: () => [
        { kind: 'query-param', name: 'q', value: 'AIVORYX_TEST_MARKER' },
        { kind: 'query-param', name: 'other', value: 'AIVORYX_TEST_MARKER' },
      ],
    });

    const result = await runActiveTestPlan({
      baselineTargets: [{ url: `http://127.0.0.1:${server.port}/search`, method: 'GET' }],
      definitions: [twoMutations],
      httpClient: buildClient(),
      scope: scopeFor(server.port),
      logger: noopLogger,
      signal: new AbortController().signal,
      // Exactly enough for baseline + the first mutation, not the second.
      requestBudget: 2,
      maxConcurrentRequests: 2,
      requestsPerSecond: 50,
      reportFinding: async () => null,
      onExecution: async (execution) => {
        executions.push(execution);
      },
    });

    expect(result.status).toBe('BUDGET_EXHAUSTED');
    expect(executions).toHaveLength(1);
    const [execution] = executions;
    expect(execution!.status).toBe('BUDGET_EXHAUSTED');
    // The old behavior discarded this pair's progress entirely and reported
    // 0 — this must now reflect the two requests that genuinely happened
    // (baseline + the first mutation) before the second was rejected.
    expect(execution!.requestsUsed).toBe(2);
    expect(execution!.mutationsAttempted).toBe(1);
    expect(execution!.securityResult).toBeNull();
    expect(result.requestsUsed).toBe(2);
  });

  it("INVARIANT: the plan-level requestsUsed always equals the sum of every execution's own requestsUsed (Batch 10 spec Part 28)", async () => {
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
      requestBudget: 50,
      maxConcurrentRequests: 2,
      requestsPerSecond: 50,
      reportFinding: async () => null,
      onExecution: async (execution) => {
        executions.push(execution);
      },
    });

    const summedFromExecutions = executions.reduce((sum, e) => sum + e.requestsUsed, 0);
    expect(result.requestsUsed).toBe(summedFromExecutions);
    expect(result.requestsUsed).toBeGreaterThan(0);
  });

  it("captures the reported finding's id onto the mutation attempt (Batch 10: closes the execution->finding gap)", async () => {
    const executions: ActiveTestExecutionResult[] = [];

    await runActiveTestPlan({
      baselineTargets: [{ url: `http://127.0.0.1:${server.port}/search`, method: 'GET' }],
      definitions: [fixtureDefinition()],
      httpClient: buildClient(),
      scope: scopeFor(server.port),
      logger: noopLogger,
      signal: new AbortController().signal,
      requestBudget: 50,
      maxConcurrentRequests: 2,
      requestsPerSecond: 50,
      reportFinding: async () => 'the-real-finding-id',
      onExecution: async (execution) => {
        executions.push(execution);
      },
    });

    expect(executions).toHaveLength(1);
    expect(executions[0]!.securityResult).toBe('FINDING');
    expect(executions[0]!.mutationResults[0]!.findingId).toBe('the-real-finding-id');
  });

  it('a FAILED baseline fetch produces securityResult INCONCLUSIVE and a classified failureReason (Batch 10)', async () => {
    const executions: ActiveTestExecutionResult[] = [];

    const result = await runActiveTestPlan({
      // Out-of-scope host — SafeHttpClient rejects before connecting.
      baselineTargets: [{ url: 'http://not-in-scope.example.com/', method: 'GET' }],
      definitions: [fixtureDefinition()],
      httpClient: buildClient(),
      scope: scopeFor(server.port),
      logger: noopLogger,
      signal: new AbortController().signal,
      requestBudget: 50,
      maxConcurrentRequests: 2,
      requestsPerSecond: 50,
      reportFinding: async () => null,
      onExecution: async (execution) => {
        executions.push(execution);
      },
    });

    expect(result.testsFailedCount).toBe(1);
    expect(executions).toHaveLength(1);
    expect(executions[0]!.status).toBe('FAILED');
    expect(executions[0]!.securityResult).toBe('INCONCLUSIVE');
    expect(executions[0]!.failureReason).toBe('SCOPE_REJECTED');
  });
});
