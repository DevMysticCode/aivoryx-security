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
import type { ScannerPlugin } from '@aivoryx/scanner-core';
import { ACTIVE_TEST_REGISTRY } from '@aivoryx/scanner-active-xss';
import { createAssessmentJobProcessor } from './assessment-processor.js';

// Requires live PostgreSQL with migrations applied through 0006 — see
// assessment-processor.integration.test.ts's header for exact run
// instructions. No Redis needed: the processor is invoked directly with a
// fake BullMQ Job, exactly like active-testing-phase.integration.test.ts,
// avoiding a second worker instance racing for jobs on the shared queue.
//
// This file proves Batch 9's PRODUCTION registry (@aivoryx/scanner-active-xss's
// ACTIVE_TEST_REGISTRY — the real thing apps/worker/src/index.ts ships, not
// a test-only fixture) end to end against a local HTTP fixture with both a
// vulnerable and a non-vulnerable endpoint. Never contacts the public
// internet.
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

/** Enough to let the main scanner-plugin loop succeed so the active-testing phase (which runs after it) is reached — this file tests the XSS scanner, not web-discovery, so discovered_urls are seeded directly. */
const NOOP_SCANNER: ScannerPlugin = {
  name: 'noop',
  supportedAssetTypes: ['WEB'],
  supportedAssessmentTypes: ['WEB'],
  requiredCapabilities: ['http-egress'],
  run: async () => {},
};

function htmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

let requestLog: string[] = [];

function buildFixtureServer() {
  return startServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    requestLog.push(url.pathname + url.search);
    const q = url.searchParams.get('q') ?? '';

    if (url.pathname === '/vuln') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<html><body><script>var x = "${q}";</script></body></html>`);
      return;
    }
    if (url.pathname === '/safe') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<html><body><div>${htmlEscape(q)}</div></body></html>`);
      return;
    }
    if (url.pathname === '/api') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ q }));
      return;
    }
    if (url.pathname === '/noparams') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body>static page, no query parameters</body></html>');
      return;
    }
    res.writeHead(404);
    res.end();
  });
}

