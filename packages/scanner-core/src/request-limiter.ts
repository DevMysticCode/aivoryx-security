import { ResourceLimitExceededError } from './errors.js';

/**
 * Caps the total number of outbound HTTP requests a single scanner run may
 * issue. Deliberately distinct from worker/BullMQ concurrency (how many jobs
 * run at once) — this bounds how many requests ONE job makes against ONE
 * target, so a single reachability assessment can never balloon into
 * hundreds of requests. See Part S.
 */
export class RequestLimiter {
  private used = 0;

  constructor(private readonly maxRequests: number) {}

  consume(): void {
    this.used += 1;
    if (this.used > this.maxRequests) {
      throw new ResourceLimitExceededError(
        `Scanner exceeded the maximum of ${this.maxRequests} outbound requests for this assessment`,
      );
    }
  }

  get count(): number {
    return this.used;
  }
}
