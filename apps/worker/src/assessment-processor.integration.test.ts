import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import type { Queue, Worker } from 'bullmq';
import { createDbClient, schema, type DbClient } from '@aivoryx/db';
import {
  createRedisConnection,
  createQueue,
  createQueueWorker,
  QUEUE_NAMES,
  type AssessmentJobData,
} from '@aivoryx/queue';
import type { AppConfig } from '@aivoryx/config';
import { buildWebAssetScope, type AssessmentScope } from '@aivoryx/shared-types';
import { SCANNER_REGISTRY } from '@aivoryx/scanner-http-reachability';
import { createAssessmentJobProcessor } from './assessment-processor.js';

// Requires live PostgreSQL + Redis with the Batch 4 migration applied. Run via:
//   pnpm infra:up
//   node --env-file=.env packages/db/dist/migrate-cli.js
//   TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/aivoryx \
//   TEST_REDIS_URL=redis://localhost:6379 \
//     pnpm --filter @aivoryx/worker test:integration
const DATABASE_URL = process.env.TEST_DATABASE_URL;
const REDIS_URL = process.env.TEST_REDIS_URL;

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

describe.skipIf(!DATABASE_URL || !REDIS_URL)('assessment-processor (integration)', () => {
  let client: DbClient;
  let connection: Redis;
  let queue: Queue<AssessmentJobData>;
  let worker: Worker<AssessmentJobData>;
  let fixtureServer: { server: Server; port: number };
  let organizationId: string;
  let projectId: string;

  const config: AppConfig = {
    nodeEnv: 'test',
    appEnv: 'test',
    appName: 'worker-integration-test',
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
    redis: { url: REDIS_URL ?? '' },
    auth: { jwtSecret: 'x'.repeat(32), jwtExpiresIn: '15m' },
    security: {
      credentialMasterKey: 'y'.repeat(32),
      // Test-only: the local fixture server is on 127.0.0.1, which the real
      // SSRF policy would otherwise reject. Production can never set this
      // (enforced in packages/config's schema). See Part W.
      ssrfAllowPrivateRanges: true,
      allowedScanPorts: [80, 443],
      scanTimeoutMs: 5000,
      maxResponseBytes: 1_000_000,
      workerConcurrency: 2,
      connectTimeoutMs: 2000,
      maxRedirects: 3,
      maxHeaderBytes: 32_768,
      maxRequestsPerAssessment: 20,
    },
    ai: { enabled: false },
  };

  beforeAll(async () => {
    client = createDbClient(DATABASE_URL as string, { maxConnections: 5 });
    connection = createRedisConnection(REDIS_URL as string);
    queue = createQueue(QUEUE_NAMES.ASSESSMENT_JOBS, connection);

    fixtureServer = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
    });

    const processor = createAssessmentJobProcessor({
      db: client.db,
      logger: noopLogger() as unknown as Parameters<
        typeof createAssessmentJobProcessor
      >[0]['logger'],
      config,
      scannerRegistry: SCANNER_REGISTRY,
    });
    worker = createQueueWorker(QUEUE_NAMES.ASSESSMENT_JOBS, processor, connection, {
      concurrency: 2,
    });

    const [org] = await client.db
      .insert(schema.organizations)
      .values({ name: 'Worker IT Org', slug: `worker-it-${randomUUID()}` })
      .returning();
    organizationId = org!.id;
    const [project] = await client.db
      .insert(schema.projects)
      .values({ organizationId, name: 'Worker IT Project', slug: `proj-${randomUUID()}` })
      .returning();
    projectId = project!.id;
  });

  afterAll(async () => {
    await worker.close();
    await queue.close();
    fixtureServer.server.close();
    await connection.quit();
    await client.close();
  });

  async function createAsset(
    overrides: {
      authorizationConfirmed?: boolean;
      baseUrl?: string;
      assetType?: 'WEB' | 'ANDROID';
    } = {},
  ) {
    const assetType = overrides.assetType ?? 'WEB';
    const baseUrl = overrides.baseUrl ?? `http://127.0.0.1:${fixtureServer.port}/`;
    const [asset] = await client.db
      .insert(schema.assets)
      .values({
        projectId,
        assetType,
        name: 'Test asset',
        authorizationConfirmed: overrides.authorizationConfirmed ?? true,
        config: assetType === 'WEB' ? { baseUrl } : { packageName: 'com.example.smoke' },
      })
      .returning();
    return asset!;
  }

  async function createAssessment(
    assetId: string,
    config: { baseUrl: string },
    options: { scope?: AssessmentScope; assessmentType?: 'WEB' | 'ANDROID_STATIC' } = {},
  ) {
    const assessmentType = options.assessmentType ?? 'WEB';
    const [assessment] = await client.db
      .insert(schema.assessments)
      .values({
        projectId,
        assetId,
        assessmentType,
        status: 'QUEUED',
        scope: options.scope ?? buildWebAssetScope(config),
      })
      .returning();
    const [job] = await client.db
      .insert(schema.assessmentJobs)
      .values({ assessmentId: assessment!.id, jobType: assessmentType })
      .returning();
    return { assessment: assessment!, job: job! };
  }

  async function runAndWaitForTerminalStatus(assessmentId: string, timeoutMs = 10_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const [row] = await client.db
        .select()
        .from(schema.assessments)
        .where(eq(schema.assessments.id, assessmentId))
        .limit(1);
      if (row && row.status !== 'QUEUED' && row.status !== 'RUNNING') return row;
      if (Date.now() > deadline)
        throw new Error('Timed out waiting for assessment to reach a terminal status');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  it('runs the full pipeline end to end: enqueue -> worker -> scanner -> findings persisted -> COMPLETED', async () => {
    const asset = await createAsset();
    const { assessment, job } = await createAssessment(asset.id, {
      baseUrl: asset.config.baseUrl as string,
    });

    await queue.add('assessment', {
      assessmentJobId: job.id,
      assessmentId: assessment.id,
      scannerName: 'WEB',
    });

    const finalAssessment = await runAndWaitForTerminalStatus(assessment.id);
    expect(finalAssessment?.status).toBe('COMPLETED');

    const findings = await client.db
      .select()
      .from(schema.findings)
      .where(eq(schema.findings.assessmentId, assessment.id));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('INFO');
    expect(findings[0]?.category).toBe('reachability');

    const evidenceRows = await client.db
      .select()
      .from(schema.evidence)
      .where(eq(schema.evidence.findingId, findings[0]!.id));
    expect(evidenceRows).toHaveLength(1);
    expect(JSON.stringify(evidenceRows[0]?.data)).not.toContain('Authorization');
  });

  it('refuses to execute an assessment whose asset authorization was revoked after enqueue', async () => {
    const asset = await createAsset({ authorizationConfirmed: false });
    const { assessment, job } = await createAssessment(asset.id, {
      baseUrl: asset.config.baseUrl as string,
    });

    await queue.add('assessment', {
      assessmentJobId: job.id,
      assessmentId: assessment.id,
      scannerName: 'WEB',
    });

    const finalAssessment = await runAndWaitForTerminalStatus(assessment.id);
    expect(finalAssessment?.status).toBe('FAILED');
    expect(finalAssessment?.errorMessage).toMatch(/authorization/i);
  });

  it('fails an assessment whose scope does not include the target host, without retry-looping', async () => {
    const asset = await createAsset();
    const wrongScope: AssessmentScope = {
      schemes: ['http', 'https'],
      hosts: ['not-the-real-host.example.com'],
      ports: [80, 443],
      allowedPathPrefixes: [],
      exclusions: { hosts: [], paths: [] },
    };
    const { assessment, job } = await createAssessment(
      asset.id,
      { baseUrl: asset.config.baseUrl as string },
      { scope: wrongScope },
    );

    await queue.add('assessment', {
      assessmentJobId: job.id,
      assessmentId: assessment.id,
      scannerName: 'WEB',
    });

    const finalAssessment = await runAndWaitForTerminalStatus(assessment.id);
    expect(finalAssessment?.status).toBe('FAILED');
    expect(finalAssessment?.errorMessage).toMatch(/scope/i);
  });

  it('fails an assessment type with no implemented scanner instead of completing with zero findings', async () => {
    // ANDROID assets carry no baseUrl — apps/api's computeScopeForAsset()
    // falls back to this same empty scope for asset types it can't derive a
    // baseUrl-driven scope from (mirrored here rather than through the API).
    const emptyScope: AssessmentScope = {
      schemes: [],
      hosts: [],
      ports: [],
      allowedPathPrefixes: [],
      exclusions: { hosts: [], paths: [] },
    };
    const asset = await createAsset({ assetType: 'ANDROID' });
    const { assessment, job } = await createAssessment(
      asset.id,
      { baseUrl: '' },
      { assessmentType: 'ANDROID_STATIC', scope: emptyScope },
    );

    await queue.add('assessment', {
      assessmentJobId: job.id,
      assessmentId: assessment.id,
      scannerName: 'ANDROID_STATIC',
    });

    const finalAssessment = await runAndWaitForTerminalStatus(assessment.id);
    expect(finalAssessment?.status).toBe('FAILED');
    expect(finalAssessment?.errorMessage).toMatch(/UNSUPPORTED_ASSESSMENT_TYPE/);

    // No findings were fabricated — the assessment never actually ran.
    const findings = await client.db
      .select()
      .from(schema.findings)
      .where(eq(schema.findings.assessmentId, assessment.id));
    expect(findings).toHaveLength(0);

    // Permanent failure: exactly one attempt was made, never retried into a loop.
    const [jobRow] = await client.db
      .select()
      .from(schema.assessmentJobs)
      .where(eq(schema.assessmentJobs.id, job.id))
      .limit(1);
    expect(jobRow?.attemptCount).toBe(1);
    expect(jobRow?.status).toBe('FAILED');
  });

  it('skips a duplicate job delivery for an assessment that already reached a terminal state', async () => {
    const asset = await createAsset();
    const { assessment, job } = await createAssessment(asset.id, {
      baseUrl: asset.config.baseUrl as string,
    });

    await queue.add('assessment', {
      assessmentJobId: job.id,
      assessmentId: assessment.id,
      scannerName: 'WEB',
    });
    await runAndWaitForTerminalStatus(assessment.id);

    // A second, duplicate delivery for the same (now-COMPLETED) assessment
    // must be a safe no-op, not re-run the scanner or create a second finding.
    await queue.add('assessment', {
      assessmentJobId: job.id,
      assessmentId: assessment.id,
      scannerName: 'WEB',
    });
    await new Promise((resolve) => setTimeout(resolve, 500));

    const findings = await client.db
      .select()
      .from(schema.findings)
      .where(eq(schema.findings.assessmentId, assessment.id));
    expect(findings).toHaveLength(1);
  });
});
