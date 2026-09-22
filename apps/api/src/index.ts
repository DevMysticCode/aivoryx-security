import { getConfig } from '@aivoryx/config';
import { createLogger } from '@aivoryx/logger';
import { createDbClient, createAuditService } from '@aivoryx/db';
import { createRedisConnection, checkRedisHealth } from '@aivoryx/queue';
import { buildServer } from './server.js';
import { createShutdownHandler } from './shutdown.js';

async function main(): Promise<void> {
  const config = getConfig();
  const logger = createLogger({ serviceName: 'api', level: config.logLevel });

  const dbClient = createDbClient(config.database.url);
  const redisConnection = createRedisConnection(config.redis.url);
  const audit = createAuditService(dbClient.db, {
    onError: (error) => logger.error({ err: error }, 'failed to record audit event'),
  });

  const app = buildServer({
    logger,
    checkDatabaseHealth: dbClient.healthCheck,
    checkRedisHealth: () => checkRedisHealth(redisConnection),
    db: dbClient.db,
    credentialMasterKey: config.security.credentialMasterKey,
    audit,
  });

  const shutdown = createShutdownHandler(logger, async () => {
    await app.close();
    await dbClient.close();
    await redisConnection.quit();
  });

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  try {
    await app.listen({ port: config.api.port, host: '0.0.0.0' });
  } catch (error) {
    logger.error({ err: error }, 'failed to start server');
    process.exit(1);
  }
}

void main();
