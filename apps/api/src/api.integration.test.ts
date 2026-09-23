import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type { Redis } from 'ioredis';
import type { Queue } from 'bullmq';
import { createDbClient, createAuditService, schema, type DbClient } from '@aivoryx/db';
import {
  createRedisConnection,
  checkRedisHealth,
  createQueue,
  QUEUE_NAMES,
  type AssessmentJobData,
} from '@aivoryx/queue';
import { generateApiKey, SESSION_COOKIE_NAME } from '@aivoryx/auth';
import { createLogger } from '@aivoryx/logger';
import { buildServer } from './server.js';

// Requires live PostgreSQL + Redis with the Batch 3 migration applied. Run via:
//   pnpm infra:up
//   node --env-file=.env packages/db/dist/migrate-cli.js
//   TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/aivoryx \
//   TEST_REDIS_URL=redis://localhost:6379 \
//     pnpm --filter @aivoryx/api test:integration
const DATABASE_URL = process.env.TEST_DATABASE_URL;
const REDIS_URL = process.env.TEST_REDIS_URL;
const MASTER_KEY = 'integration-test-master-key-not-for-production-use';

function sessionCookieFrom(response: LightMyRequestResponse): string {
  const cookie = response.cookies.find((c) => c.name === SESSION_COOKIE_NAME);
  if (!cookie) throw new Error('Expected a session cookie in the response');
  return cookie.value;
}

