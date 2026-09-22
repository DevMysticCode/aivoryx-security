import { getConfig } from '@aivoryx/config';
import { createLogger, withContext } from '@aivoryx/logger';
import { createDbClient } from '@aivoryx/db';
import {
  createRedisConnection,
  createQueueWorker,
  createPlaceholderProcessor,
  QUEUE_NAMES,
} from '@aivoryx/queue';
import { SCANNER_REGISTRY } from '@aivoryx/scanner-http-reachability';
import { createShutdownHandler } from './shutdown.js';
import { createAssessmentJobProcessor } from './assessment-processor.js';

async function main(): Promise<void> {
  const config = getConfig();
  const logger = createLogger({ serviceName: 'worker', level: config.logLevel });
  const connection = createRedisConnection(config.redis.url);
  const dbClient = createDbClient(config.database.url);

  const assessmentJobProcessor = createAssessmentJobProcessor({
    db: dbClient.db,
    logger: withContext(logger, { queue: QUEUE_NAMES.ASSESSMENT_JOBS }),
    config,
    // The scanner plugin registry this worker process can run. Only http-
    // reachability exists in this batch — see Part L / docs/security-model.md.
    scannerRegistry: SCANNER_REGISTRY,
  });

  const workers = [
    // Still a placeholder — no per-assessment orchestration/fan-out logic
    // exists yet; apps/api enqueues directly onto ASSESSMENT_JOBS.
    createQueueWorker(
      QUEUE_NAMES.ASSESSMENT_ORCHESTRATION,
      createPlaceholderProcessor(
        withContext(logger, { queue: QUEUE_NAMES.ASSESSMENT_ORCHESTRATION }),
        QUEUE_NAMES.ASSESSMENT_ORCHESTRATION,
      ),
      connection,
      { concurrency: config.security.workerConcurrency },
    ),
    createQueueWorker(QUEUE_NAMES.ASSESSMENT_JOBS, assessmentJobProcessor, connection, {
      concurrency: config.security.workerConcurrency,
    }),
  ];

  for (const worker of workers) {
    worker.on('completed', (job) =>
      logger.info({ jobId: job.id, queue: worker.name }, 'job completed'),
    );
    worker.on('failed', (job, err) =>
      logger.error({ jobId: job?.id, queue: worker.name, err }, 'job failed'),
    );
    worker.on('error', (err) =>
      logger.error({ err, queue: worker.name }, 'worker connection error'),
    );
  }

  logger.info(
    {
      queues: workers.map((worker) => worker.name),
      concurrency: config.security.workerConcurrency,
    },
    'worker started',
  );

  const shutdown = createShutdownHandler(logger, async () => {
    await Promise.all(workers.map((worker) => worker.close()));
    await dbClient.close();
    await connection.quit();
  });

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void main();
