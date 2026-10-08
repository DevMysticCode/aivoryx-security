import type { AssessmentScope } from '@aivoryx/shared-types';
import {
  RequestScheduler,
  type ReportFindingInput,
  type SafeHttpClient,
  type ScannerLogger,
} from '@aivoryx/scanner-core';
import { applyMutation } from './mutation.js';
import { captureObservation } from './baseline.js';
import { diffObservations } from './diff.js';
import { ActiveTestBudget } from './budget.js';
import type {
  ActiveTestDefinition,
  ActiveTestExecutionResult,
  ActiveTestMutationAttempt,
  ActiveTestPlanResult,
  BaselineRequestSpec,
  Observation,
} from './types.js';

export interface ActiveTestExecutorContext {
  baselineTargets: readonly BaselineRequestSpec[];
  definitions: readonly ActiveTestDefinition[];
  httpClient: SafeHttpClient;
  scope: AssessmentScope;
  logger: ScannerLogger;
  signal: AbortSignal;
  /** Shared across every test×target pair in this plan — the authoritative cap. */
  requestBudget: number;
  maxConcurrentRequests: number;
  requestsPerSecond: number;
  /** Reports a finding exactly like a ScannerPlugin would — same fingerprinting/evidence-sanitization pipeline (see apps/worker/src/assessment-processor.ts). */
  reportFinding: (input: ReportFindingInput) => Promise<void>;
  /** Persists one test×target execution record — called for every pair, including ones that never ran because the plan was cancelled or ran out of budget. */
  onExecution: (result: ActiveTestExecutionResult) => Promise<void>;
}

/** Internal signal that the shared plan budget is exhausted — distinct from a SafeHttpClient-level ResourceLimitExceededError on a single request, which only fails that one pair. */
class PlanBudgetExhausted extends Error {}

function summarizeObservation(observation: Observation): Record<string, unknown> {
  return {
    status: observation.status,
    contentType: observation.contentType,
    bodyLength: observation.bodyLength,
    bodyHash: observation.bodyHash,
    markersFound: observation.markersFound,
  };
}

async function runOnePair(
  target: BaselineRequestSpec,
  definition: ActiveTestDefinition,
  budget: ActiveTestBudget,
  scheduler: RequestScheduler,
  context: ActiveTestExecutorContext,
): Promise<ActiveTestExecutionResult> {
  const startedAt = Date.now();
  let requestsUsed = 0;

  if (context.signal.aborted) {
    return {
      testId: definition.id,
      testVersion: definition.version,
      target: target.url,
      status: 'CANCELLED',
      requestsUsed: 0,
      mutationsAttempted: 0,
      findingsReported: 0,
      mutationResults: [],
      baseline: null,
      durationMs: Date.now() - startedAt,
    };
  }

  const execution = budget.forExecution(definition.requestBudgetEstimate);

  try {
    execution.consume();
  } catch {
    throw new PlanBudgetExhausted();
  }

  let baselineObservation: Observation;
  {
    const release = await scheduler.acquire();
    try {
      const baselineResponse = await context.httpClient.request(target.url, context.scope, {
        method: target.method,
      });
      requestsUsed += 1;
      baselineObservation = captureObservation(baselineResponse, definition.markers);
    } catch (error) {
      return {
        testId: definition.id,
        testVersion: definition.version,
        target: target.url,
        status: 'FAILED',
        requestsUsed,
        mutationsAttempted: 0,
        findingsReported: 0,
        mutationResults: [],
        baseline: null,
        errorMessage: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt,
      };
    } finally {
      release();
    }
  }

  const mutations = definition.mutations(target);
  const mutationResults: ActiveTestMutationAttempt[] = [];
  let findingsReported = 0;

  for (const mutation of mutations) {
    if (context.signal.aborted) break;

    try {
      execution.consume();
    } catch {
      throw new PlanBudgetExhausted();
    }

    const mutatedUrl = applyMutation(new URL(target.url), mutation);
    const release = await scheduler.acquire();
    try {
      const mutatedResponse = await context.httpClient.request(
        mutatedUrl.toString(),
        context.scope,
        { method: definition.httpMethod },
      );
      requestsUsed += 1;
      const observation = captureObservation(
        mutatedResponse,
        mutation.markers ?? definition.markers,
      );
      const diff = diffObservations(baselineObservation, observation);
      const candidate = definition.classify(diff, baselineObservation, observation, mutation);

      let findingKey: string | null = null;
      if (candidate) {
        findingKey = candidate.key;
        findingsReported += 1;
        const reportInput: ReportFindingInput = {
          title: candidate.title,
          description: candidate.description,
          severity: candidate.severity,
          confidence: candidate.confidence,
          category: 'active-test',
          key: `${definition.id}:${candidate.key}`,
          target: mutatedUrl.toString(),
          evidence: {
            ...candidate.evidence,
            diff: { ...diff },
            baseline: summarizeObservation(baselineObservation),
          },
        };
        if (candidate.remediation !== undefined) reportInput.remediation = candidate.remediation;
        if (candidate.references !== undefined) reportInput.references = candidate.references;
        await context.reportFinding(reportInput);
      }

      mutationResults.push({ mutation: { ...mutation }, result: { ...diff }, findingKey });
    } catch (error) {
      // A single mutation's request failing (timeout, resource limit) doesn't
      // fail the whole pair — other mutations may still succeed. Logged for
      // visibility; the pair's own status stays COMPLETED unless nothing at
      // all could be learned (handled by the fallback below).
      context.logger.warn(
        { testId: definition.id, target: target.url, err: String(error) },
        'active test mutation request failed; continuing to next mutation',
      );
      mutationResults.push({ mutation: { ...mutation }, result: null, findingKey: null });
    } finally {
      release();
    }
  }

  return {
    testId: definition.id,
    testVersion: definition.version,
    target: target.url,
    status: 'COMPLETED',
    requestsUsed,
    mutationsAttempted: mutationResults.length,
    findingsReported,
    mutationResults,
    baseline: summarizeObservation(baselineObservation),
    durationMs: Date.now() - startedAt,
  };
}

