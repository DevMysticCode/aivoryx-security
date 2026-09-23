import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyBaseLogger, type FastifyError } from 'fastify';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import type { Queue } from 'bullmq';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { Logger } from '@aivoryx/logger';
import { schema, type AuditService } from '@aivoryx/db';
import type { AssessmentJobData } from '@aivoryx/queue';
import { registerAuthContext } from './auth/context.js';
import { errorEnvelope } from './http.js';
import { createAuthService } from './services/auth.js';
import { createOrganizationsService } from './services/organizations.js';
import { createMembersService } from './services/members.js';
import { createProjectsService } from './services/projects.js';
import { createAssetsService } from './services/assets.js';
import { createAssessmentsService } from './services/assessments.js';
import { createApiKeysService } from './services/api-keys.js';
import { createPlatformService } from './services/platform.js';
import { registerHealthRoutes, type HealthCheckResult } from './routes/health.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerOrganizationRoutes } from './routes/organizations.js';
import { registerProjectRoutes } from './routes/projects.js';
import { registerAssetRoutes } from './routes/assets.js';
import { registerAssessmentRoutes } from './routes/assessments.js';
import { registerApiKeyRoutes } from './routes/api-keys.js';
import { registerPlatformRoutes } from './routes/platform.js';

export type { HealthCheckResult } from './routes/health.js';

export interface ServerDependencies {
  logger: Logger;
  checkDatabaseHealth: () => Promise<HealthCheckResult>;
  checkRedisHealth: () => Promise<HealthCheckResult>;
  db: PostgresJsDatabase<typeof schema>;
  credentialMasterKey: string;
  audit: AuditService;
  assessmentJobsQueue: Queue<AssessmentJobData>;
  isProduction: boolean;
  /** Origins allowed to make credentialed cross-origin requests (the frontend's own origin(s)) — see Part frontend-architecture.md's "API client" section. */
  corsOrigins: string[];
}

/**
 * Builds a fully configured Fastify instance without starting an HTTP listener,
 * so it can be exercised in tests via `app.inject()` and reused by the real
 * entrypoint (index.ts), which additionally calls `app.listen()`.
 *
 * Authentication: every route except /health and /ready supports both a
 * session cookie (browser/human users) and an `Authorization: Bearer <api key>`
 * header (programmatic access) — see docs/authorization.md for exactly which
 * mechanism each route accepts and why.
 */
export function buildServer(deps: ServerDependencies): FastifyInstance {
  const app = Fastify({
    // pino's Logger type is structurally a superset of FastifyBaseLogger at runtime,
    // but doesn't satisfy it exactly under exactOptionalPropertyTypes; the cast is
    // type-level only and changes no runtime behavior.
    loggerInstance: deps.logger as unknown as FastifyBaseLogger,
    genReqId: (request) => {
      const header = request.headers['x-request-id'];
      const headerValue = Array.isArray(header) ? header[0] : header;
      return headerValue && headerValue.length > 0 ? headerValue : randomUUID();
    },
  });

  void app.register(helmet);
  void app.register(cookie);
  // Credentialed cross-origin requests are only ever allowed from the
  // frontend's own configured origin(s) — never a wildcard, since the
  // session cookie must never be sent to an untrusted origin.
  // @fastify/cors defaults `methods` to only 'GET,HEAD,POST' — every
  // PATCH/DELETE route in this API (organization settings, assets, members,
  // API keys, ...) needs those listed explicitly or the browser's preflight
  // rejects them before the request ever reaches a route handler.
  void app.register(cors, {
    origin: deps.corsOrigins,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE'],
  });
  void app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
  });

  registerAuthContext(app, { db: deps.db, credentialMasterKey: deps.credentialMasterKey });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const statusCode = error.statusCode ?? 500;
    request.log.error({ err: error, statusCode }, 'unhandled request error');

    const message = statusCode >= 500 ? 'Internal server error' : error.message;
    reply.status(statusCode).send(errorEnvelope(statusCode, message, request.id));
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send(errorEnvelope(404, 'Not found', request.id));
  });

  registerHealthRoutes(app, {
    checkDatabaseHealth: deps.checkDatabaseHealth,
    checkRedisHealth: deps.checkRedisHealth,
  });

  const authService = createAuthService({
    db: deps.db,
    audit: deps.audit,
    credentialMasterKey: deps.credentialMasterKey,
  });
  const organizationsService = createOrganizationsService({ db: deps.db, audit: deps.audit });
  const membersService = createMembersService({ db: deps.db, audit: deps.audit });
  const projectsService = createProjectsService({ db: deps.db, audit: deps.audit });
  const assetsService = createAssetsService({ db: deps.db, audit: deps.audit });
  const assessmentsService = createAssessmentsService({
    db: deps.db,
    audit: deps.audit,
    assessmentJobsQueue: deps.assessmentJobsQueue,
  });
  const apiKeysService = createApiKeysService({
    db: deps.db,
    audit: deps.audit,
    credentialMasterKey: deps.credentialMasterKey,
  });
  const platformService = createPlatformService({ db: deps.db });

  registerAuthRoutes(app, { authService, isProduction: deps.isProduction });
  registerOrganizationRoutes(app, { organizationsService, membersService });
  registerProjectRoutes(app, { projectsService });
  registerAssetRoutes(app, { assetsService });
  registerAssessmentRoutes(app, { assessmentsService });
  registerApiKeyRoutes(app, { apiKeysService });
  registerPlatformRoutes(app, { platformService });

  return app;
}
