import type { AssessmentScope } from '@aivoryx/shared-types';
import {
  RequestScheduler,
  ScopeViolationError,
  SsrfViolationError,
  ResourceLimitExceededError,
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
  FailureReason,
  Observation,
  SecurityResult,
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
  /** Reports a finding exactly like a ScannerPlugin would — same fingerprinting/evidence-sanitization pipeline (see apps/worker/src/assessment-processor.ts). Returns the finding's id (Batch 10) so the execution can be linked to it. */
  reportFinding: (input: ReportFindingInput) => Promise<string | null>;
  /** Persists one test×target execution record — called for every pair, including ones that never ran because the plan was cancelled or ran out of budget. */
  onExecution: (result: ActiveTestExecutionResult) => Promise<void>;
}

function summarizeObservation(observation: Observation): Record<string, unknown> {
  return {
    status: observation.status,
    contentType: observation.contentType,
    bodyLength: observation.bodyLength,
    bodyHash: observation.bodyHash,
    markersFound: observation.markersFound,
  };
}

/** Maps a caught error to a small, user-safe failure category — never exposes a raw stack trace (those stay in server-side logs only; see Batch 10 spec Part 16). */
function classifyFailureReason(error: unknown): FailureReason {
  if (error instanceof ScopeViolationError) return 'SCOPE_REJECTED';
  if (error instanceof SsrfViolationError) return 'SSRF_REJECTED';
  if (error instanceof ResourceLimitExceededError) return 'NETWORK_ERROR';
  return 'INTERNAL_ERROR';
}

function cancelledResult(
  definition: ActiveTestDefinition,
  target: BaselineRequestSpec,
): ActiveTestExecutionResult {
  return {
    testId: definition.id,
    testVersion: definition.version,
    target: target.url,
    status: 'CANCELLED',
    securityResult: null,
    requestsUsed: 0,
    mutationsAttempted: 0,
    findingsReported: 0,
    mutationResults: [],
    baseline: null,
    durationMs: 0,
  };
}

function budgetExhaustedResult(
  definition: ActiveTestDefinition,
  target: BaselineRequestSpec,
): ActiveTestExecutionResult {
  return {
    testId: definition.id,
    testVersion: definition.version,
    target: target.url,
    status: 'BUDGET_EXHAUSTED',
    securityResult: null,
    requestsUsed: 0,
    mutationsAttempted: 0,
    findingsReported: 0,
    mutationResults: [],
    baseline: null,
    durationMs: 0,
  };
}

/**
 * Runs one (target, definition) pair. Batch 10: checks `mutations()` BEFORE
 * spending the baseline request (an empty list means there is nothing this
 * definition can test against this target — e.g. no query parameters —
 * which is a SKIPPED outcome, not a wasted request followed by a
 * do-nothing COMPLETED). Budget exhaustion is now a normal return value
 * (`status: 'BUDGET_EXHAUSTED'` carrying whatever was genuinely attempted
 * so far), never a thrown exception that would discard that partial
 * progress — see Batch 10 spec Parts 1/2/8.
 */
