import { describe, expect, it } from 'vitest';
import type { Worker } from 'bullmq';
import { createRedisConnection } from './connection.js';
import { QUEUE_NAMES } from './queue-names.js';
import { createQueue, createQueueWorker } from './queues.js';
import type { ReportGenerationJobData } from './job-types.js';

// Requires a live Redis instance. Run via:
//   pnpm infra:up
//   TEST_REDIS_URL=redis://localhost:6379 pnpm --filter @aivoryx/queue test:integration
const REDIS_URL = process.env.TEST_REDIS_URL;

describe.skipIf(!REDIS_URL)('queue infrastructure (integration)', () => {
  it('a job enqueued on a queue is consumed by a worker on the same queue', async () => {
    const connection = createRedisConnection(REDIS_URL as string);
    const queue = createQueue(QUEUE_NAMES.REPORT_GENERATION, connection);

    let worker: Worker<ReportGenerationJobData> | undefined;
    const processed = new Promise<ReportGenerationJobData>((resolve, reject) => {
      worker = createQueueWorker(
        QUEUE_NAMES.REPORT_GENERATION,
        async (job) => {
          return job.data;
        },
        connection,
      );
      worker.on('completed', (job) => resolve(job.returnvalue));
      worker.on('failed', (_job, error) => reject(error));
    });

    await queue.add('integration-test-job', { reportId: 'test-report-id' });

    const result = await processed;
    expect(result).toEqual({ reportId: 'test-report-id' });

    await worker?.close();
    await queue.close();
    await connection.quit();
  }, 15_000);
});
