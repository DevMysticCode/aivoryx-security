import { randomUUID } from 'node:crypto';
import Fastify, {
  type FastifyInstance,
  type FastifyBaseLogger,
  type FastifyError,
  type FastifyRequest,
} from 'fastify';
import helmet from '@fastify/helmet';
import { z } from 'zod';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { Logger } from '@aivoryx/logger';
import { schema, type AuditService } from '@aivoryx/db';
import { requireTenant } from '@aivoryx/auth';
import { registerAuthContext, requireAuthenticated } from './auth/context.js';
import { createOrganizationsService, type RequestContext } from './services/organizations.js';
import { createProjectsService } from './services/projects.js';
import { createApiKeysService } from './services/api-keys.js';

export interface HealthCheckResult {
  healthy: boolean;
  latencyMs?: number;
  error?: string;
}

export interface ServerDependencies {
  logger: Logger;
  checkDatabaseHealth: () => Promise<HealthCheckResult>;
  checkRedisHealth: () => Promise<HealthCheckResult>;
  db: PostgresJsDatabase<typeof schema>;
  credentialMasterKey: string;
  audit: AuditService;
}

interface ErrorEnvelope {
  error: {
    message: string;
    statusCode: number;
    requestId: string;
  };
}

function errorEnvelope(statusCode: number, message: string, requestId: string): ErrorEnvelope {
  return { error: { message, statusCode, requestId } };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}

function requestContext(request: FastifyRequest): RequestContext {
  const userAgent = request.headers['user-agent'];
  return { ipAddress: request.ip, userAgent };
}

const createOrganizationBodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'slug must be lowercase alphanumeric with optional hyphens'),
});

const createProjectBodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'slug must be lowercase alphanumeric with optional hyphens'),
  description: z.string().max(2_000).optional(),
});

const createApiKeyBodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  expiresAt: z.string().datetime().optional(),
});

function badRequest(
  reply: { status: (code: number) => { send: (body: unknown) => unknown } },
  requestId: string,
  issues: z.ZodIssue[],
) {
  const message = issues.map((issue) => issue.message).join('; ');
  return reply.status(400).send(errorEnvelope(400, message || 'Invalid request body', requestId));
}

/**
 * Builds a fully configured Fastify instance without starting an HTTP listener,
 * so it can be exercised in tests via `app.inject()` and reused by the real
 * entrypoint (index.ts), which additionally calls `app.listen()`.
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

  // --- Public, unauthenticated ---------------------------------------------

  app.get('/api/v1/health', async () => ({
    status: 'ok',
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  }));

  app.get('/api/v1/ready', async (_request, reply) => {
    const [database, redis] = await Promise.all([
      deps.checkDatabaseHealth(),
      deps.checkRedisHealth(),
    ]);
    const healthy = database.healthy && redis.healthy;

    reply.status(healthy ? 200 : 503);
    return {
      status: healthy ? 'ready' : 'not_ready',
      checks: { database, redis },
      timestamp: new Date().toISOString(),
    };
  });

  // --- Authenticated ---------------------------------------------------------

  const organizationsService = createOrganizationsService({ db: deps.db, audit: deps.audit });
  const projectsService = createProjectsService({ db: deps.db, audit: deps.audit });
  const apiKeysService = createApiKeysService({
    db: deps.db,
    audit: deps.audit,
    credentialMasterKey: deps.credentialMasterKey,
  });

  // Reflects whichever principal actually authenticated the request (API-key
  // auth only, in this batch — see docs/authorization.md). Not a user-profile
  // endpoint: there is no user-login provider yet to back one honestly.
  app.get('/api/v1/me', async (request) => {
    const principal = requireAuthenticated(request);
    return { principal };
  });

  app.get('/api/v1/organizations', async (request) => {
    const principal = requireAuthenticated(request);
    const organizations = await organizationsService.listVisibleTo(principal);
    return { organizations };
  });

  app.post('/api/v1/organizations', async (request, reply) => {
    const principal = requireAuthenticated(request);
    const parsed = createOrganizationBodySchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, request.id, parsed.error.issues);

    const organization = await organizationsService.create(
      principal,
      parsed.data,
      requestContext(request),
    );
    reply.status(201);
    return { organization };
  });

  app.get('/api/v1/projects', async (request) => {
    const principal = requireTenant(requireAuthenticated(request));
    const projects = await projectsService.list(principal);
    return { projects };
  });

  app.post('/api/v1/projects', async (request, reply) => {
    const principal = requireTenant(requireAuthenticated(request));
    const parsed = createProjectBodySchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, request.id, parsed.error.issues);

    try {
      const project = await projectsService.create(principal, parsed.data, requestContext(request));
      reply.status(201);
      return { project };
    } catch (error) {
      if (isUniqueViolation(error)) {
        return reply
          .status(409)
          .send(
            errorEnvelope(
              409,
              'A project with this slug already exists in your organization',
              request.id,
            ),
          );
      }
      throw error;
    }
  });

  app.get('/api/v1/projects/:projectId', async (request, reply) => {
    const principal = requireTenant(requireAuthenticated(request));
    const { projectId } = request.params as { projectId: string };

    const project = await projectsService.getById(principal, projectId);
    if (!project) return reply.status(404).send(errorEnvelope(404, 'Not found', request.id));
    return { project };
  });

  app.get('/api/v1/api-keys', async (request) => {
    const principal = requireTenant(requireAuthenticated(request));
    const apiKeys = await apiKeysService.list(principal);
    return { apiKeys };
  });

  app.post('/api/v1/api-keys', async (request, reply) => {
    const principal = requireTenant(requireAuthenticated(request));
    const parsed = createApiKeyBodySchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, request.id, parsed.error.issues);

    const created = await apiKeysService.create(
      principal,
      {
        name: parsed.data.name,
        expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : undefined,
      },
      requestContext(request),
    );
    reply.status(201);
    // rawKey is present exactly once, in this response, and nowhere else.
    return { apiKey: created };
  });

  app.delete('/api/v1/api-keys/:apiKeyId', async (request, reply) => {
    const principal = requireTenant(requireAuthenticated(request));
    const { apiKeyId } = request.params as { apiKeyId: string };

    const revoked = await apiKeysService.revoke(principal, apiKeyId, requestContext(request));
    if (!revoked) return reply.status(404).send(errorEnvelope(404, 'Not found', request.id));
    return { apiKey: revoked };
  });

  return app;
}
