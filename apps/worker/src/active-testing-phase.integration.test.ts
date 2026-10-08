import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Job } from 'bullmq';
import { createDbClient, schema, type DbClient } from '@aivoryx/db';
import type { AssessmentJobData } from '@aivoryx/queue';
import type { AppConfig } from '@aivoryx/config';
import { buildWebAssetScope } from '@aivoryx/shared-types';
import type { ActiveTestDefinition } from '@aivoryx/active-testing-core';
import type { ScannerPlugin } from '@aivoryx/scanner-core';
import { createAssessmentJobProcessor } from './assessment-processor.js';

// Requires live PostgreSQL with migrations applied through 0008 — see
// assessment-processor.integration.test.ts's header for exact run
// instructions (no Redis needed here: the processor function is invoked
// directly with a fake BullMQ Job rather than through a real queue/worker —
// deliberately avoiding a second worker instance on the shared
// ASSESSMENT_JOBS queue, which would otherwise race with
// assessment-processor.integration.test.ts's own worker for job delivery
// when both files run in parallel). This file exercises the Batch 8
// active-testing phase end to end via a test-only fixture
// ActiveTestDefinition, injected through
// AssessmentProcessorDeps.activeTestRegistry exactly like
// scannerRegistry/SCANNER_REGISTRY — NEVER registered in production (see
// apps/worker/src/index.ts, which always passes the empty ACTIVE_TEST_REGISTRY).
const DATABASE_URL = process.env.TEST_DATABASE_URL;

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

function noopLogger() {
  return { info: () => undefined, warn: () => undefined, error: () => undefined };
}

function fakeJob(data: AssessmentJobData): Job<AssessmentJobData> {
  return { data } as Job<AssessmentJobData>;
}

/** A trivial, no-op "discovery/passive" scanner — just enough for the main
 * plugin loop to succeed so the active-testing phase (which only runs after
 * that loop completes without error) is reached. This file is testing the
 * active-testing phase in isolation, not web-discovery. */
const NOOP_SCANNER: ScannerPlugin = {
  name: 'noop',
  supportedAssetTypes: ['WEB'],
  supportedAssessmentTypes: ['WEB'],
  requiredCapabilities: ['http-egress'],
  run: async () => {},
};

/** Reflects the `q` query parameter straight into the body — a deliberately
 * simple fixture standing in for a future real scanner. Used only in this
 * test file; never registered in production (see registry.ts's empty
 * ACTIVE_TEST_REGISTRY). */
const REFLECTION_FIXTURE: ActiveTestDefinition = {
  id: 'TEST-REFLECTION-FIXTURE',
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
};

