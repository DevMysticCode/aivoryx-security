import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyBaseLogger, type FastifyError } from 'fastify';
import helmet from '@fastify/helmet';
import type { Logger } from '@aivoryx/logger';

export interface HealthCheckResult {
  healthy: boolean;
  latencyMs?: number;
  error?: string;
}

export interface ServerDependencies {
  logger: Logger;
  checkDatabaseHealth: () => Promise<HealthCheckResult>;
  checkRedisHealth: () => Promise<HealthCheckResult>;
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

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const statusCode = error.statusCode ?? 500;
    request.log.error({ err: error, statusCode }, 'unhandled request error');

    const message = statusCode >= 500 ? 'Internal server error' : error.message;
    reply.status(statusCode).send(errorEnvelope(statusCode, message, request.id));
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send(errorEnvelope(404, 'Not found', request.id));
  });

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

  return app;
}
