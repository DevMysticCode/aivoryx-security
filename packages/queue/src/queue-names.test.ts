import { describe, expect, it } from 'vitest';
import { QUEUE_NAMES } from './queue-names.js';

describe('QUEUE_NAMES', () => {
  it('defines the three foundation queues with stable string names', () => {
    expect(QUEUE_NAMES).toEqual({
      ASSESSMENT_ORCHESTRATION: 'assessment-orchestration',
      ASSESSMENT_JOBS: 'assessment-jobs',
      REPORT_GENERATION: 'report-generation',
    });
  });
});