describe.skipIf(!DATABASE_URL)('active-testing phase (integration)', () => {
  let client: DbClient;
  let fixtureServer: { server: Server; port: number };
  let organizationId: string;
  let projectId: string;

  const baseConfig: Omit<AppConfig, 'security'> & {
    security: Omit<AppConfig['security'], 'activeTestingDefaultRequestBudget'>;
  } = {
    nodeEnv: 'test',
    appEnv: 'test',
    appName: 'worker-active-testing-integration-test',
    isProduction: false,
    isDevelopment: false,
    isTest: true,
    logLevel: 'silent',
    api: { port: 4000 },
    urls: {
      publicAppUrl: 'http://localhost',
      publicApiUrl: 'http://localhost',
      internalApiUrl: 'http://localhost',
    },
    database: { url: DATABASE_URL ?? '' },
    redis: { url: '' },
    auth: { jwtSecret: 'x'.repeat(32), jwtExpiresIn: '15m' },
    security: {
      credentialMasterKey: 'y'.repeat(32),
      ssrfAllowPrivateRanges: true,
      allowedScanPorts: [80, 443],
      scanTimeoutMs: 5000,
      maxResponseBytes: 1_000_000,
      workerConcurrency: 2,
      connectTimeoutMs: 2000,
      maxRedirects: 3,
      maxHeaderBytes: 32_768,
      maxRequestsPerAssessment: 20,
      activeTestingMaxConcurrentRequests: 2,
      activeTestingRequestsPerSecond: 50,
    },
    ai: { enabled: false },
  };

  function configWithBudget(activeTestingDefaultRequestBudget: number): AppConfig {
    return {
      ...baseConfig,
      security: { ...baseConfig.security, activeTestingDefaultRequestBudget },
    };
  }

  function buildProcessor(
    activeTestRegistry: readonly ActiveTestDefinition[],
    requestBudget: number,
  ) {
    return createAssessmentJobProcessor({
      db: client.db,
      logger: noopLogger() as unknown as Parameters<
        typeof createAssessmentJobProcessor
      >[0]['logger'],
      config: configWithBudget(requestBudget),
      scannerRegistry: [NOOP_SCANNER],
      activeTestRegistry,
    });
  }

  beforeAll(async () => {
    client = createDbClient(DATABASE_URL as string, { maxConnections: 5 });

    let requestCount = 0;
    fixtureServer = await startServer((req, res) => {
      requestCount += 1;
      const url = new URL(req.url ?? '/', 'http://localhost');
      const q = url.searchParams.get('q') ?? '';
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<html><body>request ${requestCount}; query was: ${q}</body></html>`);
    });

    const [org] = await client.db
      .insert(schema.organizations)
      .values({ name: 'Active Testing IT Org', slug: `active-testing-it-${randomUUID()}` })
      .returning();
    organizationId = org!.id;
    const [project] = await client.db
      .insert(schema.projects)
      .values({ organizationId, name: 'Active Testing IT Project', slug: `proj-${randomUUID()}` })
      .returning();
    projectId = project!.id;
  });

  afterAll(async () => {
    fixtureServer.server.close();
    await client.close();
  });

  async function createAssetAndAssessment(baseUrl: string) {
    const [asset] = await client.db
      .insert(schema.assets)
      .values({
        projectId,
        assetType: 'WEB',
        name: 'Active testing fixture asset',
        authorizationConfirmed: true,
        config: { baseUrl },
      })
      .returning();
    const [assessment] = await client.db
      .insert(schema.assessments)
      .values({
        projectId,
        assetId: asset!.id,
        assessmentType: 'WEB',
        status: 'QUEUED',
        scope: buildWebAssetScope({ baseUrl }),
      })
      .returning();
    const [job] = await client.db
      .insert(schema.assessmentJobs)
      .values({ assessmentId: assessment!.id, jobType: 'WEB' })
      .returning();
    return { asset: asset!, assessment: assessment!, job: job! };
  }

  async function seedDiscoveredPage(assessmentId: string, url: string) {
    await client.db.insert(schema.discoveredUrls).values({
      assessmentId,
      url,
      urlType: 'PAGE',
      discoveryMethod: 'SEED',
      depth: 0,
      statusCode: 200,
      contentType: 'text/html',
    });
  }

  it('runs baseline + mutation through the real pipeline, persists a finding via the existing finding/evidence model, and keeps the overall assessment COMPLETED', async () => {
    const baseUrl = `http://127.0.0.1:${fixtureServer.port}/`;
    const { assessment, job } = await createAssetAndAssessment(baseUrl);
    await seedDiscoveredPage(assessment.id, `${baseUrl}search`);

    const processor = buildProcessor([REFLECTION_FIXTURE], 50);
    await processor(
      fakeJob({ assessmentJobId: job.id, assessmentId: assessment.id, scannerName: 'WEB' }),
    );

    const [finalAssessment] = await client.db
      .select()
      .from(schema.assessments)
      .where(eq(schema.assessments.id, assessment.id));
    expect(finalAssessment?.status).toBe('COMPLETED');

    const [plan] = await client.db
      .select()
      .from(schema.activeTestPlans)
      .where(eq(schema.activeTestPlans.assessmentId, assessment.id));
    expect(plan?.status).toBe('COMPLETED');
    expect(plan?.testsSelectedCount).toBe(1);
    expect(plan?.testsCompletedCount).toBe(1);
    expect(plan?.requestsUsed).toBe(2); // one baseline + one mutation

    const executions = await client.db
      .select()
      .from(schema.activeTestExecutions)
      .where(eq(schema.activeTestExecutions.assessmentId, assessment.id));
    expect(executions).toHaveLength(1);
    expect(executions[0]?.testId).toBe('TEST-REFLECTION-FIXTURE');
    expect(executions[0]?.status).toBe('COMPLETED');

    // The finding was persisted through the SAME finding/evidence pipeline
    // every other scanner uses — not a second, parallel finding system.
    const findings = await client.db
      .select()
      .from(schema.findings)
      .where(eq(schema.findings.assessmentId, assessment.id));
    const activeTestFinding = findings.find((f) => f.category === 'active-test');
    expect(activeTestFinding).toBeDefined();
    expect(activeTestFinding?.scanner).toBe('active-testing');
    expect(activeTestFinding?.key).toBe('TEST-REFLECTION-FIXTURE:reflected-marker');
    expect(activeTestFinding?.fingerprint).toMatch(/^[0-9a-f]{64}$/);

    // Evidence is sanitized/structured facts only — never a raw secret or
    // the full response body.
    const evidenceRows = await client.db
      .select()
      .from(schema.evidence)
      .where(eq(schema.evidence.findingId, activeTestFinding!.id));
    expect(evidenceRows).toHaveLength(1);
    expect(JSON.stringify(evidenceRows[0]?.data)).not.toContain('Authorization');
  });

  it('reports no finding when the marker is never reflected', async () => {
    const baseUrl = `http://127.0.0.1:${fixtureServer.port}/`;
    const { assessment, job } = await createAssetAndAssessment(baseUrl);
    await seedDiscoveredPage(assessment.id, `${baseUrl}search`);

    const neverReflects: ActiveTestDefinition = {
      ...REFLECTION_FIXTURE,
      id: 'TEST-NEVER-REFLECTS',
      mutations: () => [{ kind: 'query-param', name: 'q', value: 'harmless-value' }],
    };
    const processor = buildProcessor([neverReflects], 50);
    await processor(
      fakeJob({ assessmentJobId: job.id, assessmentId: assessment.id, scannerName: 'WEB' }),
    );

    const findings = await client.db
      .select()
      .from(schema.findings)
      .where(eq(schema.findings.assessmentId, assessment.id));
    expect(findings.filter((f) => f.category === 'active-test')).toHaveLength(0);

    const executions = await client.db
      .select()
      .from(schema.activeTestExecutions)
      .where(eq(schema.activeTestExecutions.assessmentId, assessment.id));
    expect(executions).toHaveLength(1);
    expect(executions[0]?.status).toBe('COMPLETED');
  });

  it('stops immediately once the shared request budget is exhausted, marking it BUDGET_EXHAUSTED rather than silently completing', async () => {
    const baseUrl = `http://127.0.0.1:${fixtureServer.port}/`;
    const { assessment, job } = await createAssetAndAssessment(baseUrl);
    // Three baseline targets x 2 requests each would need 6 — a budget of 2
    // only ever allows the first pair through.
    await seedDiscoveredPage(assessment.id, `${baseUrl}a`);
    await seedDiscoveredPage(assessment.id, `${baseUrl}b`);
    await seedDiscoveredPage(assessment.id, `${baseUrl}c`);

    const processor = buildProcessor([REFLECTION_FIXTURE], 2);
    await processor(
      fakeJob({ assessmentJobId: job.id, assessmentId: assessment.id, scannerName: 'WEB' }),
    );

    const [finalAssessment] = await client.db
      .select()
      .from(schema.assessments)
      .where(eq(schema.assessments.id, assessment.id));
    // Budget exhaustion in this additive phase must never fail the overall
    // assessment — discovery/passive analysis remain authoritative.
    expect(finalAssessment?.status).toBe('COMPLETED');

    const [plan] = await client.db
      .select()
      .from(schema.activeTestPlans)
      .where(eq(schema.activeTestPlans.assessmentId, assessment.id));
    expect(plan?.status).toBe('BUDGET_EXHAUSTED');
    expect(plan?.requestsUsed).toBeLessThanOrEqual(2);

    const executions = await client.db
      .select()
      .from(schema.activeTestExecutions)
      .where(eq(schema.activeTestExecutions.assessmentId, assessment.id));
    expect(executions).toHaveLength(3);
    const statuses = executions.map((e) => e.status).sort();
    expect(statuses).toEqual(['BUDGET_EXHAUSTED', 'BUDGET_EXHAUSTED', 'COMPLETED']);
  });

  it('is idempotent: re-processing the same job never creates a second plan or duplicate executions/findings', async () => {
    const baseUrl = `http://127.0.0.1:${fixtureServer.port}/`;
    const { assessment, job } = await createAssetAndAssessment(baseUrl);
    await seedDiscoveredPage(assessment.id, `${baseUrl}search`);

    const processor = buildProcessor([REFLECTION_FIXTURE], 50);
    await processor(
      fakeJob({ assessmentJobId: job.id, assessmentId: assessment.id, scannerName: 'WEB' }),
    );

    const plansAfterFirstRun = await client.db
      .select()
      .from(schema.activeTestPlans)
      .where(eq(schema.activeTestPlans.assessmentId, assessment.id));
    expect(plansAfterFirstRun).toHaveLength(1);

    // The assessment is now COMPLETED, so the processor's own pre-existing
    // "already terminal" guard drops a second delivery before this phase is
    // even reached — this proves that guard still protects the new phase too.
    await processor(
      fakeJob({ assessmentJobId: job.id, assessmentId: assessment.id, scannerName: 'WEB' }),
    );

    const plansAfterSecondDelivery = await client.db
      .select()
      .from(schema.activeTestPlans)
      .where(eq(schema.activeTestPlans.assessmentId, assessment.id));
    expect(plansAfterSecondDelivery).toHaveLength(1);
    expect(plansAfterSecondDelivery[0]?.id).toBe(plansAfterFirstRun[0]?.id);

    const executions = await client.db
      .select()
      .from(schema.activeTestExecutions)
      .where(eq(schema.activeTestExecutions.assessmentId, assessment.id));
    expect(executions).toHaveLength(1);

    const findings = await client.db
      .select()
      .from(schema.findings)
      .where(eq(schema.findings.assessmentId, assessment.id));
    expect(findings.filter((f) => f.category === 'active-test')).toHaveLength(1);
  });

  it('records an honest SKIPPED plan when zero active test definitions are registered (the production default)', async () => {
    const baseUrl = `http://127.0.0.1:${fixtureServer.port}/`;
    const { assessment, job } = await createAssetAndAssessment(baseUrl);
    await seedDiscoveredPage(assessment.id, `${baseUrl}search`);

    const processor = buildProcessor([], 50);
    await processor(
      fakeJob({ assessmentJobId: job.id, assessmentId: assessment.id, scannerName: 'WEB' }),
    );

    const [finalAssessment] = await client.db
      .select()
      .from(schema.assessments)
      .where(eq(schema.assessments.id, assessment.id));
    expect(finalAssessment?.status).toBe('COMPLETED');

    const [plan] = await client.db
      .select()
      .from(schema.activeTestPlans)
      .where(eq(schema.activeTestPlans.assessmentId, assessment.id));
    expect(plan?.status).toBe('SKIPPED');
    expect(plan?.testsSelectedCount).toBe(0);

    const executions = await client.db
      .select()
      .from(schema.activeTestExecutions)
      .where(eq(schema.activeTestExecutions.assessmentId, assessment.id));
    expect(executions).toHaveLength(0);
  });
});
