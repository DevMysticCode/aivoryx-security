/**
 * Every BullMQ queue the platform uses. Business processing for these is added in
 * later batches — this batch only establishes names, typed job data, and the
 * queue/worker construction infrastructure.
 */
export const QUEUE_NAMES = {
  /** One job per assessment: fans out into per-scanner ASSESSMENT_JOBS. */
  ASSESSMENT_ORCHESTRATION: 'assessment-orchestration',
  /** One job per scanner plugin run against one asset. */
  ASSESSMENT_JOBS: 'assessment-jobs',
  /** One job per report generation request. */
  REPORT_GENERATION: 'report-generation',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];
