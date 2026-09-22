export { createRedisConnection, checkRedisHealth } from './connection.js';
export type { CreateRedisConnectionOptions, RedisHealthCheckResult } from './connection.js';

export { QUEUE_NAMES } from './queue-names.js';
export type { QueueName } from './queue-names.js';

export type {
  AssessmentOrchestrationJobData,
  AssessmentJobData,
  ReportGenerationJobData,
  QueueJobDataMap,
} from './job-types.js';

export { createQueue, createQueueWorker, createAppQueues, closeAppQueues } from './queues.js';
export type { AppQueues } from './queues.js';

export { createPlaceholderProcessor } from './processors.js';
export type { JobLogger, PlaceholderJobResult } from './processors.js';
