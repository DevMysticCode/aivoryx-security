import { QUEUE_NAMES } from './queue-names.js';

// Minimal placeholder shapes: enough to type the queue infrastructure now without
// committing to the full assessment/finding domain model, which lands in a later batch.

export interface AssessmentOrchestrationJobData {
  assessmentId: string;
}

export interface AssessmentJobData {
  assessmentJobId: string;
  assessmentId: string;
  scannerName: string;
}

export interface ReportGenerationJobData {
  reportId: string;
}

export interface QueueJobDataMap {
  [QUEUE_NAMES.ASSESSMENT_ORCHESTRATION]: AssessmentOrchestrationJobData;
  [QUEUE_NAMES.ASSESSMENT_JOBS]: AssessmentJobData;
  [QUEUE_NAMES.REPORT_GENERATION]: ReportGenerationJobData;
}
