import { describe, expect, it } from 'vitest';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { Queue } from 'bullmq';
import { createLogger } from '@aivoryx/logger';
import type { AuditService, schema } from '@aivoryx/db';
import type { AssessmentJobData } from '@aivoryx/queue';
import { buildServer, type HealthCheckResult, type ServerDependencies } from './server.js';

function healthy(): Promise<HealthCheckResult> {
  return Promise.resolve({ healthy: true, latencyMs: 1 });
}

function unhealthy(message: string): () => Promise<HealthCheckResult> {
  return () => Promise.resolve({ healthy: false, error: message });
}

function testLogger() {
  return createLogger({ serviceName: 'api-test', level: 'silent' });
}

/**
 * These tests only exercise the public health/ready/404/error-handling paths,
 * none of which ever touch `db` or `audit` (the auth onRequest hook only reads
 * `db` when an Authorization header is present, and none of these requests send
 * one) — so a never-invoked stand-in is sufficient here. Full auth/tenant-
 * isolation behavior is covered by the gated integration suite in
 * api.integration.test.ts against a real database.
 */
function baseDeps(): Pick<
  ServerDependencies,
  'db' | 'credentialMasterKey' | 'audit' | 'assessmentJobsQueue' | 'isProduction'
> {
  return {
    db: {} as unknown as PostgresJsDatabase<typeof schema>,
    credentialMasterKey: 'test-master-key-not-for-production-use-000000',
    audit: { record: async () => undefined } as AuditService,
    assessmentJobsQueue: {} as unknown as Queue<AssessmentJobData>,
    isProduction: false,
  };
}

describe('GET /api/v1/health', () => {
  it('returns 200 and an ok status without checking dependencies', async () => {
    const app = buildServer({
      logger: testLogger(),
      ...baseDeps(),
      checkDatabaseHealth: healthy,
      checkRedisHealth: healthy,
    });

    const response = await app.inject({ method: 'GET', url: '/api/v1/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok' });
  });
});

describe('GET /api/v1/ready', () => {
  it('returns 200 when database and redis are both healthy', async () => {
    const app = buildServer({
      logger: testLogger(),
      ...baseDeps(),
      checkDatabaseHealth: healthy,
      checkRedisHealth: healthy,
    });

    const response = await app.inject({ method: 'GET', url: '/api/v1/ready' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'ready',
      checks: { database: { healthy: true }, redis: { healthy: true } },
    });
  });

  it('returns 503 when a dependency is unhealthy', async () => {
    const app = buildServer({
      logger: testLogger(),
      ...baseDeps(),
      checkDatabaseHealth: unhealthy('connection refused'),
      checkRedisHealth: healthy,
    });

    const response = await app.inject({ method: 'GET', url: '/api/v1/ready' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      status: 'not_ready',
      checks: { database: { healthy: false, error: 'connection refused' } },
    });
  });

  it('routes an unexpected health-check failure through the global error handler', async () => {
    const app = buildServer({
      logger: testLogger(),
      ...baseDeps(),
      checkDatabaseHealth: () => Promise.reject(new Error('boom')),
      checkRedisHealth: healthy,
    });

    const response = await app.inject({ method: 'GET', url: '/api/v1/ready' });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({
      error: { message: 'Internal server error', statusCode: 500 },
    });
  });
});

describe('error handling and correlation id', () => {
  it('returns a structured 404 envelope carrying the request id', async () => {
    const app = buildServer({
      logger: testLogger(),
      ...baseDeps(),
      checkDatabaseHealth: healthy,
      checkRedisHealth: healthy,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/does-not-exist',
      headers: { 'x-request-id': 'test-request-id' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: { message: 'Not found', statusCode: 404, requestId: 'test-request-id' },
    });
  });

  it('generates a request id when none is supplied', async () => {
    const app = buildServer({
      logger: testLogger(),
      ...baseDeps(),
      checkDatabaseHealth: healthy,
      checkRedisHealth: healthy,
    });

    const response = await app.inject({ method: 'GET', url: '/does-not-exist' });

    expect(response.json().error.requestId).toEqual(expect.any(String));
    expect(response.json().error.requestId.length).toBeGreaterThan(0);
  });
});
