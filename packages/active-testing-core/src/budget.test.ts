import { describe, expect, it } from 'vitest';
import { ResourceLimitExceededError } from '@aivoryx/scanner-core';
import { ActiveTestBudget } from './budget.js';

describe('ActiveTestBudget', () => {
  it('allows consumption up to the plan-level cap', () => {
    const budget = new ActiveTestBudget(3);
    const execution = budget.forExecution(10);
    execution.consume();
    execution.consume();
    execution.consume();
    expect(budget.requestsUsed).toBe(3);
  });

  it('throws once the plan-level cap is exceeded, even across multiple executions', () => {
    const budget = new ActiveTestBudget(2);
    const first = budget.forExecution(10);
    const second = budget.forExecution(10);
    first.consume();
    second.consume();
    expect(() => second.consume()).toThrow(ResourceLimitExceededError);
  });

  it('throws once a single execution exceeds its own smaller per-execution cap, even though the plan budget has room', () => {
    const budget = new ActiveTestBudget(100);
    const execution = budget.forExecution(2);
    execution.consume();
    execution.consume();
    expect(() => execution.consume()).toThrow(ResourceLimitExceededError);
  });

  it('keeps throwing on every subsequent attempt once exhausted, never silently allowing a retry through', () => {
    const budget = new ActiveTestBudget(1);
    const execution = budget.forExecution(10);
    execution.consume();
    expect(() => execution.consume()).toThrow(ResourceLimitExceededError);
    expect(() => execution.consume()).toThrow(ResourceLimitExceededError);
  });
});
