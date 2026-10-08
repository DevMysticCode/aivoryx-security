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

// Batch 10: the security verdict is a separate axis from the execution
// status above — "the test ran fine and found nothing" (COMPLETED +
// NO_FINDING) is a different fact from "the test could not be run" (FAILED
// + INCONCLUSIVE). See packages/active-testing-core's ActiveTestClassification.

export const ACTIVE_TEST_SECURITY_RESULTS = ['NO_FINDING', 'FINDING', 'INCONCLUSIVE'] as const;
export type ActiveTestSecurityResult = (typeof ACTIVE_TEST_SECURITY_RESULTS)[number];

export const ACTIVE_TEST_SKIP_REASONS = [
  'NO_ELIGIBLE_TARGETS',
  'NO_PARAMETERS',
  'UNSUPPORTED_CONTENT_TYPE',
  'LIMIT_REACHED',
  'UNSUPPORTED_ASSET_TYPE',
  'MISSING_CAPABILITY',
] as const;
export type ActiveTestSkipReason = (typeof ACTIVE_TEST_SKIP_REASONS)[number];

export const ACTIVE_TEST_FAILURE_REASONS = [
  'NETWORK_ERROR',
  'SCOPE_REJECTED',
  'SSRF_REJECTED',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
  'INVALID_TEST_CONFIGURATION',
] as const;
export type ActiveTestFailureReason = (typeof ACTIVE_TEST_FAILURE_REASONS)[number];
