import type {
  AssessmentType,
  AssetType,
  FindingConfidence,
  FindingSeverity,
} from '@aivoryx/shared-types';
import type { WorkerCapability } from '@aivoryx/scanner-core';

/**
 * The security verdict, independent of whether the execution itself
 * completed successfully (see ActiveTestExecutionResult.status, the
 * "execution outcome"). Batch 10: these are deliberately two separate
 * axes — "the test ran fine and found nothing" (COMPLETED + NO_FINDING) is
 * not the same fact as "the test could not be run" (FAILED + INCONCLUSIVE).
 */
export const SECURITY_RESULTS = ['NO_FINDING', 'FINDING', 'INCONCLUSIVE'] as const;
export type SecurityResult = (typeof SECURITY_RESULTS)[number];

/** Why an execution was SKIPPED rather than attempted. */
export const SKIP_REASONS = [
  'NO_ELIGIBLE_TARGETS',
  'NO_PARAMETERS',
  'UNSUPPORTED_CONTENT_TYPE',
  'LIMIT_REACHED',
  'UNSUPPORTED_ASSET_TYPE',
  'MISSING_CAPABILITY',
] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

/** Why an execution FAILED — a small, bounded, user-safe vocabulary; never a raw stack trace (those stay in server logs only). */
export const FAILURE_REASONS = [
  'NETWORK_ERROR',
  'SCOPE_REJECTED',
  'SSRF_REJECTED',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
  'INVALID_TEST_CONFIGURATION',
] as const;
export type FailureReason = (typeof FAILURE_REASONS)[number];

/**
 * Only SAFE_READ_ONLY is a constructible value this batch — the type is a
 * single-member literal, not a broader union, so a future test definition
 * cannot accidentally declare itself state-changing. POTENTIALLY_STATE_CHANGING
 * is documented as a future concept (see docs on this batch) but deliberately
 * not added to this union yet; introducing it is a reviewed, separate change
 * that must come with a non-GET/HEAD-capable SafeHttpClient and its own
 * explicit opt-in, not a side effect of this framework landing.
 */
export type ActiveTestSafety = 'SAFE_READ_ONLY';

/** The only HTTP methods SafeHttpClient supports — see packages/scanner-core/src/http-client.ts. */
export type ActiveTestHttpMethod = 'GET' | 'HEAD';

/**
 * A controlled, explicitly-typed request variation — never an arbitrary raw
 * HTTP request. Header mutation is intentionally not a variant yet: SafeHttpClient
 * doesn't accept custom request headers today, and extending the only
 * sanctioned egress path to allow caller-supplied headers is a reviewed
 * change of its own, not something to add as a side effect of this batch.
 *
 * `markers`, when present, are the marker strings THIS specific mutation
 * expects to find reflected — used in place of the definition-level static
 * `markers` list when capturing the mutated observation (see executor.ts).
 * This lets a definition whose mutations each carry a different, per-
 * parameter canary (e.g. reflected-XSS) still use the existing
 * markersFound/markersDetected diff mechanism, which only ever worked off a
 * single static list before Batch 9.
 */
export type RequestMutation =
  | { kind: 'query-param'; name: string; value: string; markers?: readonly string[] }
  | { kind: 'path-segment'; index: number; value: string; markers?: readonly string[] };

/** One baseline target an active test may run against — sourced from the assessment's already-persisted discovered_urls (Batch 6), never re-crawled. */
export interface BaselineRequestSpec {
  url: string;
  method: ActiveTestHttpMethod;
}

/**
 * Structured facts about one HTTP response, plus the raw decoded body for
 * in-process, classify-time-only analysis (e.g. reflected-XSS context/
 * encoding analysis, which needs to see WHERE a marker landed, not just
 * whether it did). `body` is never included in anything persisted —
 * executor.ts's summarizeObservation() (the only function whose output
 * reaches evidence/the database) excludes it entirely, so the "never
 * persist a raw response body" invariant from Batch 8 is unaffected past
 * that boundary.
 */
export interface Observation {
  status: number;
  headers: Record<string, string>;
  contentType: string | null;
  bodyLength: number;
  /** sha256 of the raw body — lets the diff engine detect "body changed" without persisting the body itself. */
  bodyHash: string;
  /** Which of the applicable marker strings (mutation-level if provided, else the definition's static list) were found in the (in-memory only) body. */
  markersFound: string[];
  /** The decoded response text itself — in-memory only, for classify()'s use. Never persisted; see summarizeObservation(). */
  body: string;
}

/** Facts only — no vulnerability verdict. A test definition's classify() interprets these. */
export interface ObservationDiff {
  statusChanged: boolean;
  headersChanged: string[];
  contentTypeChanged: boolean;
  bodyChanged: boolean;
  bodyLengthDelta: number;
  /** Marker strings present in the mutated response but absent from the baseline. */
  markersDetected: string[];
}

/** What a test definition's classify() returns when it believes a mutation surfaced something worth reporting. Never persisted directly — the executor turns this into a ReportFindingInput via the existing finding pipeline. */
export interface ActiveTestFindingCandidate {
  title: string;
  description: string;
  severity: FindingSeverity;
  confidence: FindingConfidence;
  /** A short, stable identifier for this specific observation within the test — combined with the test id and target to build the dedup fingerprint, exactly like ReportFindingInput.key. */
  key: string;
  remediation?: string;
  references?: string[];
  /**
   * Optional test-specific evidence (e.g. a bounded response snippet,
   * encoding/context classification) merged into the finding's evidence
   * alongside the generic diff/baseline facts the executor always attaches
   * — see executor.ts. Subject to the same sanitization/size-capping as
   * any other evidence (apps/worker/src/assessment-processor.ts's
   * sanitizeEvidence); never put raw secrets/cookies/full response bodies
   * here.
   */
  evidence?: Record<string, unknown>;
}

