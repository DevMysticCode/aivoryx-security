import { getConfig } from '@aivoryx/config';
import { createLogger } from '@aivoryx/logger';
import { createDbClient, createAuditService } from '@aivoryx/db';
import { createRedisConnection, checkRedisHealth, createQueue, QUEUE_NAMES } from '@aivoryx/queue';
import { buildServer } from './server.js';
import { createShutdownHandler } from './shutdown.js';

async function main(): Promise<void> {
  const config = getConfig();
  const logger = createLogger({ serviceName: 'api', level: config.logLevel });

  const dbClient = createDbClient(config.database.url);
  const redisConnection = createRedisConnection(config.redis.url);
  const assessmentJobsQueue = createQueue(QUEUE_NAMES.ASSESSMENT_JOBS, redisConnection);
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
    assessmentJobsQueue,
    isProduction: config.isProduction,
    corsOrigins: [config.urls.publicAppUrl],
  });

  const shutdown = createShutdownHandler(logger, async () => {
    await app.close();
    await assessmentJobsQueue.close();
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