describe.skipIf(!DATABASE_URL)('reflected XSS scanner (integration)', () => {
  let client: DbClient;
  let fixtureServer: { server: Server; port: number };
  let organizationId: string;
  let projectId: string;

  const baseConfig: Omit<AppConfig, 'security'> & {
    security: Omit<AppConfig['security'], 'activeTestingDefaultRequestBudget'>;
  } = {
    nodeEnv: 'test',
    appEnv: 'test',
    appName: 'worker-active-xss-integration-test',
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

  function buildProcessor(requestBudget: number) {
    return createAssessmentJobProcessor({
      db: client.db,
      logger: noopLogger() as unknown as Parameters<
        typeof createAssessmentJobProcessor
      >[0]['logger'],
      config: configWithBudget(requestBudget),
      scannerRegistry: [NOOP_SCANNER],
      activeTestRegistry: ACTIVE_TEST_REGISTRY,
    });
  }

  beforeAll(async () => {
    client = createDbClient(DATABASE_URL as string, { maxConnections: 5 });
    fixtureServer = await buildFixtureServer();

    const [org] = await client.db
      .insert(schema.organizations)
      .values({ name: 'Active XSS IT Org', slug: `active-xss-it-${randomUUID()}` })
      .returning();
    organizationId = org!.id;
    const [project] = await client.db
      .insert(schema.projects)
      .values({ organizationId, name: 'Active XSS IT Project', slug: `proj-${randomUUID()}` })
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
        name: 'XSS fixture asset',
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

  it('finds reflected XSS on the vulnerable endpoint, does not false-positive on the safe/JSON/no-param endpoints, and issues exactly the expected number of requests', async () => {
    const baseUrl = `http://127.0.0.1:${fixtureServer.port}`;
    const { assessment, job } = await createAssetAndAssessment(`${baseUrl}/`);
    await seedDiscoveredPage(assessment.id, `${baseUrl}/vuln?q=x`);
    await seedDiscoveredPage(assessment.id, `${baseUrl}/safe?q=x`);
    await seedDiscoveredPage(assessment.id, `${baseUrl}/api?q=x`);
    await seedDiscoveredPage(assessment.id, `${baseUrl}/noparams`);

    requestLog = [];
    const processor = buildProcessor(50);
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

    // /vuln (1 baseline + 1 mutation) + /safe (1+1) + /api (1+1) + /noparams
    // (1 baseline only, zero query params to mutate) = 7. Never dozens.
    expect(requestLog.length).toBe(7);
    expect(plan?.requestsUsed).toBe(7);

    const findings = await client.db
      .select()
      .from(schema.findings)
      .where(eq(schema.findings.assessmentId, assessment.id));
    const xssFindings = findings.filter((f) => f.category === 'active-test');
    // /vuln (HIGH, raw script-context) and /safe (LOW, HTML-encoded — still
    // reported, just low confidence) each produce exactly one finding;
    // /api (JSON) and /noparams (no reflection possible) produce none.
    expect(xssFindings).toHaveLength(2);

    const vulnFinding = xssFindings.find((f) => f.target.includes('/vuln'));
    expect(vulnFinding).toBeDefined();
    expect(vulnFinding?.severity).toBe('HIGH');
    expect(vulnFinding?.confidence).toBe('HIGH');
    expect(vulnFinding?.scanner).toBe('active-testing');
    expect(vulnFinding?.key).toBe('WEB-REFLECTED-XSS:reflected-xss:q');
    expect(vulnFinding?.fingerprint).toMatch(/^[0-9a-f]{64}$/);

    const safeFinding = xssFindings.find((f) => f.target.includes('/safe'));
    expect(safeFinding).toBeDefined();
    expect(safeFinding?.severity).toBe('LOW');
    expect(safeFinding?.confidence).toBe('LOW');

    // Evidence is sanitized/bounded — never the full response body, never secrets.
    const evidenceRows = await client.db
      .select()
      .from(schema.evidence)
      .where(eq(schema.evidence.findingId, vulnFinding!.id));
    expect(evidenceRows).toHaveLength(1);
    const evidenceJson = JSON.stringify(evidenceRows[0]?.data);
    expect(evidenceJson.length).toBeLessThan(4000);
    expect(evidenceJson).not.toContain('Authorization');

    // The execution rows reflect real per-URL summaries, not fabricated data.
    const executions = await client.db
      .select()
      .from(schema.activeTestExecutions)
      .where(eq(schema.activeTestExecutions.assessmentId, assessment.id));
    expect(executions).toHaveLength(4);
    const noParamsExecution = executions.find((e) => e.target.includes('/noparams'));
    expect(noParamsExecution?.requestsUsed).toBe(1);
  });

  it('stops immediately once the shared request budget is exhausted — never issues dozens/hundreds of requests regardless of how many parameters exist', async () => {
    const baseUrl = `http://127.0.0.1:${fixtureServer.port}`;
    const { assessment, job } = await createAssetAndAssessment(`${baseUrl}/`);
    // Five URLs each needing 2 requests would need 10 — a budget of 3 must
    // stop well short of that, never silently completing as if nothing was
    // limited.
    for (let i = 0; i < 5; i += 1) {
      await seedDiscoveredPage(assessment.id, `${baseUrl}/vuln?q=${i}`);
    }

    requestLog = [];
    const processor = buildProcessor(3);
    await processor(
      fakeJob({ assessmentJobId: job.id, assessmentId: assessment.id, scannerName: 'WEB' }),
    );

    const [plan] = await client.db
      .select()
      .from(schema.activeTestPlans)
      .where(eq(schema.activeTestPlans.assessmentId, assessment.id));
    expect(plan?.status).toBe('BUDGET_EXHAUSTED');
    expect(plan?.requestsUsed).toBeLessThanOrEqual(3);
    expect(requestLog.length).toBeLessThanOrEqual(3);

    const [finalAssessment] = await client.db
      .select()
      .from(schema.assessments)
      .where(eq(schema.assessments.id, assessment.id));
    // Budget exhaustion in this additive phase never fails the overall assessment.
    expect(finalAssessment?.status).toBe('COMPLETED');
  });

  it('is idempotent: re-processing the same job never creates duplicate findings or execution rows', async () => {
    const baseUrl = `http://127.0.0.1:${fixtureServer.port}`;
    const { assessment, job } = await createAssetAndAssessment(`${baseUrl}/`);
    await seedDiscoveredPage(assessment.id, `${baseUrl}/vuln?q=x`);

    const processor = buildProcessor(50);
    await processor(
      fakeJob({ assessmentJobId: job.id, assessmentId: assessment.id, scannerName: 'WEB' }),
    );
    // Assessment is now COMPLETED — the processor's own pre-existing guard
    // drops a second delivery before the active-testing phase is reached.
    await processor(
      fakeJob({ assessmentJobId: job.id, assessmentId: assessment.id, scannerName: 'WEB' }),
    );

    const findings = await client.db
      .select()
      .from(schema.findings)
      .where(eq(schema.findings.assessmentId, assessment.id));
    expect(findings.filter((f) => f.category === 'active-test')).toHaveLength(1);

    const executions = await client.db
      .select()
      .from(schema.activeTestExecutions)
      .where(eq(schema.activeTestExecutions.assessmentId, assessment.id));
    expect(executions).toHaveLength(1);
  });
});
