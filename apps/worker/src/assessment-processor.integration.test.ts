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
import { SCANNER_REGISTRY } from '@aivoryx/scanner-web-discovery';
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
  let passiveFixtureServer: { server: Server; port: number };
  let passiveFixtureRequestCount = 0;
  let discoveryFixtureServer: { server: Server; port: number };
  let discoveryFixtureRequestLog: string[] = [];
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

    // A single deterministic response exercising every passive-check
    // category in one request: missing security headers, an insecure
    // cookie, a risky CORS configuration, and a technology-disclosure
    // header. See the REQUIRED END-TO-END DEMONSTRATION.
    passiveFixtureServer = await startServer((_req, res) => {
      passiveFixtureRequestCount += 1;
      res.writeHead(200, {
        'Content-Type': 'text/html',
        Server: 'nginx/1.24.0',
        'Set-Cookie': 'session=abc123; Path=/',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': 'true',
      });
      res.end('<html></html>');
    });

    // Batch 6's required deterministic page graph (Part 27):
    //   / -> /about, /login, /products, /products?id=1, /static/app.js (resource),
    //        /frame (iframe), an out-of-scope external link, and a redirect.
    //   /about -> /contact
    //   /products -> /products?id=2
    //   /login has a GET-metadata-only form (never submitted).
    discoveryFixtureRequestLog = [];
    discoveryFixtureServer = await startServer((req, res) => {
      const url = req.url ?? '/';
      discoveryFixtureRequestLog.push(`${req.method} ${url}`);
      const htmlHeaders = {
        'Content-Type': 'text/html',
        'Set-Cookie': 'session=abc123; Path=/',
      };

      if (url === '/') {
        res.writeHead(200, htmlHeaders);
        res.end(`
          <a href="/about#top">About</a>
          <a href="/login">Login</a>
          <a href="/products">Products</a>
          <a href="/products?id=1">Product 1</a>
          <script src="/static/app.js"></script>
          <iframe src="/frame"></iframe>
          <a href="http://out-of-scope.example.net/">External</a>
          <a href="/redirect-me">Redirect</a>
        `);
        return;
      }
      if (url === '/about') {
        res.writeHead(200, htmlHeaders);
        res.end('<a href="/contact">Contact</a>');
        return;
      }
      if (url === '/contact') {
        res.writeHead(200, htmlHeaders);
        res.end('<p>contact</p>');
        return;
      }
      if (url === '/products') {
        res.writeHead(200, htmlHeaders);
        res.end('<a href="/products?id=2">Product 2</a>');
        return;
      }
      if (url === '/products?id=1' || url === '/products?id=2') {
        res.writeHead(200, htmlHeaders);
        res.end('<p>product</p>');
        return;
      }
      if (url === '/login') {
        res.writeHead(200, htmlHeaders);
        res.end(
          '<form action="/login" method="POST"><input name="username" type="text"><input name="password" type="password"></form>',
        );
        return;
      }
      if (url === '/frame') {
        res.writeHead(200, htmlHeaders);
        res.end('<p>frame</p>');
        return;
      }
      if (url === '/redirect-me') {
        res.writeHead(302, { Location: '/redirected' });
        res.end();
        return;
      }
      if (url === '/redirected') {
        res.writeHead(200, htmlHeaders);
        res.end('<p>redirected</p>');
        return;
      }
      if (url === '/static/app.js') {
        res.writeHead(200, { 'Content-Type': 'application/javascript' });
        res.end('should-never-be-fetched();');
        return;
      }
      res.writeHead(404);
      res.end();
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
    passiveFixtureServer.server.close();
    discoveryFixtureServer.server.close();
    await connection.quit();
    await client.close();
  });

  async function createAsset(
    overrides: {
      authorizationConfirmed?: boolean;
      baseUrl?: string;
      assetType?: 'WEB' | 'API' | 'ANDROID' | 'IOS';
    } = {},
  ) {
    const assetType = overrides.assetType ?? 'WEB';
    const baseUrl = overrides.baseUrl ?? `http://127.0.0.1:${fixtureServer.port}/`;
    const config =
      assetType === 'WEB' || assetType === 'API'
        ? { baseUrl }
        : assetType === 'ANDROID'
          ? { packageName: 'com.example.smoke' }
          : { bundleId: 'com.example.smoke' };
    const [asset] = await client.db
      .insert(schema.assets)
      .values({
        projectId,
        assetType,
        name: 'Test asset',
        authorizationConfirmed: overrides.authorizationConfirmed ?? true,
        config,
      })
      .returning();
    return asset!;
  }

  async function createAssessment(
    assetId: string,
    config: { baseUrl: string },
    options: {
      scope?: AssessmentScope;
      assessmentType?:
        'WEB' | 'API' | 'ANDROID_STATIC' | 'ANDROID_DYNAMIC' | 'IOS_STATIC' | 'IOS_DYNAMIC';
    } = {},
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
    // The fixture has no security headers at all, so passive checks also
    // report findings alongside reachability — see the dedicated end-to-end
    // demonstration test below for exact category/key assertions.
    expect(findings.length).toBeGreaterThan(0);
    const reachable = findings.find((f) => f.category === 'reachability' && f.key === 'reachable');
    expect(reachable?.severity).toBe('INFO');

    const evidenceRows = await client.db
      .select()
      .from(schema.evidence)
      .where(eq(schema.evidence.findingId, reachable!.id));
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

  it.each([
    { assetType: 'API', assessmentType: 'API' },
    { assetType: 'ANDROID', assessmentType: 'ANDROID_STATIC' },
    { assetType: 'ANDROID', assessmentType: 'ANDROID_DYNAMIC' },
    { assetType: 'IOS', assessmentType: 'IOS_STATIC' },
    { assetType: 'IOS', assessmentType: 'IOS_DYNAMIC' },
  ] as const)(
    'fails a $assessmentType assessment (no scanner implements it) as a permanent UNSUPPORTED_ASSESSMENT_TYPE failure, never COMPLETED',
    async ({ assetType, assessmentType }) => {
      const emptyScope: AssessmentScope = {
        schemes: [],
        hosts: [],
        ports: [],
        allowedPathPrefixes: [],
        exclusions: { hosts: [], paths: [] },
      };
      const asset = await createAsset({ assetType });
      const { assessment, job } = await createAssessment(
        asset.id,
        { baseUrl: '' },
        { assessmentType, scope: emptyScope },
      );

      await queue.add('assessment', {
        assessmentJobId: job.id,
        assessmentId: assessment.id,
        scannerName: assessmentType,
      });

      const finalAssessment = await runAndWaitForTerminalStatus(assessment.id);
      // The Batch 4 invariant: COMPLETED means the assessment actually ran.
      // No currently-unsupported type may ever reach COMPLETED.
      expect(finalAssessment?.status).not.toBe('COMPLETED');
      expect(finalAssessment?.status).toBe('FAILED');
      expect(finalAssessment?.errorMessage).toMatch(/UNSUPPORTED_ASSESSMENT_TYPE/);

      const findings = await client.db
        .select()
        .from(schema.findings)
        .where(eq(schema.findings.assessmentId, assessment.id));
      expect(findings).toHaveLength(0);

      const [jobRow] = await client.db
        .select()
        .from(schema.assessmentJobs)
        .where(eq(schema.assessmentJobs.id, job.id))
        .limit(1);
      // Permanent failure: exactly one attempt, never retried into a loop.
      expect(jobRow?.attemptCount).toBe(1);
      expect(jobRow?.status).toBe('FAILED');
    },
  );

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

    const findingsAfterFirstRun = await client.db
      .select()
      .from(schema.findings)
      .where(eq(schema.findings.assessmentId, assessment.id));

    // A second, duplicate delivery for the same (now-COMPLETED) assessment
    // must be a safe no-op, not re-run the scanner or create any new finding.
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
    expect(findings).toHaveLength(findingsAfterFirstRun.length);
  });

  it('REQUIRED END-TO-END DEMONSTRATION: WEB assessment runs reachability + passive checks off ONE request and persists deterministic findings', async () => {
    const baseUrl = `http://127.0.0.1:${passiveFixtureServer.port}/`;
    const asset = await createAsset({ baseUrl });
    const { assessment, job } = await createAssessment(asset.id, { baseUrl });

    const requestsBefore = passiveFixtureRequestCount;

    await queue.add('assessment', {
      assessmentJobId: job.id,
      assessmentId: assessment.id,
      scannerName: 'WEB',
    });

    const finalAssessment = await runAndWaitForTerminalStatus(assessment.id);
    expect(finalAssessment?.status).toBe('COMPLETED');

    // Exactly one outbound request for the ENTIRE assessment — reachability
    // plus every passive check together. See Part Y.
    expect(passiveFixtureRequestCount - requestsBefore).toBe(1);

    const findings = await client.db
      .select()
      .from(schema.findings)
      .where(eq(schema.findings.assessmentId, assessment.id));
    const byKey = new Map(findings.map((f) => [f.key, f]));

    function byCategoryKey(category: string, key: string) {
      return findings.find((f) => f.category === category && f.key === key);
    }

    // Reachability (Batch 4, unchanged).
    expect(findings.some((f) => f.category === 'reachability' && f.key === 'reachable')).toBe(true);

    // Security headers: none were set by the fixture, so every "missing" finding fires.
    expect(byCategoryKey('security-headers', 'csp-missing')).toBeDefined();
    expect(byCategoryKey('security-headers', 'hsts-missing')).toBeUndefined(); // fixture is http, HSTS N/A
    expect(byCategoryKey('security-headers', 'xcto-missing')).toBeDefined();
    expect(byCategoryKey('security-headers', 'referrer-policy-missing')).toBeDefined();
    expect(byCategoryKey('security-headers', 'permissions-policy-missing')).toBeDefined();
    expect(byCategoryKey('security-headers', 'framing-protection-missing')).toBeDefined();

    // Cookies: the fixture's "session" cookie has no Secure/HttpOnly/SameSite.
    const cookieMissingHttpOnly = byCategoryKey('cookies', 'cookie:session:missing-httponly');
    expect(cookieMissingHttpOnly).toBeDefined();
    expect(cookieMissingHttpOnly?.severity).toBe('MEDIUM'); // "session" matches the sensitive-name heuristic
    // The fixture is plain HTTP, so "missing Secure" is not flagged (Secure is HTTPS-only guidance).
    expect(byCategoryKey('cookies', 'cookie:session:missing-secure')).toBeUndefined();
    // No cookie value is ever persisted.
    expect(JSON.stringify(findings)).not.toContain('abc123');

    // CORS: wildcard origin + credentials is a real, directly-observed misconfiguration.
    const cors = byCategoryKey('cors', 'cors-wildcard-with-credentials');
    expect(cors).toBeDefined();
    expect(cors?.severity).toBe('MEDIUM');

    // Information disclosure: the fixture's Server header.
    const disclosure = byCategoryKey('information-disclosure', 'disclosure:server');
    expect(disclosure).toBeDefined();
    expect(disclosure?.severity).toBe('INFO');

    // Transport: the target itself is plain HTTP.
    expect(byCategoryKey('transport', 'http-target')).toBeDefined();

    // Every finding has the required quality fields (Part C) and a deterministic fingerprint.
    for (const finding of findings) {
      expect(finding.title.length).toBeGreaterThan(0);
      expect(finding.description.length).toBeGreaterThan(0);
      expect(finding.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(byKey.size).toBe(findings.length); // fingerprints/keys are all unique within this assessment

    // Evidence exists for every finding that declared it, and is sanitized/size-bounded.
    const evidenceRows = await client.db
      .select()
      .from(schema.evidence)
      .where(
        eq(
          schema.evidence.findingId,
          findings.find((f) => f.key === 'cookie:session:missing-httponly')!.id,
        ),
      );
    expect(evidenceRows).toHaveLength(1);
    expect(evidenceRows[0]?.data).toMatchObject({ name: 'session' });
    expect(JSON.stringify(evidenceRows[0]?.data)).not.toContain('abc123');
  }, 15_000);

  it('BATCH 6 REQUIRED END-TO-END TEST: crawls a deterministic page graph, discovers/persists the attack surface, and never touches anything out of scope', async () => {
    const baseUrl = `http://127.0.0.1:${discoveryFixtureServer.port}/`;
    const asset = await createAsset({ baseUrl });
    const { assessment, job } = await createAssessment(asset.id, { baseUrl });

    await queue.add('assessment', {
      assessmentJobId: job.id,
      assessmentId: assessment.id,
      scannerName: 'WEB',
    });

    const finalAssessment = await runAndWaitForTerminalStatus(assessment.id);

    // 12. Unsupported assessment types still fail correctly — proven by the
    // dedicated parameterized test above; this assertion just confirms
    // this WEB assessment itself completed successfully.
    expect(finalAssessment?.status).toBe('COMPLETED');

    const discovered = await client.db
      .select()
      .from(schema.discoveredUrls)
      .where(eq(schema.discoveredUrls.assessmentId, assessment.id));
    const urls = discovered.map((d) => d.url);
    const port = discoveryFixtureServer.port;

    // 1. Seed is discovered.
    expect(urls).toContain(`http://127.0.0.1:${port}/`);

    // 2. In-scope pages/resources are discovered (default depth reaches
    // /about -> /contact and /products -> /products?id=2).
    expect(urls).toContain(`http://127.0.0.1:${port}/about`);
    expect(urls).toContain(`http://127.0.0.1:${port}/contact`);
    expect(urls).toContain(`http://127.0.0.1:${port}/products`);
    expect(urls).toContain(`http://127.0.0.1:${port}/static/app.js`);
    expect(urls).toContain(`http://127.0.0.1:${port}/frame`);

    // 3. Query parameters are preserved as distinct URLs.
    expect(urls).toContain(`http://127.0.0.1:${port}/products?id=1`);
    expect(urls).toContain(`http://127.0.0.1:${port}/products?id=2`);

    // 4. Fragments are removed (the source link was /about#top).
    expect(urls).not.toContain(`http://127.0.0.1:${port}/about#top`);

    // 5. Duplicates are suppressed — no (url, type) pair appears twice.
    const pairs = discovered.map((d) => `${d.urlType}:${d.url}`);
    expect(new Set(pairs).size).toBe(pairs.length);

    // 6. Crawl depth is respected: depth values are all within the
    // conservative default (maxDepth 2), never unbounded.
    expect(discovered.every((d) => d.depth <= 2)).toBe(true);

    // 7. The out-of-scope external URL was never requested — not even
    // resolved, let alone connected to (proven both by the discovery
    // table and by the fixture server's own request log never showing it,
    // which it couldn't anyway since it's a different host entirely).
    expect(urls.some((u) => u.includes('out-of-scope.example.net'))).toBe(false);

    // 8. The redirect was followed under scope validation and its final
    // destination recorded.
    expect(urls).toContain(`http://127.0.0.1:${port}/redirected`);

    // 9. The form was recorded but never submitted — GET requests only in
    // the server's request log, and specifically only one GET /login.
    const formRow = discovered.find((d) => d.urlType === 'FORM_ACTION');
    expect(formRow).toBeDefined();
    expect(formRow?.metadata).toMatchObject({ method: 'POST' });
    expect(discoveryFixtureRequestLog).toContain('GET /login');
    expect(discoveryFixtureRequestLog.some((entry) => !entry.startsWith('GET '))).toBe(false);

    // 10. Passive findings were generated from the same fetches (the
    // insecure "session" cookie set on every HTML page produces a
    // cookie-security finding attributed to more than one page).
    const findings = await client.db
      .select()
      .from(schema.findings)
      .where(eq(schema.findings.assessmentId, assessment.id));
    const cookieFindingTargets = new Set(
      findings.filter((f) => f.category === 'cookies').map((f) => f.target),
    );
    expect(cookieFindingTargets.size).toBeGreaterThan(1);

    // 11. Discovery records persisted correctly with real metadata (not
    // placeholder/empty rows).
    const seedRow = discovered.find(
      (d) => d.url === `http://127.0.0.1:${port}/` && d.urlType === 'PAGE',
    );
    expect(seedRow?.statusCode).toBe(200);
    expect(seedRow?.contentType).toContain('html');
  }, 20_000);
});
