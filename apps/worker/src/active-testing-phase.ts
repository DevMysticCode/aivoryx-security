import { and, asc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { schema } from '@aivoryx/db';
import type { AppConfig } from '@aivoryx/config';
import type { Logger } from '@aivoryx/logger';
import type { AssessmentType, AssetType } from '@aivoryx/shared-types';
import {
  selectApplicableActiveTests,
  runActiveTestPlan,
  type ActiveTestDefinition,
  type ActiveTestExecutionResult,
} from '@aivoryx/active-testing-core';
import { WORKER_CAPABILITIES, type ScannerContext } from '@aivoryx/scanner-core';

export interface ActiveTestingPhaseDeps {
  db: PostgresJsDatabase<typeof schema>;
  logger: Logger;
  config: AppConfig;
  /**
   * Explicitly injected, exactly like AssessmentProcessorDeps.scannerRegistry
   * — production passes the empty ACTIVE_TEST_REGISTRY (see
   * apps/worker/src/index.ts); tests inject a fixture definition to exercise
   * this phase end to end without ever shipping it. Never a hidden default.
   */
  activeTestRegistry: readonly ActiveTestDefinition[];
}

const MAX_ERROR_MESSAGE_LENGTH = 2000;

/**
 * Bounds how many discovered pages become active-testing baseline targets —
 * a site with hundreds of discovered pages must not turn active testing
 * into unbounded traffic (the plan-level request budget is the ultimate
 * backstop, but this keeps targeting itself bounded too). URLs that
 * actually carry a query string are prioritized first, since those are the
 * ones any mutation-based scanner can meaningfully test — a generic,
 * framework-level heuristic, not XSS-specific. Local constant, same
 * precedent as web-discovery's DEFAULT_CRAWL_LIMITS.
 */
const MAX_BASELINE_TARGETS = 25;

/**
 * Runs after the existing scanner-plugin loop (discovery/passive analysis)
 * completes. Zero active test definitions ship in production this batch
 * (see packages/active-testing-core's ACTIVE_TEST_REGISTRY), so in practice
 * this only ever records an honest SKIPPED plan row — the machinery below
 * exists so a future batch can register a real definition without touching
 * the worker's integration point again. A failure in this phase marks the
 * *active test plan* row FAILED and is logged, but never fails the overall
 * assessment — discovery/passive analysis remain authoritative for
 * assessment success, since this phase is additive. See Batch 8 spec Part 8.
 */
export async function runActiveTestingPhase(
  deps: ActiveTestingPhaseDeps,
  assessment: { id: string; assessmentType: AssessmentType },
  asset: { assetType: AssetType },
  context: ScannerContext,
): Promise<void> {
  const applicable = selectApplicableActiveTests(
    deps.activeTestRegistry,
    asset.assetType,
    assessment.assessmentType,
    WORKER_CAPABILITIES,
  );

  // Idempotent: a BullMQ retry of the whole assessment job must never create
  // a second plan row — assessmentId is unique. If one already exists (from
  // an earlier attempt), there's nothing more for this phase to do.
  const [plan] = await deps.db
    .insert(schema.activeTestPlans)
    .values({
      assessmentId: assessment.id,
      status: applicable.length === 0 ? 'SKIPPED' : 'RUNNING',
      requestBudget: deps.config.security.activeTestingDefaultRequestBudget,
      startedAt: new Date(),
    })
    .onConflictDoNothing({ target: schema.activeTestPlans.assessmentId })
    .returning();

  if (!plan) {
    deps.logger.info(
      { assessmentId: assessment.id },
      'active test plan already exists for this assessment; skipping',
    );
    return;
  }

  if (applicable.length === 0) {
    await deps.db
      .update(schema.activeTestPlans)
      .set({ completedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.activeTestPlans.id, plan.id));
    return;
  }

  // Baseline targets are the assessment's already-persisted discovered pages
  // (Batch 6) — reused, never re-crawled. See Batch 8 spec Part 7.
  const discoveredPages = await deps.db
    .select()
    .from(schema.discoveredUrls)
    .where(
      and(
        eq(schema.discoveredUrls.assessmentId, assessment.id),
        eq(schema.discoveredUrls.urlType, 'PAGE'),
      ),
    )
    .orderBy(asc(schema.discoveredUrls.createdAt), asc(schema.discoveredUrls.id));

  const withQueryString = discoveredPages.filter((row) => row.url.includes('?'));
  const withoutQueryString = discoveredPages.filter((row) => !row.url.includes('?'));
  const baselineTargets = [...withQueryString, ...withoutQueryString]
    .slice(0, MAX_BASELINE_TARGETS)
    .map((row) => ({ url: row.url, method: 'GET' as const }));

  try {
    const result = await runActiveTestPlan({
      baselineTargets,
      definitions: applicable,
      httpClient: context.httpClient,
      scope: context.scope,
      logger: context.logger,
      signal: context.signal,
      requestBudget: deps.config.security.activeTestingDefaultRequestBudget,
      maxConcurrentRequests: deps.config.security.activeTestingMaxConcurrentRequests,
      requestsPerSecond: deps.config.security.activeTestingRequestsPerSecond,
      reportFinding: context.reportFinding,
      onExecution: (execution) => persistExecution(deps, plan.id, assessment.id, execution),
    });

    await deps.db
      .update(schema.activeTestPlans)
      .set({
        status: result.status,
        requestsUsed: result.requestsUsed,
        testsSelectedCount: result.testsSelectedCount,
        testsCompletedCount: result.testsCompletedCount,
        testsFailedCount: result.testsFailedCount,
        testsSkippedCount: result.testsSkippedCount,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.activeTestPlans.id, plan.id));
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(
      0,
      MAX_ERROR_MESSAGE_LENGTH,
    );
    deps.logger.error(
      { assessmentId: assessment.id, err: message },
      'active testing phase failed; assessment lifecycle is unaffected',
    );
    await deps.db
      .update(schema.activeTestPlans)
      .set({
        status: 'FAILED',
        errorMessage: message,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.activeTestPlans.id, plan.id));
  }
}

/**
 * Persists one execution row, plus a link to every finding it produced
 * (Batch 10 — see active_test_execution_findings). Idempotent end to end:
 * if the execution row already exists (a BullMQ retry re-delivering the
 * same pair), its id is looked up instead so the finding links can still
 * be (re-)established — themselves idempotent via onConflictDoNothing on
 * the unique (execution, finding) pair — rather than silently skipping
 * linkage just because the execution row itself wasn't newly inserted.
 */
async function persistExecution(
  deps: ActiveTestingPhaseDeps,
  planId: string,
  assessmentId: string,
  execution: ActiveTestExecutionResult,
): Promise<void> {
  const [inserted] = await deps.db
    .insert(schema.activeTestExecutions)
    .values({
      planId,
      assessmentId,
      testId: execution.testId,
      testVersion: execution.testVersion,
      target: execution.target,
      status: execution.status,
      securityResult: execution.securityResult,
      skipReason: execution.skipReason ?? null,
      failureReason: execution.failureReason ?? null,
      requestsUsed: execution.requestsUsed,
      mutation: {
        mutationsAttempted: execution.mutationsAttempted,
        findingsReported: execution.findingsReported,
      },
      baseline: execution.baseline,
      result: { attempts: execution.mutationResults },
      errorMessage: execution.errorMessage ?? null,
      durationMs: execution.durationMs,
      completedAt: new Date(),
    })
    .onConflictDoNothing({
      target: [
        schema.activeTestExecutions.planId,
        schema.activeTestExecutions.testId,
        schema.activeTestExecutions.target,
      ],
    })
    .returning({ id: schema.activeTestExecutions.id });

  let executionId = inserted?.id;
  if (!executionId) {
    const [existing] = await deps.db
      .select({ id: schema.activeTestExecutions.id })
      .from(schema.activeTestExecutions)
      .where(
        and(
          eq(schema.activeTestExecutions.planId, planId),
          eq(schema.activeTestExecutions.testId, execution.testId),
          eq(schema.activeTestExecutions.target, execution.target),
        ),
      )
      .limit(1);
    executionId = existing?.id;
  }

  const findingIds = execution.mutationResults
    .map((attempt) => attempt.findingId)
    .filter((id): id is string => id !== null);

  if (executionId && findingIds.length > 0) {
    await deps.db
      .insert(schema.activeTestExecutionFindings)
      .values(findingIds.map((findingId) => ({ executionId: executionId!, findingId })))
      .onConflictDoNothing({
        target: [
          schema.activeTestExecutionFindings.executionId,
          schema.activeTestExecutionFindings.findingId,
        ],
      });
  }

  deps.logger.info(
    {
      executionId,
      testId: execution.testId,
      status: execution.status,
      securityResult: execution.securityResult,
      requestsUsed: execution.requestsUsed,
      findingsReported: execution.findingsReported,
      durationMs: execution.durationMs,
    },
    'active test execution persisted',
  );
}