async function runOnePair(
  target: BaselineRequestSpec,
  definition: ActiveTestDefinition,
  budget: ActiveTestBudget,
  scheduler: RequestScheduler,
  context: ActiveTestExecutorContext,
): Promise<ActiveTestExecutionResult> {
  const startedAt = Date.now();

  if (context.signal.aborted) {
    return cancelledResult(definition, target);
  }

  const mutations = definition.mutations(target);
  if (mutations.length === 0) {
    return {
      testId: definition.id,
      testVersion: definition.version,
      target: target.url,
      status: 'SKIPPED',
      securityResult: null,
      skipReason: 'NO_PARAMETERS',
      requestsUsed: 0,
      mutationsAttempted: 0,
      findingsReported: 0,
      mutationResults: [],
      baseline: null,
      durationMs: Date.now() - startedAt,
    };
  }

  const execution = budget.forExecution(definition.requestBudgetEstimate);
  let requestsUsed = 0;

  if (!execution.tryConsume()) {
    return budgetExhaustedResult(definition, target);
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
        securityResult: 'INCONCLUSIVE',
        failureReason: classifyFailureReason(error),
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

  const mutationResults: ActiveTestMutationAttempt[] = [];
  let findingsReported = 0;
  let sawFinding = false;
  let sawInconclusive = false;
  let budgetExhaustedMidPair = false;

  for (const mutation of mutations) {
    if (context.signal.aborted) break;

    if (!execution.tryConsume()) {
      budgetExhaustedMidPair = true;
      break;
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
      const classification = definition.classify(diff, baselineObservation, observation, mutation);

      let findingKey: string | null = null;
      let findingId: string | null = null;
      if (classification.securityResult === 'FINDING') {
        const candidate = classification.candidate;
        findingKey = candidate.key;
        findingsReported += 1;
        sawFinding = true;
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
        findingId = await context.reportFinding(reportInput);
      } else if (classification.securityResult === 'INCONCLUSIVE') {
        sawInconclusive = true;
      }

      mutationResults.push({
        mutation: { ...mutation },
        result: { ...diff },
        securityResult: classification.securityResult,
        findingKey,
        findingId,
      });
    } catch (error) {
      // A single mutation's request failing (timeout, resource limit) doesn't
      // fail the whole pair — other mutations may still succeed. Logged for
      // visibility; the pair's own status stays COMPLETED unless nothing at
      // all could be learned (handled by the fallback below).
      context.logger.warn(
        { testId: definition.id, target: target.url, err: String(error) },
        'active test mutation request failed; continuing to next mutation',
      );
      mutationResults.push({
        mutation: { ...mutation },
        result: null,
        securityResult: 'INCONCLUSIVE',
        findingKey: null,
        findingId: null,
      });
      sawInconclusive = true;
    } finally {
      release();
    }
  }

  const securityResult: SecurityResult = sawFinding
    ? 'FINDING'
    : sawInconclusive
      ? 'INCONCLUSIVE'
      : 'NO_FINDING';

  return {
    testId: definition.id,
    testVersion: definition.version,
    target: target.url,
    status: budgetExhaustedMidPair ? 'BUDGET_EXHAUSTED' : 'COMPLETED',
    securityResult: budgetExhaustedMidPair ? null : securityResult,
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
 * budget before each request. Stops once a pair reports BUDGET_EXHAUSTED or
 * CANCELLED, recording every not-yet-attempted pair with an honest
 * terminal status rather than silently omitting it. See Batch 8 spec Parts
 * 9/11; Batch 10 spec Parts 1/2/8 for the request-accounting fix.
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
  let stoppedEarly: 'BUDGET_EXHAUSTED' | 'CANCELLED' | null = null;

  for (let i = 0; i < pairs.length; i += 1) {
    const { target, definition } = pairs[i]!;

    if (!stoppedEarly && context.signal.aborted) {
      stoppedEarly = 'CANCELLED';
    }

    if (stoppedEarly) {
      testsSkippedCount += 1;
      await context.onExecution(
        stoppedEarly === 'CANCELLED'
          ? cancelledResult(definition, target)
          : budgetExhaustedResult(definition, target),
      );
      continue;
    }

    const result = await runOnePair(target, definition, budget, scheduler, context);
    if (result.status === 'FAILED') testsFailedCount += 1;
    else if (result.status === 'BUDGET_EXHAUSTED') {
      stoppedEarly = 'BUDGET_EXHAUSTED';
      testsSkippedCount += 1;
    } else if (result.status === 'CANCELLED') {
      stoppedEarly = 'CANCELLED';
      testsSkippedCount += 1;
    } else if (result.status === 'SKIPPED') {
      testsSkippedCount += 1;
    } else {
      testsCompletedCount += 1;
    }
    await context.onExecution(result);
  }

  return {
    status: stoppedEarly ?? 'COMPLETED',
    testsSelectedCount: pairs.length,
    testsCompletedCount,
    testsFailedCount,
    testsSkippedCount,
    // Authoritative — the budget's own counter, not a re-summed total. See
    // ActiveTestPlanResult.requestsUsed's doc comment.
    requestsUsed: budget.requestsUsed,
  };
}
