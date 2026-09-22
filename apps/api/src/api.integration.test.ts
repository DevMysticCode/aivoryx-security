import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createDbClient, createAuditService, schema, type DbClient } from '@aivoryx/db';
import { generateApiKey } from '@aivoryx/auth';
import { createLogger } from '@aivoryx/logger';
import { buildServer } from './server.js';

// Requires a live PostgreSQL instance with the Batch 2 migration applied. Run via:
//   pnpm infra:up
//   node --env-file=.env packages/db/dist/migrate-cli.js
//   TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/aivoryx \
//     pnpm --filter @aivoryx/api test:integration
const DATABASE_URL = process.env.TEST_DATABASE_URL;
const MASTER_KEY = 'integration-test-master-key-not-for-production-use';

describe.skipIf(!DATABASE_URL)('API auth + tenant isolation (integration)', () => {
  let client: DbClient;
  let app: FastifyInstance;

  let orgAId: string;
  let orgBId: string;
  let orgARawKey: string;
  let orgBRawKey: string;
  let orgAProjectId: string;
  let orgBProjectId: string;
  let orgBApiKeyId: string;

  beforeAll(async () => {
    client = createDbClient(DATABASE_URL as string, { maxConnections: 5 });
    const audit = createAuditService(client.db);

    app = buildServer({
      logger: createLogger({ serviceName: 'api-integration-test', level: 'silent' }),
      checkDatabaseHealth: client.healthCheck,
      checkRedisHealth: async () => ({ healthy: true }),
      db: client.db,
      credentialMasterKey: MASTER_KEY,
      audit,
    });
    await app.ready();

    const suffix = Date.now().toString(36);

    const [orgA] = await client.db
      .insert(schema.organizations)
      .values({ name: `Tenant A ${suffix}`, slug: `tenant-a-${suffix}` })
      .returning();
    const [orgB] = await client.db
      .insert(schema.organizations)
      .values({ name: `Tenant B ${suffix}`, slug: `tenant-b-${suffix}` })
      .returning();
    orgAId = orgA!.id;
    orgBId = orgB!.id;

    const keyA = generateApiKey(MASTER_KEY);
    const keyB = generateApiKey(MASTER_KEY);
    orgARawKey = keyA.raw;
    orgBRawKey = keyB.raw;

    await client.db.insert(schema.apiKeys).values({
      organizationId: orgAId,
      name: 'Org A key',
      keyPrefix: keyA.keyPrefix,
      keyHash: keyA.keyHash,
    });
    const [orgBKeyRow] = await client.db
      .insert(schema.apiKeys)
      .values({
        organizationId: orgBId,
        name: 'Org B key',
        keyPrefix: keyB.keyPrefix,
        keyHash: keyB.keyHash,
      })
      .returning();
    orgBApiKeyId = orgBKeyRow!.id;

    const [projectA] = await client.db
      .insert(schema.projects)
      .values({ organizationId: orgAId, name: 'Org A Project', slug: 'org-a-project' })
      .returning();
    const [projectB] = await client.db
      .insert(schema.projects)
      .values({ organizationId: orgBId, name: 'Org B Project', slug: 'org-b-project' })
      .returning();
    orgAProjectId = projectA!.id;
    orgBProjectId = projectB!.id;
  });

  afterAll(async () => {
    await app.close();
    await client.close();
  });

  function authHeader(rawKey: string) {
    return { authorization: `Bearer ${rawKey}` };
  }

  describe('authentication', () => {
    it('rejects protected routes with no Authorization header', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/v1/projects' });
      expect(response.statusCode).toBe(401);
    });

    it('rejects protected routes with a garbage Authorization header', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/projects',
        headers: { authorization: 'Bearer not-a-real-key' },
      });
      expect(response.statusCode).toBe(401);
    });

    it('authenticates a valid API key and exposes it via /me', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/me',
        headers: authHeader(orgARawKey),
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().principal).toMatchObject({
        type: 'tenant',
        organizationId: orgAId,
        authType: 'api-key',
      });
    });

    it('leaves /health and /ready open without authentication', async () => {
      const health = await app.inject({ method: 'GET', url: '/api/v1/health' });
      const ready = await app.inject({ method: 'GET', url: '/api/v1/ready' });
      expect(health.statusCode).toBe(200);
      expect(ready.statusCode).toBe(200);
    });
  });

  describe('tenant isolation', () => {
    it('Tenant A -> Tenant A project = allowed', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/projects/${orgAProjectId}`,
        headers: authHeader(orgARawKey),
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().project.id).toBe(orgAProjectId);
    });

    it('Tenant A -> Tenant B project = denied (404, no existence leak)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/projects/${orgBProjectId}`,
        headers: authHeader(orgARawKey),
      });
      expect(response.statusCode).toBe(404);
    });

    it('Tenant A -> Tenant B API key = denied', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: `/api/v1/api-keys/${orgBApiKeyId}`,
        headers: authHeader(orgARawKey),
      });
      expect(response.statusCode).toBe(404);
    });

    it('Tenant B -> Tenant B project = allowed (isolation is per-tenant, not a one-way block)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/projects/${orgBProjectId}`,
        headers: authHeader(orgBRawKey),
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().project.id).toBe(orgBProjectId);
    });

    it("GET /organizations only ever returns the caller's own organization", async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/organizations',
        headers: authHeader(orgARawKey),
      });
      const organizations = response.json().organizations as { id: string }[];
      expect(organizations).toHaveLength(1);
      expect(organizations[0]?.id).toBe(orgAId);
      expect(organizations.some((org) => org.id === orgBId)).toBe(false);
    });

    it('projects list for Tenant A never includes Tenant B projects', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/projects',
        headers: authHeader(orgARawKey),
      });
      const projects = response.json().projects as { id: string }[];
      expect(projects.some((project) => project.id === orgBProjectId)).toBe(false);
    });
  });

  describe('projects', () => {
    it('creates a project scoped to the caller organization', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/projects',
        headers: authHeader(orgARawKey),
        payload: { name: 'New Project', slug: `new-project-${Date.now()}` },
      });
      expect(response.statusCode).toBe(201);
      expect(response.json().project.organizationId).toBe(orgAId);
    });

    it('rejects a duplicate slug within the same organization with 409', async () => {
      const slug = `dup-project-${Date.now()}`;
      const first = await app.inject({
        method: 'POST',
        url: '/api/v1/projects',
        headers: authHeader(orgARawKey),
        payload: { name: 'First', slug },
      });
      expect(first.statusCode).toBe(201);

      const second = await app.inject({
        method: 'POST',
        url: '/api/v1/projects',
        headers: authHeader(orgARawKey),
        payload: { name: 'Second', slug },
      });
      expect(second.statusCode).toBe(409);
    });

    it('rejects an invalid body with 400', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/projects',
        headers: authHeader(orgARawKey),
        payload: { name: '' },
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe('api keys', () => {
    it('creates a key, returns the raw secret once, and the raw secret authenticates', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: authHeader(orgARawKey),
        payload: { name: 'CI key' },
      });
      expect(createResponse.statusCode).toBe(201);
      const created = createResponse.json().apiKey;
      expect(created.rawKey).toEqual(expect.any(String));
      expect(created).not.toHaveProperty('keyHash');

      const meResponse = await app.inject({
        method: 'GET',
        url: '/api/v1/me',
        headers: authHeader(created.rawKey),
      });
      expect(meResponse.statusCode).toBe(200);
      expect(meResponse.json().principal.organizationId).toBe(orgAId);
    });

    it('list never includes the key hash', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/api-keys',
        headers: authHeader(orgARawKey),
      });
      const body = response.payload;
      expect(body).not.toContain('keyHash');
    });

    it('revokes a key and the revoked key is then rejected for authentication', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: authHeader(orgARawKey),
        payload: { name: 'To be revoked' },
      });
      const created = createResponse.json().apiKey;

      const revokeResponse = await app.inject({
        method: 'DELETE',
        url: `/api/v1/api-keys/${created.id}`,
        headers: authHeader(orgARawKey),
      });
      expect(revokeResponse.statusCode).toBe(200);
      expect(revokeResponse.json().apiKey.status).toBe('revoked');

      const meResponse = await app.inject({
        method: 'GET',
        url: '/api/v1/me',
        headers: authHeader(created.rawKey),
      });
      expect(meResponse.statusCode).toBe(401);
    });
  });
});