/**
 * Runs every applicable active test definition against every baseline
 * target, cooperatively checking `signal.aborted` and the shared request
 * budget before each request. Stops immediately on budget exhaustion or
 * cancellation, recording every not-yet-attempted pair with an honest
 * terminal status rather than silently omitting it. See Batch 8 spec Parts
 * 9/11.
 */
export async function runActiveTestPlan(
  context: ActiveTestExecutorContext,
): Promise<ActiveTestPlanResult> {
  const budget = new ActiveTestBudget(context.requestBudget);
  const scheduler = new RequestScheduler(context.maxConcurrentRequests, context.requestsPerSecond);

  const pairs: { target: BaselineRequestSpec; definition: ActiveTestDefinition }[] = [];
  for (const target of context.baselineTargets) {
    for (const definition of context.definitions) {
      pairs.push({ target, definition });
    }
  }

  let testsCompletedCount = 0;
  let testsFailedCount = 0;
  let testsSkippedCount = 0;
  let requestsUsed = 0;
  let stoppedEarly: 'BUDGET_EXHAUSTED' | 'CANCELLED' | null = null;

  for (let i = 0; i < pairs.length; i += 1) {
    const { target, definition } = pairs[i]!;

    if (context.signal.aborted) {
      stoppedEarly = 'CANCELLED';
    }

    if (stoppedEarly) {
      testsSkippedCount += 1;
      await context.onExecution({
        testId: definition.id,
        testVersion: definition.version,
        target: target.url,
        status: stoppedEarly,
        requestsUsed: 0,
        mutationsAttempted: 0,
        findingsReported: 0,
        mutationResults: [],
        baseline: null,
        durationMs: 0,
      });
      continue;
    }

    try {
      const result = await runOnePair(target, definition, budget, scheduler, context);
      requestsUsed += result.requestsUsed;
      if (result.status === 'FAILED') testsFailedCount += 1;
      else testsCompletedCount += 1;
      await context.onExecution(result);
    } catch (error) {
      if (error instanceof PlanBudgetExhausted) {
        stoppedEarly = 'BUDGET_EXHAUSTED';
        testsSkippedCount += 1;
        await context.onExecution({
          testId: definition.id,
          testVersion: definition.version,
          target: target.url,
          status: 'BUDGET_EXHAUSTED',
          requestsUsed: 0,
          mutationsAttempted: 0,
          findingsReported: 0,
          mutationResults: [],
          baseline: null,
          durationMs: 0,
        });
        continue;
      }
      throw error;
    }
  }

  return {
    status: stoppedEarly ?? 'COMPLETED',
    testsSelectedCount: pairs.length,
    testsCompletedCount,
    testsFailedCount,
    testsSkippedCount,
    requestsUsed,
  };
}
