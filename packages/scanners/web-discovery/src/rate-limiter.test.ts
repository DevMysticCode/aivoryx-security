import { describe, expect, it } from 'vitest';
import { RequestScheduler } from './rate-limiter.js';

describe('RequestScheduler', () => {
  it('never allows more than maxConcurrent acquisitions to be outstanding at once', async () => {
    const scheduler = new RequestScheduler(2, 1000);
    let active = 0;
    let maxActive = 0;

    async function task() {
      const release = await scheduler.acquire();
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active -= 1;
      release();
    }

    await Promise.all([task(), task(), task(), task(), task()]);
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it('spaces out request starts to respect requestsPerSecond', async () => {
    const scheduler = new RequestScheduler(10, 20); // 20/s => 50ms between starts
    const starts: number[] = [];

    for (let i = 0; i < 3; i += 1) {
      const release = await scheduler.acquire();
      starts.push(Date.now());
      release();
    }

    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(40);
    expect(starts[2]! - starts[1]!).toBeGreaterThanOrEqual(40);
  });

  it('release() is idempotent (calling it twice does not free two slots)', async () => {
    const scheduler = new RequestScheduler(1, 1000);
    const release1 = await scheduler.acquire();
    release1();
    release1(); // second call must be a no-op

    let secondAcquired = false;
    const p = scheduler.acquire().then((release2) => {
      secondAcquired = true;
      release2();
    });
    await p;
    expect(secondAcquired).toBe(true);
  });
});
