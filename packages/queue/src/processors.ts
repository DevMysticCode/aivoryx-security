import type { Job } from 'bullmq';

/** Minimal logging surface a processor needs — avoids depending on @aivoryx/logger. */
export interface JobLogger {
  info: (obj: Record<string, unknown>, msg?: string) => void;
}

export interface PlaceholderJobResult {
  acknowledged: true;
  jobId: string;
}

/**
 * A no-op job processor that logs receipt of a job and acknowledges it. Used by
 * apps/worker and apps/report-worker to prove the queue/worker wiring end to end
 * before any real scanning or report-generation logic exists.
 */
export function createPlaceholderProcessor<TData>(
  logger: JobLogger,
  queueName: string,
): (job: Job<TData>) => Promise<PlaceholderJobResult> {
  return async (job) => {
    logger.info({ jobId: job.id, jobName: job.name, queue: queueName }, 'received placeholder job');
    return { acknowledged: true, jobId: job.id ?? 'unknown' };
  };
}
