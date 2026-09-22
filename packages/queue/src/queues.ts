import { Queue, Worker, type QueueOptions, type WorkerOptions, type Processor } from 'bullmq';
import type { Redis } from 'ioredis';
import { QUEUE_NAMES, type QueueName } from './queue-names.js';
import type { QueueJobDataMap } from './job-types.js';

export function createQueue<TName extends QueueName>(
  name: TName,
  connection: Redis,
  options?: Omit<QueueOptions, 'connection'>,
): Queue<QueueJobDataMap[TName]> {
  return new Queue<QueueJobDataMap[TName]>(name, { connection, ...options });
}

export function createQueueWorker<TName extends QueueName>(
  name: TName,
  processor: Processor<QueueJobDataMap[TName]>,
  connection: Redis,
  options?: Omit<WorkerOptions, 'connection'>,
): Worker<QueueJobDataMap[TName]> {
  return new Worker<QueueJobDataMap[TName]>(name, processor, { connection, ...options });
}

export interface AppQueues {
  assessmentOrchestration: Queue<QueueJobDataMap[typeof QUEUE_NAMES.ASSESSMENT_ORCHESTRATION]>;
  assessmentJobs: Queue<QueueJobDataMap[typeof QUEUE_NAMES.ASSESSMENT_JOBS]>;
  reportGeneration: Queue<QueueJobDataMap[typeof QUEUE_NAMES.REPORT_GENERATION]>;
}

/** Creates the full set of application queues on a single shared connection. */
export function createAppQueues(connection: Redis): AppQueues {
  return {
    assessmentOrchestration: createQueue(QUEUE_NAMES.ASSESSMENT_ORCHESTRATION, connection),
    assessmentJobs: createQueue(QUEUE_NAMES.ASSESSMENT_JOBS, connection),
    reportGeneration: createQueue(QUEUE_NAMES.REPORT_GENERATION, connection),
  };
}

export async function closeAppQueues(queues: AppQueues): Promise<void> {
  await Promise.all(Object.values(queues).map((queue) => queue.close()));
}
