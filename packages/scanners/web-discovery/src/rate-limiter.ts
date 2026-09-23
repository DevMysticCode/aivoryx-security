// Bounded concurrency + a minimum spacing between request starts (Part 12).
// Deliberately simple (a semaphore plus a "don't start before" timestamp)
// rather than a full token-bucket — enough to guarantee the crawler can
// never have more than `maxConcurrent` requests in flight or start requests
// faster than `requestsPerSecond`, and simple enough to reason about in tests.

export class RequestScheduler {
  private active = 0;
  private nextAllowedStartMs = 0;
  private readonly minIntervalMs: number;
  private readonly waiters: (() => void)[] = [];

  constructor(
    private readonly maxConcurrent: number,
    requestsPerSecond: number,
  ) {
    this.minIntervalMs = requestsPerSecond > 0 ? 1000 / requestsPerSecond : 0;
  }

  /** Resolves once a concurrency slot is free AND the rate-limit spacing has elapsed. Caller MUST call the returned release function exactly once. */
  async acquire(): Promise<() => void> {
    await this.acquireSlot();

    const now = Date.now();
    const waitMs = Math.max(0, this.nextAllowedStartMs - now);
    this.nextAllowedStartMs = Math.max(now, this.nextAllowedStartMs) + this.minIntervalMs;
    if (waitMs > 0) await sleep(waitMs);

    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.release();
    };
  }

  // `active` is only ever mutated here (on grant) and in release() — both
  // synchronous with respect to each other — so there is no window where
  // two callers can both observe a free slot and overshoot maxConcurrent.
  private acquireSlot(): Promise<void> {
    if (this.active < this.maxConcurrent) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.waiters.push(() => {
        this.active += 1;
        resolve();
      });
    });
  }

  private release(): void {
    this.active -= 1;
    const next = this.waiters.shift();
    if (next) next();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
