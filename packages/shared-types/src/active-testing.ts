// Active-testing plan/execution lifecycle types (Batch 8) — the framework
// future vulnerability scanners (XSS, SQLi, etc.) will plug into. A plan is
// 1:1 with an Assessment; an execution is one test definition run against
// one baseline target. See packages/active-testing-core.

export const ACTIVE_TEST_PLAN_STATUSES = [
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'BUDGET_EXHAUSTED',
  'SKIPPED',
] as const;
export type ActiveTestPlanStatus = (typeof ACTIVE_TEST_PLAN_STATUSES)[number];

export const ACTIVE_TEST_EXECUTION_STATUSES = [
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'BUDGET_EXHAUSTED',
  'SKIPPED',
] as const;
export type ActiveTestExecutionStatus = (typeof ACTIVE_TEST_EXECUTION_STATUSES)[number];

export function isActiveTestPlanStatus(value: string): value is ActiveTestPlanStatus {
  return (ACTIVE_TEST_PLAN_STATUSES as readonly string[]).includes(value);
}

export function isActiveTestExecutionStatus(value: string): value is ActiveTestExecutionStatus {
  return (ACTIVE_TEST_EXECUTION_STATUSES as readonly string[]).includes(value);
}
