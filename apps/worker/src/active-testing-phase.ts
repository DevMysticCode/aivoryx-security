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
  const baselineTargets = discoveredPages.map((row) => ({ url: row.url, method: 'GET' as const }));

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

async function persistExecution(
  deps: ActiveTestingPhaseDeps,
  planId: string,
  assessmentId: string,
  execution: ActiveTestExecutionResult,
): Promise<void> {
  await deps.db
    .insert(schema.activeTestExecutions)
    .values({
      planId,
      assessmentId,
      testId: execution.testId,
      testVersion: execution.testVersion,
      target: execution.target,
      status: execution.status,
      requestsUsed: execution.requestsUsed,
      mutation: execution.mutation,
      baseline: execution.baseline,
      result: execution.result,
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
    });
}
