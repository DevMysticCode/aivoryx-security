import type { FastifyInstance } from 'fastify';

export interface HealthCheckResult {
  healthy: boolean;
  latencyMs?: number;
  error?: string;
}

export interface HealthRouteDependencies {
  checkDatabaseHealth: () => Promise<HealthCheckResult>;
  checkRedisHealth: () => Promise<HealthCheckResult>;
}

export function registerHealthRoutes(app: FastifyInstance, deps: HealthRouteDependencies): void {
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
}
