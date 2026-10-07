import { RequestLimiter } from '@aivoryx/scanner-core';

/**
 * Composes the existing (previously unwired) RequestLimiter at two levels:
 * one shared across the whole plan (every test execution in this assessment
 * draws from it), and one scoped to a single test execution. Both are the
 * exact same, already-tested primitive — this is deliberately not a new
 * budgeting mechanism, just the first place it's actually wired up. See
 * Batch 8 spec Part 9.
 */
export class ActiveTestBudget {
  private readonly planLimiter: RequestLimiter;

  constructor(planRequestBudget: number) {
    this.planLimiter = new RequestLimiter(planRequestBudget);
  }

  /** Scoped limiter for one test execution — consumes against both its own cap and the shared plan budget. */
  forExecution(perExecutionBudget: number): {
    consume: () => void;
    used: () => number;
  } {
    const executionLimiter = new RequestLimiter(perExecutionBudget);
    return {
      consume: () => {
        // Order matters: the plan-level cap is the authoritative one (it's
        // what actually protects the target from unbounded traffic), so it's
        // checked/consumed first — a plan-exhausted budget must stop
        // execution even if this particular test's own smaller cap hasn't
        // been reached yet.
        this.planLimiter.consume();
        executionLimiter.consume();
      },
      used: () => executionLimiter.count,
    };
  }

  get requestsUsed(): number {
    return this.planLimiter.count;
  }
}
