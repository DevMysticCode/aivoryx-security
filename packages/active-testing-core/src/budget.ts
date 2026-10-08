import { RequestLimiter } from '@aivoryx/scanner-core';

/**
 * Composes the existing RequestLimiter at two levels: one shared across the
 * whole plan (every test execution in this assessment draws from it), and
 * one scoped to a single test execution. Both are the exact same,
 * already-tested primitive — this is deliberately not a new budgeting
 * mechanism, just the first place it's actually wired up (Batch 8).
 *
 * Batch 10: `tryConsume()` replaces the old throw-on-exceeded `consume()`.
 * It checks BOTH limiters' capacity before committing to either — so a
 * reservation that would be rejected never increments anything (the old
 * RequestLimiter.consume() incremented first and threw second, meaning a
 * single rejected attempt phantom-incremented the counter by one). The two
 * `hasCapacity()` checks and the two commits all happen synchronously, with
 * no `await` between them, so this remains safe under the executor's
 * concurrent scheduling — there is no window for two callers to both
 * observe capacity and overshoot.
 */
export class ActiveTestBudget {
  private readonly planLimiter: RequestLimiter;

  constructor(planRequestBudget: number) {
    this.planLimiter = new RequestLimiter(planRequestBudget);
  }

  /** Scoped limiter for one test execution — reserves against both its own cap and the shared plan budget. */
  forExecution(perExecutionBudget: number): {
    /** Returns true and commits the reservation if both the plan and this execution have room; returns false and commits nothing otherwise. Never throws. */
    tryConsume: () => boolean;
    used: () => number;
  } {
    const executionLimiter = new RequestLimiter(perExecutionBudget);
    return {
      tryConsume: () => {
        if (!this.planLimiter.hasCapacity() || !executionLimiter.hasCapacity()) {
          return false;
        }
        // Both have room, verified above with no await in between — safe to
        // commit both now. consume() is guaranteed not to throw here.
        this.planLimiter.consume();
        executionLimiter.consume();
        return true;
      },
      used: () => executionLimiter.count,
    };
  }

  get requestsUsed(): number {
    return this.planLimiter.count;
  }
}