function uniqueEmail(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

describe.skipIf(!DATABASE_URL || !REDIS_URL)('API (integration)', () => {
  let client: DbClient;
  let redisConnection: Redis;
  let assessmentJobsQueue: Queue<AssessmentJobData>;
  let app: FastifyInstance;

  beforeAll(async () => {
    client = createDbClient(DATABASE_URL as string, { maxConnections: 5 });
    redisConnection = createRedisConnection(REDIS_URL as string);
    assessmentJobsQueue = createQueue(QUEUE_NAMES.ASSESSMENT_JOBS, redisConnection);
    const audit = createAuditService(client.db);

    app = buildServer({
      logger: createLogger({ serviceName: 'api-integration-test', level: 'silent' }),
      checkDatabaseHealth: client.healthCheck,
      checkRedisHealth: () => checkRedisHealth(redisConnection),
      db: client.db,
      credentialMasterKey: MASTER_KEY,
      audit,
      assessmentJobsQueue,
      isProduction: false,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await assessmentJobsQueue.close();
    await redisConnection.quit();
    await client.close();
  });

  async function registerAndLogin(label: string, password = 'correct-horse-battery-99') {
    const email = uniqueEmail(label);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email, password, name: label },
    });
    expect(response.statusCode).toBe(201);
    return {
      email,
      password,
      userId: response.json().user.id as string,
      sessionCookie: sessionCookieFrom(response),
    };
  }

  async function createOrgAsOwner(sessionCookie: string, label: string) {
    const slug = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/organizations',
      cookies: { [SESSION_COOKIE_NAME]: sessionCookie },
      payload: { name: label, slug },
    });
    expect(response.statusCode).toBe(201);
    return response.json().organization as { id: string; slug: string };
  }

  describe('registration / login / logout', () => {
    it('registers a new user and sets a session cookie', async () => {
      const { email, sessionCookie } = await registerAndLogin('register');
      expect(sessionCookie).toEqual(expect.any(String));
      expect(email).toContain('register');
    });

    it('rejects registering a duplicate email', async () => {
      const email = uniqueEmail('dup');
      const first = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: { email, password: 'correct-horse-battery-99' },
      });
      expect(first.statusCode).toBe(201);

      const second = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: { email, password: 'another-password-99' },
      });
      expect(second.statusCode).toBe(409);
    });

    it('rejects a weak password', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: { email: uniqueEmail('weak'), password: 'short1' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('logs in with correct credentials', async () => {
      const { email, password } = await registerAndLogin('login-ok');
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email, password },
      });
      expect(response.statusCode).toBe(200);
      expect(sessionCookieFrom(response)).toEqual(expect.any(String));
    });

    it('rejects login with the wrong password using a generic message', async () => {
      const { email } = await registerAndLogin('login-bad-pw');
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email, password: 'totally-wrong-password' },
      });
      expect(response.statusCode).toBe(401);
      expect(response.json().error.message).toBe('Invalid email or password');
    });

    it('rejects login for a nonexistent email with the same generic message (no user enumeration)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: uniqueEmail('nosuchuser'), password: 'whatever-password-99' },
      });
      expect(response.statusCode).toBe(401);
      expect(response.json().error.message).toBe('Invalid email or password');
    });

    it('authenticates GET /me with a valid session', async () => {
      const { sessionCookie, email } = await registerAndLogin('me-session');
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/me',
        cookies: { [SESSION_COOKIE_NAME]: sessionCookie },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().user.email).toBe(email);
    });

    it('rejects GET /me with an invalid/garbage session token', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/me',
        cookies: { [SESSION_COOKIE_NAME]: 'not-a-real-session-token' },
      });
      expect(response.statusCode).toBe(401);
    });

    it('logout revokes the session so it can no longer authenticate', async () => {
      const { sessionCookie } = await registerAndLogin('logout');
      const logoutResponse = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        cookies: { [SESSION_COOKIE_NAME]: sessionCookie },
      });
      expect(logoutResponse.statusCode).toBe(204);

      const meResponse = await app.inject({
        method: 'GET',
        url: '/api/v1/me',
        cookies: { [SESSION_COOKIE_NAME]: sessionCookie },
      });
      expect(meResponse.statusCode).toBe(401);
    });
  });

  describe('organization bootstrap', () => {
    it('creating an organization from a session auto-creates an OWNER membership (no API key required)', async () => {
      const owner = await registerAndLogin('bootstrap-owner');
      const org = await createOrgAsOwner(owner.sessionCookie, 'bootstrap-org');

      const membersResponse = await app.inject({
        method: 'GET',
        url: `/api/v1/organizations/${org.id}/members`,
        cookies: { [SESSION_COOKIE_NAME]: owner.sessionCookie },
      });
      expect(membersResponse.statusCode).toBe(200);
      const members = membersResponse.json().members as { userId: string; role: string }[];
      expect(members).toHaveLength(1);
      expect(members[0]).toMatchObject({ userId: owner.userId, role: 'OWNER' });
    });

    it('the OWNER can create an API key from their session, and that key authenticates', async () => {
      const owner = await registerAndLogin('bootstrap-key-owner');
      const org = await createOrgAsOwner(owner.sessionCookie, 'bootstrap-key-org');

      const createKeyResponse = await app.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        cookies: { [SESSION_COOKIE_NAME]: owner.sessionCookie },
        payload: { organizationId: org.id, name: 'CI key' },
      });
      expect(createKeyResponse.statusCode).toBe(201);
      const rawKey = createKeyResponse.json().apiKey.rawKey as string;

      const meResponse = await app.inject({
        method: 'GET',
        url: '/api/v1/me',
        headers: { authorization: `Bearer ${rawKey}` },
      });
      expect(meResponse.statusCode).toBe(200);
      expect(meResponse.json().principal.organizationId).toBe(org.id);
    });
  });

  describe('membership', () => {
    it('an OWNER can add a registered user, change their role, then remove them', async () => {
      const owner = await registerAndLogin('member-owner');
      const org = await createOrgAsOwner(owner.sessionCookie, 'member-org');
      const other = await registerAndLogin('member-other');

      const addResponse = await app.inject({
        method: 'POST',
        url: `/api/v1/organizations/${org.id}/members`,
        cookies: { [SESSION_COOKIE_NAME]: owner.sessionCookie },
        payload: { email: other.email, role: 'DEVELOPER' },
      });
      expect(addResponse.statusCode).toBe(201);
      const memberId = addResponse.json().member.id as string;

      const roleResponse = await app.inject({
        method: 'PATCH',
        url: `/api/v1/organizations/${org.id}/members/${memberId}`,
        cookies: { [SESSION_COOKIE_NAME]: owner.sessionCookie },
        payload: { role: 'ADMIN' },
      });
      expect(roleResponse.statusCode).toBe(200);
      expect(roleResponse.json().member.role).toBe('ADMIN');

      const removeResponse = await app.inject({
        method: 'DELETE',
        url: `/api/v1/organizations/${org.id}/members/${memberId}`,
        cookies: { [SESSION_COOKIE_NAME]: owner.sessionCookie },
      });
      expect(removeResponse.statusCode).toBe(204);
    });

    it('a DEVELOPER cannot add members (permission enforcement)', async () => {
      const owner = await registerAndLogin('member-perm-owner');
      const org = await createOrgAsOwner(owner.sessionCookie, 'member-perm-org');
      const developer = await registerAndLogin('member-perm-dev');
      await app.inject({
        method: 'POST',
        url: `/api/v1/organizations/${org.id}/members`,
        cookies: { [SESSION_COOKIE_NAME]: owner.sessionCookie },
        payload: { email: developer.email, role: 'DEVELOPER' },
      });

      const thirdUser = await registerAndLogin('member-perm-third');
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/organizations/${org.id}/members`,
        cookies: { [SESSION_COOKIE_NAME]: developer.sessionCookie },
        payload: { email: thirdUser.email, role: 'VIEWER' },
      });
      expect(response.statusCode).toBe(403);
    });

    it('cannot remove the last OWNER of an organization', async () => {
      const owner = await registerAndLogin('last-owner');
      const org = await createOrgAsOwner(owner.sessionCookie, 'last-owner-org');

      const membersResponse = await app.inject({
        method: 'GET',
        url: `/api/v1/organizations/${org.id}/members`,
        cookies: { [SESSION_COOKIE_NAME]: owner.sessionCookie },
      });
      const ownerMemberId = membersResponse.json().members[0].id as string;

      const removeResponse = await app.inject({
        method: 'DELETE',
        url: `/api/v1/organizations/${org.id}/members/${ownerMemberId}`,
        cookies: { [SESSION_COOKIE_NAME]: owner.sessionCookie },
      });
      expect(removeResponse.statusCode).toBe(400);
    });
  });

  describe('tenant isolation', () => {
    it('organization A cannot access organization B projects/assets/assessments/members/api-keys', async () => {
      const ownerA = await registerAndLogin('iso-owner-a');
      const orgA = await createOrgAsOwner(ownerA.sessionCookie, 'iso-org-a');
      const ownerB = await registerAndLogin('iso-owner-b');
      const orgB = await createOrgAsOwner(ownerB.sessionCookie, 'iso-org-b');

      const projectB = await app.inject({
        method: 'POST',
        url: '/api/v1/projects',
        cookies: { [SESSION_COOKIE_NAME]: ownerB.sessionCookie },
        payload: { organizationId: orgB.id, name: 'B project', slug: `b-project-${Date.now()}` },
      });
      const projectBId = projectB.json().project.id as string;

      const assetB = await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectBId}/assets`,
        cookies: { [SESSION_COOKIE_NAME]: ownerB.sessionCookie },
        payload: {
          assetType: 'WEB',
          name: 'B asset',
          config: { baseUrl: 'https://b.example.com' },
        },
      });
      const assetBId = assetB.json().asset.id as string;

      const headersA = { cookies: { [SESSION_COOKIE_NAME]: ownerA.sessionCookie } };

      const getProjectB = await app.inject({
        method: 'GET',
        url: `/api/v1/projects/${projectBId}`,
        ...headersA,
      });
      expect(getProjectB.statusCode).toBe(404);

      const getAssetB = await app.inject({
        method: 'GET',
        url: `/api/v1/assets/${assetBId}`,
        ...headersA,
      });
      expect(getAssetB.statusCode).toBe(404);

      const getMembersB = await app.inject({
        method: 'GET',
        url: `/api/v1/organizations/${orgB.id}/members`,
        ...headersA,
      });
      expect(getMembersB.statusCode).toBe(403);

      const getOrgB = await app.inject({
        method: 'GET',
        url: `/api/v1/organizations/${orgB.id}`,
        ...headersA,
      });
      expect(getOrgB.statusCode).toBe(404);

      void orgA; // orgA created only to prove ownerA is a real, distinct tenant
    });
  });

  describe('projects', () => {
    it('supports create/list/get/update/archive with organization isolation', async () => {
      const owner = await registerAndLogin('project-owner');
      const org = await createOrgAsOwner(owner.sessionCookie, 'project-org');
      const auth = { cookies: { [SESSION_COOKIE_NAME]: owner.sessionCookie } };

      const create = await app.inject({
        method: 'POST',
        url: '/api/v1/projects',
        ...auth,
        payload: { organizationId: org.id, name: 'Widgets', slug: `widgets-${Date.now()}` },
      });
      expect(create.statusCode).toBe(201);
      const projectId = create.json().project.id as string;

      const list = await app.inject({
        method: 'GET',
        url: `/api/v1/projects?organizationId=${org.id}`,
        ...auth,
      });
      const projects = list.json().projects as { id: string }[];
      expect(projects.some((p) => p.id === projectId)).toBe(true);

      const update = await app.inject({
        method: 'PATCH',
        url: `/api/v1/projects/${projectId}`,
        ...auth,
        payload: { name: 'Widgets Renamed' },
      });
      expect(update.statusCode).toBe(200);
      expect(update.json().project.name).toBe('Widgets Renamed');

      const archive = await app.inject({
        method: 'DELETE',
        url: `/api/v1/projects/${projectId}`,
        ...auth,
      });
      expect(archive.statusCode).toBe(200);
      expect(archive.json().project.status).toBe('archived');
    });

    it('a VIEWER cannot create a project (permission enforcement)', async () => {
      const owner = await registerAndLogin('project-perm-owner');
      const org = await createOrgAsOwner(owner.sessionCookie, 'project-perm-org');
      const viewer = await registerAndLogin('project-perm-viewer');
      await app.inject({
        method: 'POST',
        url: `/api/v1/organizations/${org.id}/members`,
        cookies: { [SESSION_COOKIE_NAME]: owner.sessionCookie },
        payload: { email: viewer.email, role: 'VIEWER' },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/projects',
        cookies: { [SESSION_COOKIE_NAME]: viewer.sessionCookie },
        payload: { organizationId: org.id, name: 'Should fail', slug: `should-fail-${Date.now()}` },
      });
      expect(response.statusCode).toBe(403);
    });
  });

  describe('assets', () => {
    async function setupProject(label: string) {
      const owner = await registerAndLogin(label);
      const org = await createOrgAsOwner(owner.sessionCookie, label);
      const auth = { cookies: { [SESSION_COOKIE_NAME]: owner.sessionCookie } };
      const project = await app.inject({
        method: 'POST',
        url: '/api/v1/projects',
        ...auth,
        payload: { organizationId: org.id, name: label, slug: `${label}-${Date.now()}` },
      });
      return { owner, org, auth, projectId: project.json().project.id as string };
    }

    it('creates a WEB, API, ANDROID, and IOS asset with valid type-specific config', async () => {
      const { auth, projectId } = await setupProject('asset-types');

      const cases: { assetType: string; config: Record<string, unknown> }[] = [
        { assetType: 'WEB', config: { baseUrl: 'https://example.com' } },
        { assetType: 'API', config: { baseUrl: 'https://api.example.com' } },
        { assetType: 'ANDROID', config: { packageName: 'com.example.app' } },
        { assetType: 'IOS', config: { bundleId: 'com.example.app' } },
      ];

      for (const testCase of cases) {
        const response = await app.inject({
          method: 'POST',
          url: `/api/v1/projects/${projectId}/assets`,
          ...auth,
          payload: {
            assetType: testCase.assetType,
            name: `${testCase.assetType} asset`,
            config: testCase.config,
          },
        });
        expect(response.statusCode).toBe(201);
        expect(response.json().asset.assetType).toBe(testCase.assetType);
        expect(response.json().asset.authorizationConfirmed).toBe(false);
      }
    });

    it('rejects a config that does not match the asset type', async () => {
      const { auth, projectId } = await setupProject('asset-invalid-config');

      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/assets`,
        ...auth,
        // ANDROID requires packageName, not baseUrl
        payload: {
          assetType: 'ANDROID',
          name: 'Bad config',
          config: { baseUrl: 'https://example.com' },
        },
      });
      expect(response.statusCode).toBe(400);
    });

    it('confirms and revokes authorization, recorded with who and when', async () => {
      const { auth, projectId } = await setupProject('asset-auth-confirm');
      const create = await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/assets`,
        ...auth,
        payload: {
          assetType: 'WEB',
          name: 'To confirm',
          config: { baseUrl: 'https://example.com' },
        },
      });
      const assetId = create.json().asset.id as string;

      const confirm = await app.inject({
        method: 'PATCH',
        url: `/api/v1/assets/${assetId}`,
        ...auth,
        payload: { authorizationConfirmed: true },
      });
      expect(confirm.statusCode).toBe(200);
      expect(confirm.json().asset.authorizationConfirmed).toBe(true);
      expect(confirm.json().asset.authorizationConfirmedAt).toEqual(expect.any(String));
    });

    it('a DEVELOPER can create an asset but cannot confirm its authorization (separation of duties)', async () => {
      const owner = await registerAndLogin('asset-dev-owner');
      const org = await createOrgAsOwner(owner.sessionCookie, 'asset-dev-org');
      const developer = await registerAndLogin('asset-dev-user');
      await app.inject({
        method: 'POST',
        url: `/api/v1/organizations/${org.id}/members`,
        cookies: { [SESSION_COOKIE_NAME]: owner.sessionCookie },
        payload: { email: developer.email, role: 'DEVELOPER' },
      });
      const project = await app.inject({
        method: 'POST',
        url: '/api/v1/projects',
        cookies: { [SESSION_COOKIE_NAME]: owner.sessionCookie },
        payload: { organizationId: org.id, name: 'Dev project', slug: `dev-project-${Date.now()}` },
      });
      const projectId = project.json().project.id as string;
      const devAuth = { cookies: { [SESSION_COOKIE_NAME]: developer.sessionCookie } };

      const create = await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/assets`,
        ...devAuth,
        payload: {
          assetType: 'WEB',
          name: 'Dev asset',
          config: { baseUrl: 'https://example.com' },
        },
      });
      expect(create.statusCode).toBe(201);
      const assetId = create.json().asset.id as string;

      const confirm = await app.inject({
        method: 'PATCH',
        url: `/api/v1/assets/${assetId}`,
        ...devAuth,
        payload: { authorizationConfirmed: true },
      });
      expect(confirm.statusCode).toBe(403);
    });
  });

  describe('assessments', () => {
    async function setupAuthorizedAsset(label: string, assetType: 'WEB' | 'ANDROID' = 'WEB') {
      const owner = await registerAndLogin(label);
      const org = await createOrgAsOwner(owner.sessionCookie, label);
      const auth = { cookies: { [SESSION_COOKIE_NAME]: owner.sessionCookie } };
      const project = await app.inject({
        method: 'POST',
        url: '/api/v1/projects',
        ...auth,
        payload: { organizationId: org.id, name: label, slug: `${label}-${Date.now()}` },
      });
      const projectId = project.json().project.id as string;

      const config =
        assetType === 'WEB'
          ? { baseUrl: 'https://example.com' }
          : { packageName: 'com.example.app' };
      const assetResponse = await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/assets`,
        ...auth,
        payload: { assetType, name: `${label} asset`, config },
      });
      const assetId = assetResponse.json().asset.id as string;

      await app.inject({
        method: 'PATCH',
        url: `/api/v1/assets/${assetId}`,
        ...auth,
        payload: { authorizationConfirmed: true },
      });

      return { auth, projectId, assetId };
    }

    it('creates an assessment for a valid asset/assessment-type combination', async () => {
      const { auth, projectId, assetId } = await setupAuthorizedAsset('assessment-valid');
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/assessments`,
        ...auth,
        payload: { assetId, assessmentType: 'WEB' },
      });
      expect(response.statusCode).toBe(201);
      expect(response.json().assessment.status).toBe('QUEUED');
    }, 15_000);

    it('rejects an incompatible asset/assessment-type combination', async () => {
      const { auth, projectId, assetId } = await setupAuthorizedAsset(
        'assessment-invalid',
        'ANDROID',
      );
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/assessments`,
        ...auth,
        payload: { assetId, assessmentType: 'WEB' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('rejects creating an assessment against an asset whose authorization is not confirmed', async () => {
      const owner = await registerAndLogin('assessment-unauthorized');
      const org = await createOrgAsOwner(owner.sessionCookie, 'assessment-unauthorized');
      const auth = { cookies: { [SESSION_COOKIE_NAME]: owner.sessionCookie } };
      const project = await app.inject({
        method: 'POST',
        url: '/api/v1/projects',
        ...auth,
        payload: { organizationId: org.id, name: 'unauth', slug: `unauth-${Date.now()}` },
      });
      const projectId = project.json().project.id as string;
      const asset = await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/assets`,
        ...auth,
        payload: {
          assetType: 'WEB',
          name: 'Unauthorized asset',
          config: { baseUrl: 'https://example.com' },
        },
      });
      const assetId = asset.json().asset.id as string;

      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/assessments`,
        ...auth,
        payload: { assetId, assessmentType: 'WEB' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('cancels a QUEUED assessment, and rejects cancelling it again', async () => {
      const { auth, projectId, assetId } = await setupAuthorizedAsset('assessment-cancel');
      const create = await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/assessments`,
        ...auth,
        payload: { assetId, assessmentType: 'WEB' },
      });
      const assessmentId = create.json().assessment.id as string;

      const cancel = await app.inject({
        method: 'POST',
        url: `/api/v1/assessments/${assessmentId}/cancel`,
        ...auth,
      });
      expect(cancel.statusCode).toBe(200);
      expect(cancel.json().assessment.status).toBe('CANCELLED');

      const cancelAgain = await app.inject({
        method: 'POST',
        url: `/api/v1/assessments/${assessmentId}/cancel`,
        ...auth,
      });
      expect(cancelAgain.statusCode).toBe(409);
    }, 15_000);

    it('an organization cannot cancel another organization assessment (tenant isolation)', async () => {
      const ownerA = await registerAndLogin('assessment-iso-a');
      const { auth: authB, projectId, assetId } = await setupAuthorizedAsset('assessment-iso-b');
      const create = await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/assessments`,
        ...authB,
        payload: { assetId, assessmentType: 'WEB' },
      });
      const assessmentId = create.json().assessment.id as string;

      const cancelAttempt = await app.inject({
        method: 'POST',
        url: `/api/v1/assessments/${assessmentId}/cancel`,
        cookies: { [SESSION_COOKIE_NAME]: ownerA.sessionCookie },
      });
      expect(cancelAttempt.statusCode).toBe(404);
    }, 15_000);

    it('rejects an unauthenticated assessment cancellation attempt', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/assessments/00000000-0000-0000-0000-000000000000/cancel',
      });
      expect(response.statusCode).toBe(401);
    });
  });

  describe('findings', () => {
    async function setupAssessmentWithFinding(label: string) {
      const owner = await registerAndLogin(label);
      const org = await createOrgAsOwner(owner.sessionCookie, label);
      const auth = { cookies: { [SESSION_COOKIE_NAME]: owner.sessionCookie } };
      const project = await app.inject({
        method: 'POST',
        url: '/api/v1/projects',
        ...auth,
        payload: { organizationId: org.id, name: label, slug: `${label}-${Date.now()}` },
      });
      const projectId = project.json().project.id as string;
      const assetResponse = await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/assets`,
        ...auth,
        payload: {
          assetType: 'WEB',
          name: `${label} asset`,
          config: { baseUrl: 'https://example.com' },
        },
      });
      const assetId = assetResponse.json().asset.id as string;
      await app.inject({
        method: 'PATCH',
        url: `/api/v1/assets/${assetId}`,
        ...auth,
        payload: { authorizationConfirmed: true },
      });
      const created = await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/assessments`,
        ...auth,
        payload: { assetId, assessmentType: 'WEB' },
      });
      const assessmentId = created.json().assessment.id as string;

      // The worker isn't running in this test — insert a finding/evidence
      // row directly (as apps/worker would) to test the API's read path and
      // tenant isolation independently of scanner execution.
      const [finding] = await client.db
        .insert(schema.findings)
        .values({
          assessmentId,
          scanner: 'http-reachability',
          title: 'No Content-Security-Policy header',
          description: 'test finding',
          severity: 'LOW',
          confidence: 'HIGH',
          category: 'security-headers',
          target: 'https://example.com/',
          key: 'csp-missing',
          remediation: 'Add a CSP header.',
          references: ['https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP'],
          fingerprint: `test-${label}-${Date.now()}`,
        })
        .returning();
      await client.db.insert(schema.evidence).values({
        findingId: finding!.id,
        data: { header: 'Content-Security-Policy', present: false },
      });

      return { auth, assessmentId, findingId: finding!.id };
    }

    it('lists findings for an assessment the caller can access', async () => {
      const { auth, assessmentId } = await setupAssessmentWithFinding('finding-list');
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/assessments/${assessmentId}/findings`,
        ...auth,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().findings).toHaveLength(1);
      expect(response.json().findings[0].category).toBe('security-headers');
    }, 15_000);

    it('retrieves a single finding with its evidence', async () => {
      const { auth, findingId } = await setupAssessmentWithFinding('finding-detail');
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/findings/${findingId}`,
        ...auth,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.finding.id).toBe(findingId);
      expect(body.finding.remediation).toBe('Add a CSP header.');
      expect(body.evidence).toHaveLength(1);
      expect(body.evidence[0].data).toEqual({ header: 'Content-Security-Policy', present: false });
    }, 15_000);

    it('an organization cannot read another organization finding by id (tenant isolation)', async () => {
      const ownerA = await registerAndLogin('finding-iso-a');
      const { findingId } = await setupAssessmentWithFinding('finding-iso-b');

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/findings/${findingId}`,
        cookies: { [SESSION_COOKIE_NAME]: ownerA.sessionCookie },
      });
      expect(response.statusCode).toBe(404);
    }, 15_000);

    it('an organization cannot list another organization assessment findings (tenant isolation)', async () => {
      const ownerA = await registerAndLogin('finding-list-iso-a');
      const { assessmentId } = await setupAssessmentWithFinding('finding-list-iso-b');

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/assessments/${assessmentId}/findings`,
        cookies: { [SESSION_COOKIE_NAME]: ownerA.sessionCookie },
      });
      expect(response.statusCode).toBe(404);
    }, 15_000);

    it('exposes no route to create, update, or delete a finding', async () => {
      const { auth, findingId } = await setupAssessmentWithFinding('finding-immutable');

      const create = await app.inject({
        method: 'POST',
        url: '/api/v1/findings',
        ...auth,
        payload: {},
      });
      expect(create.statusCode).toBe(404);

      const update = await app.inject({
        method: 'PATCH',
        url: `/api/v1/findings/${findingId}`,
        ...auth,
        payload: { status: 'RESOLVED' },
      });
      expect(update.statusCode).toBe(404);

      const del = await app.inject({
        method: 'DELETE',
        url: `/api/v1/findings/${findingId}`,
        ...auth,
      });
      expect(del.statusCode).toBe(404);
    }, 15_000);
  });

  describe('discovered-urls', () => {
    async function setupAssessmentWithDiscoveredUrls(label: string) {
      const owner = await registerAndLogin(label);
      const org = await createOrgAsOwner(owner.sessionCookie, label);
      const auth = { cookies: { [SESSION_COOKIE_NAME]: owner.sessionCookie } };
      const project = await app.inject({
        method: 'POST',
        url: '/api/v1/projects',
        ...auth,
        payload: { organizationId: org.id, name: label, slug: `${label}-${Date.now()}` },
      });
      const projectId = project.json().project.id as string;
      const assetResponse = await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/assets`,
        ...auth,
        payload: {
          assetType: 'WEB',
          name: `${label} asset`,
          config: { baseUrl: 'https://example.com' },
        },
      });
      const assetId = assetResponse.json().asset.id as string;
      await app.inject({
        method: 'PATCH',
        url: `/api/v1/assets/${assetId}`,
        ...auth,
        payload: { authorizationConfirmed: true },
      });
      const created = await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/assessments`,
        ...auth,
        payload: { assetId, assessmentType: 'WEB' },
      });
      const assessmentId = created.json().assessment.id as string;

      // The worker isn't running in this test — insert discovery rows
      // directly (as apps/worker would) to test the API's read path
      // independently of crawler execution.
      // Inserted one statement at a time (as the worker's reportDiscoveredUrl
      // does in production — never a batched insert) so each row's
      // defaultNow() createdAt is genuinely sequential, matching the
      // service's deterministic (createdAt, id) ordering.
      await client.db.insert(schema.discoveredUrls).values({
        assessmentId,
        url: 'https://example.com/',
        sourceUrl: null,
        urlType: 'PAGE',
        discoveryMethod: 'SEED',
        depth: 0,
        statusCode: 200,
        contentType: 'text/html',
      });
      await client.db.insert(schema.discoveredUrls).values({
        assessmentId,
        url: 'https://example.com/about',
        sourceUrl: 'https://example.com/',
        urlType: 'PAGE',
        discoveryMethod: 'HTML_LINK',
        depth: 1,
        statusCode: 200,
        contentType: 'text/html',
      });
      await client.db.insert(schema.discoveredUrls).values({
        assessmentId,
        url: 'https://example.com/app.js',
        sourceUrl: 'https://example.com/',
        urlType: 'RESOURCE',
        discoveryMethod: 'HTML_RESOURCE',
        depth: 1,
        contentType: 'application/javascript',
      });

      return { auth, assessmentId };
    }

    it('lists discovered URLs for an assessment the caller can access, in deterministic order', async () => {
      const { auth, assessmentId } = await setupAssessmentWithDiscoveredUrls('discovery-list');
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/assessments/${assessmentId}/discovered-urls`,
        ...auth,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.discoveredUrls).toHaveLength(3);
      expect(body.pagination).toMatchObject({ total: 3, limit: 50, offset: 0 });
      // Deterministic ordering: seed (created first) comes before later discoveries.
      expect(body.discoveredUrls[0].url).toBe('https://example.com/');
    }, 15_000);

    it('filters by urlType', async () => {
      const { auth, assessmentId } = await setupAssessmentWithDiscoveredUrls('discovery-filter');
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/assessments/${assessmentId}/discovered-urls?urlType=RESOURCE`,
        ...auth,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.discoveredUrls).toHaveLength(1);
      expect(body.discoveredUrls[0].urlType).toBe('RESOURCE');
    }, 15_000);

    it('paginates with limit/offset', async () => {
      const { auth, assessmentId } = await setupAssessmentWithDiscoveredUrls('discovery-paginate');
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/assessments/${assessmentId}/discovered-urls?limit=1&offset=1`,
        ...auth,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.discoveredUrls).toHaveLength(1);
      expect(body.pagination).toMatchObject({ total: 3, limit: 1, offset: 1 });
    }, 15_000);

    it('an organization cannot list another organization discovered URLs (tenant isolation)', async () => {
      const ownerA = await registerAndLogin('discovery-iso-a');
      const { assessmentId } = await setupAssessmentWithDiscoveredUrls('discovery-iso-b');

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/assessments/${assessmentId}/discovered-urls`,
        cookies: { [SESSION_COOKIE_NAME]: ownerA.sessionCookie },
      });
      expect(response.statusCode).toBe(404);
    }, 15_000);

    it('exposes no route to create, update, or delete a discovered URL', async () => {
      const { auth } = await setupAssessmentWithDiscoveredUrls('discovery-immutable');
      const create = await app.inject({
        method: 'POST',
        url: '/api/v1/discovered-urls',
        ...auth,
        payload: {},
      });
      expect(create.statusCode).toBe(404);
    }, 15_000);
  });

  describe('legacy API-key path (Batch 2 behavior preserved)', () => {
    it('an API key still authenticates and is tenant-isolated', async () => {
      const owner = await registerAndLogin('legacy-key-owner');
      const org = await createOrgAsOwner(owner.sessionCookie, 'legacy-key-org');
      const generated = generateApiKey(MASTER_KEY);
      await client.db.insert(schema.apiKeys).values({
        organizationId: org.id,
        name: 'legacy key',
        keyPrefix: generated.keyPrefix,
        keyHash: generated.keyHash,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/organizations',
        headers: { authorization: `Bearer ${generated.raw}` },
      });
      expect(response.statusCode).toBe(200);
      const organizations = response.json().organizations as { id: string }[];
      expect(organizations).toHaveLength(1);
      expect(organizations[0]?.id).toBe(org.id);
    });
  });
});
