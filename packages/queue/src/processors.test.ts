import { describe, expect, it, vi } from 'vitest';
import type { Job } from 'bullmq';
import { createPlaceholderProcessor } from './processors.js';

describe('createPlaceholderProcessor', () => {
  it('acknowledges the job and logs its receipt without leaking job data', async () => {
    const info = vi.fn();
    const processor = createPlaceholderProcessor({ info }, 'assessment-jobs');
    const job = { id: 'job-1', name: 'test-job' } as Job<{ foo: string }>;

    const result = await processor(job);

    expect(result).toEqual({ acknowledged: true, jobId: 'job-1' });
    expect(info).toHaveBeenCalledWith(
      { jobId: 'job-1', jobName: 'test-job', queue: 'assessment-jobs' },
      'received placeholder job',
    );
  });

  it('falls back to "unknown" when a job has no id', async () => {
    const info = vi.fn();
    const processor = createPlaceholderProcessor({ info }, 'report-generation');
    const job = { id: undefined, name: 'test-job' } as Job<{ foo: string }>;

    const result = await processor(job);

    expect(result.jobId).toBe('unknown');
  });
});
