import { describe, expect, it } from 'vitest';
import { ActiveTestBudget } from './budget.js';

describe('ActiveTestBudget', () => {
  it('allows consumption up to the plan-level cap', () => {
    const budget = new ActiveTestBudget(3);
    const execution = budget.forExecution(10);
    expect(execution.tryConsume()).toBe(true);
    expect(execution.tryConsume()).toBe(true);
    expect(execution.tryConsume()).toBe(true);
    expect(budget.requestsUsed).toBe(3);
  });

  it('returns false once the plan-level cap is exceeded, even across multiple executions', () => {
    const budget = new ActiveTestBudget(2);
    const first = budget.forExecution(10);
    const second = budget.forExecution(10);
    expect(first.tryConsume()).toBe(true);
    expect(second.tryConsume()).toBe(true);
    expect(second.tryConsume()).toBe(false);
  });

  it('returns false once a single execution exceeds its own smaller per-execution cap, even though the plan budget has room', () => {
    const budget = new ActiveTestBudget(100);
    const execution = budget.forExecution(2);
    expect(execution.tryConsume()).toBe(true);
    expect(execution.tryConsume()).toBe(true);
    expect(execution.tryConsume()).toBe(false);
  });

  it('keeps returning false on every subsequent attempt once exhausted, never silently allowing a retry through', () => {
    const budget = new ActiveTestBudget(1);
    const execution = budget.forExecution(10);
    expect(execution.tryConsume()).toBe(true);
    expect(execution.tryConsume()).toBe(false);
    expect(execution.tryConsume()).toBe(false);
  });

  it('a rejected attempt NEVER increments the counter — no phantom/over-counting (Batch 10)', () => {
    const budget = new ActiveTestBudget(2);
    const execution = budget.forExecution(10);
    execution.tryConsume();
    execution.tryConsume();
    // Both of these must be rejected and must NOT bump requestsUsed past 2 —
    // the old throw-on-exceeded RequestLimiter.consume() incremented first
    // and threw second, so a single rejected attempt would have left
    // requestsUsed at 3 here instead of the true count of 2.
    execution.tryConsume();
    execution.tryConsume();
    expect(budget.requestsUsed).toBe(2);
  });

  it('a rejected attempt at the per-execution cap does not leak a phantom increment into the shared plan counter', () => {
    const budget = new ActiveTestBudget(100);
    const execution = budget.forExecution(1);
    expect(execution.tryConsume()).toBe(true);
    expect(execution.tryConsume()).toBe(false);
    expect(execution.tryConsume()).toBe(false);
    // Only the one genuinely-committed request should count against the
    // shared plan budget — the two rejected attempts must not have
    // incremented the plan limiter before the per-execution check failed.
    expect(budget.requestsUsed).toBe(1);
  });

  it('never allows two concurrent reservations to jointly overshoot a cap of 1 (no check-then-act race)', async () => {
    const budget = new ActiveTestBudget(1);
    const a = budget.forExecution(10);
    const b = budget.forExecution(10);
    // Both calls are synchronous (no await inside tryConsume), so calling
    // them "concurrently" here just proves the second one sees the first's
    // committed state — there is no interleaving window in real concurrent
    // use either, since JS has no pre-emption between synchronous statements.
    const results = [a.tryConsume(), b.tryConsume()];
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(budget.requestsUsed).toBe(1);
  });
});