/**
 * The full, structured outcome of classifying one mutation's observation —
 * what a test definition's classify() returns (Batch 10). Deliberately a
 * discriminated union rather than `ActiveTestFindingCandidate | null`: a
 * definition must say explicitly whether it found nothing (confidently) or
 * could not determine an answer at all (INCONCLUSIVE) — these are different
 * facts for reporting (see Batch 10 spec Part 5/17). Most definitions will
 * only ever produce NO_FINDING/FINDING; INCONCLUSIVE exists for a future
 * scanner that genuinely needs it (e.g. one whose evidence was ambiguous)
 * and is not used by WEB-REFLECTED-XSS today.
 */
export type ActiveTestClassification =
  | { securityResult: 'FINDING'; candidate: ActiveTestFindingCandidate }
  | { securityResult: 'NO_FINDING' }
  | { securityResult: 'INCONCLUSIVE'; reason: string };

/**
 * A reusable, server-side-trusted definition of one active test. User input
 * selects/configures which definitions run against an assessment — it never
 * supplies executable test logic (see registry.ts). mutations()/classify()
 * are pure functions: no I/O, no SafeHttpClient access, so a definition
 * cannot smuggle an unsanctioned outbound request.
 */
export interface ActiveTestDefinition {
  /** Stable, human-assigned identifier, e.g. 'WEB-REFLECTED-XSS'. Never auto-generated — see registry.ts's duplicate-id rejection. */
  id: string;
  name: string;
  description: string;
  category: string;
  potentialSeverity: FindingSeverity;
  supportedAssetTypes: readonly AssetType[];
  supportedAssessmentTypes: readonly AssessmentType[];
  safety: ActiveTestSafety;
  httpMethod: ActiveTestHttpMethod;
  requiredCapabilities: readonly WorkerCapability[];
  requiresAuthContext: boolean;
  /** Rough upper bound on requests this one test definition issues per baseline target — used to size the plan-level budget, not enforced per-test on its own. */
  requestBudgetEstimate: number;
  version: string;
  /** Body-text markers to search for when diffing a mutated response against its baseline (see Observation.markersFound). */
  markers: readonly string[];
  /** Generates the controlled mutations to try against one baseline target. Pure — no I/O. */
  mutations: (baseline: BaselineRequestSpec) => RequestMutation[];
  /**
   * Interprets diff facts into a structured classification (Batch 10: see
   * ActiveTestClassification — always returns a definite answer, never
   * bare `null`). Pure — no I/O, no vulnerability verdict logic lives in
   * the generic diff engine (diff.ts). Receives the specific `mutation`
   * that produced `mutated` — added in Batch 9 so a definition whose
   * mutations carry per-parameter state (e.g. which query parameter, which
   * canary) can build a parameter-specific finding key/evidence without the
   * generic framework needing to know anything about parameters itself.
   */
  classify: (
    diff: ObservationDiff,
    baseline: Observation,
    mutated: Observation,
    mutation: RequestMutation,
  ) => ActiveTestClassification;
}

export interface ActiveTestPlanResult {
  status: 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'BUDGET_EXHAUSTED';
  testsSelectedCount: number;
  testsCompletedCount: number;
  testsFailedCount: number;
  testsSkippedCount: number;
  /**
   * Authoritative — read directly from the shared ActiveTestBudget's own
   * counter (Batch 10), not re-summed from each execution's own
   * requestsUsed. Every committed budget reservation corresponds to exactly
   * one real request attempt (see budget.ts's tryConsume/hasCapacity), so
   * this value can never under- or over-count regardless of how any
   * individual execution terminated.
   */
  requestsUsed: number;
  errorMessage?: string;
}

/** One mutation actually attempted within an execution, and what it produced. Bounded by however many mutations definition.mutations() returned — callers (e.g. reflected-XSS) are responsible for capping that list. */
export interface ActiveTestMutationAttempt {
  mutation: Record<string, unknown>;
  result: Record<string, unknown> | null;
  securityResult: SecurityResult;
  /** The finding candidate's key, if this mutation produced one — null otherwise. */
  findingKey: string | null;
  /** The persisted finding's id (see ScannerContext.reportFinding), if this mutation produced one — null otherwise. Used to populate active_test_execution_findings. */
  findingId: string | null;
}

export interface ActiveTestExecutionResult {
  testId: string;
  testVersion: string;
  target: string;
  status: 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'BUDGET_EXHAUSTED' | 'SKIPPED';
  /**
   * The security verdict for this execution as a whole — independent of
   * `status` (Batch 10 spec Part 5). Only meaningful when status is
   * COMPLETED (derived from mutationResults) or FAILED (always
   * INCONCLUSIVE — the scanner could not determine an answer); `null` for
   * CANCELLED/BUDGET_EXHAUSTED/SKIPPED, where no security judgement was
   * ever reached ("not applicable", not "no finding").
   */
  securityResult: SecurityResult | null;
  skipReason?: SkipReason;
  failureReason?: FailureReason;
  /** Authoritative count of real requests this execution issued — accurate even when it stopped early (BUDGET_EXHAUSTED mid-pair no longer discards this; see executor.ts). */
  requestsUsed: number;
  mutationsAttempted: number;
  findingsReported: number;
  mutationResults: ActiveTestMutationAttempt[];
  baseline: Record<string, unknown> | null;
  errorMessage?: string;
  durationMs: number;
}
