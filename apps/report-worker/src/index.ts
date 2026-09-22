import { getConfig } from '@aivoryx/config';
import { createLogger, withContext } from '@aivoryx/logger';
import {
  createRedisConnection,
  createQueueWorker,
  createPlaceholderProcessor,
  QUEUE_NAMES,
} from '@aivoryx/queue';
import { createShutdownHandler } from './shutdown.js';

async function main(): Promise<void> {
  const config = getConfig();
  const logger = createLogger({ serviceName: 'report-worker', level: config.logLevel });
  const connection = createRedisConnection(config.redis.url);

  const worker = createQueueWorker(
    QUEUE_NAMES.REPORT_GENERATION,
    createPlaceholderProcessor(
      withContext(logger, { queue: QUEUE_NAMES.REPORT_GENERATION }),
      QUEUE_NAMES.REPORT_GENERATION,
    ),
    connection,
    { concurrency: config.security.workerConcurrency },
  );

  worker.on('completed', (job) => logger.info({ jobId: job.id }, 'report job completed'));
  worker.on('failed', (job, err) => logger.error({ jobId: job?.id, err }, 'report job failed'));
  worker.on('error', (err) => logger.error({ err }, 'worker connection error'));

  logger.info(
    { queue: worker.name, concurrency: config.security.workerConcurrency },
    'report worker started',
  );

  const shutdown = createShutdownHandler(logger, async () => {
    await worker.close();
    await connection.quit();
  });

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void main();
