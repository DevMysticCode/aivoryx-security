import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { Job } from 'bullmq';
import { schema } from '@aivoryx/db';
import type { AssessmentJobData } from '@aivoryx/queue';
import type { AppConfig } from '@aivoryx/config';
import type { Logger } from '@aivoryx/logger';
import {
  SafeHttpClient,
  ScopeViolationError,
  SsrfViolationError,
  ResourceLimitExceededError,
  UnsupportedAssessmentTypeError,
  WORKER_CAPABILITIES,
  selectApplicablePlugins,
  computeFindingFingerprint,
  type ScannerContext,
  type ScannerPlugin,
  type ReportFindingInput,
} from '@aivoryx/scanner-core';

export interface AssessmentProcessorDeps {
  db: PostgresJsDatabase<typeof schema>;
  logger: Logger;
  config: AppConfig;
  scannerRegistry: readonly ScannerPlugin[];
}

const MAX_EVIDENCE_BYTES = 8_000;
const SECRET_KEY_PATTERN = /(secret|password|token|api[_-]?key|credential|authorization|cookie)/i;
const MAX_ERROR_MESSAGE_LENGTH = 2000;

/** Never persist raw secrets/cookies/auth headers in evidence, and bound its size. See Part N. */
function sanitizeEvidence(evidence: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(evidence)) {
    redacted[key] = SECRET_KEY_PATTERN.test(key) ? '[redacted]' : value;
  }
  const serialized = JSON.stringify(redacted);
  if (serialized.length > MAX_EVIDENCE_BYTES) {
    return { truncated: true, originalSizeBytes: serialized.length };
  }
  return redacted;
}

/** Prefixes a persisted failure message with its stable machine code (e.g. UNSUPPORTED_ASSESSMENT_TYPE), when the error carries one, so failure reasons stay structured and grep-/alert-able rather than free text only. */
function toPersistableErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const code =
    error instanceof Error &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string'
      ? (error as { code: string }).code
      : undefined;
  return (code ? `[${code}] ${message}` : message).slice(0, MAX_ERROR_MESSAGE_LENGTH);
}

function isPermanentFailure(error: unknown): boolean {
  return (
    error instanceof ScopeViolationError ||
    error instanceof SsrfViolationError ||
    error instanceof ResourceLimitExceededError ||
    error instanceof UnsupportedAssessmentTypeError
  );
}

/**
 * Builds the BullMQ processor for the assessment-jobs queue: the control
 * plane (apps/api) only ever enqueues an id pair, never trusted scanner
 * selection — this processor loads the authoritative assessment/asset state
 * from the database itself and decides which scanner(s) apply. See Part P.
 */
export function createAssessmentJobProcessor(deps: AssessmentProcessorDeps) {
  return async function processAssessmentJob(job: Job<AssessmentJobData>): Promise<void> {
    const { assessmentJobId, assessmentId } = job.data;
    const log = deps.logger;

    const [jobRow] = await deps.db
      .select()
      .from(schema.assessmentJobs)
      .where(eq(schema.assessmentJobs.id, assessmentJobId))
      .limit(1);
    if (!jobRow || jobRow.assessmentId !== assessmentId) {
      log.warn(
        { assessmentJobId, assessmentId },
        'assessment job row not found or mismatched; dropping',
      );
      return;
    }

    const [row] = await deps.db
      .select({ assessment: schema.assessments, asset: schema.assets })
      .from(schema.assessments)
      .innerJoin(schema.assets, eq(schema.assets.id, schema.assessments.assetId))
      .where(eq(schema.assessments.id, assessmentId))
      .limit(1);
    if (!row) {
      log.warn({ assessmentId }, 'assessment not found; dropping job');
      return;
    }
    const { assessment, asset } = row;

    if (assessment.status !== 'QUEUED') {
      // Already RUNNING/terminal — a duplicate delivery, a stale retry, or
      // an assessment the API already cancelled. Never overwrite a newer
      // state. See Part Q.
      log.info({ assessmentId, status: assessment.status }, 'assessment not QUEUED; skipping');
      return;
    }

    if (!asset.authorizationConfirmed) {
      // Defense in depth: apps/api already refuses to create an assessment
      // against an unauthorized asset, but authorization could in principle
      // be revoked after creation and before the worker picks the job up.
      await markFailed(
        deps,
        assessmentId,
        assessmentJobId,
        'QUEUED',
        'Asset authorization is not confirmed',
      );
      return;
    }

    const [claimed] = await deps.db
      .update(schema.assessments)
      .set({ status: 'RUNNING', startedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(schema.assessments.id, assessmentId), eq(schema.assessments.status, 'QUEUED')))
      .returning();
    if (!claimed) {
      log.info({ assessmentId }, 'assessment claimed by another attempt; skipping');
      return;
    }
    await deps.db
      .update(schema.assessmentJobs)
      .set({
        status: 'RUNNING',
        startedAt: new Date(),
        updatedAt: new Date(),
        attemptCount: jobRow.attemptCount + 1,
      })
      .where(eq(schema.assessmentJobs.id, assessmentJobId));

    const startedAt = Date.now();

    try {
      const plugins = selectApplicablePlugins(
        deps.scannerRegistry,
        asset.assetType,
        assessment.assessmentType,
        WORKER_CAPABILITIES,
      );

      if (plugins.length === 0) {
        // COMPLETED must mean the assessment actually ran. No scanner
        // implementing this asset-type/assessment-type combination is a
        // permanent failure, not a quiet success with zero findings — see
        // docs/security-model.md.
        throw new UnsupportedAssessmentTypeError(
          `No scanner implements assessmentType=${assessment.assessmentType} for assetType=${asset.assetType}`,
        );
      }

      const httpClient = new SafeHttpClient({
        connectTimeoutMs: deps.config.security.connectTimeoutMs,
        requestTimeoutMs: deps.config.security.scanTimeoutMs,
        maxRedirects: deps.config.security.maxRedirects,
        maxResponseBytes: deps.config.security.maxResponseBytes,
        maxHeaderBytes: deps.config.security.maxHeaderBytes,
        allowPrivateRanges: deps.config.security.ssrfAllowPrivateRanges,
      });

      // Not tied to any external cancellation signal yet — an assessment
      // already RUNNING cannot currently be cancelled mid-flight; only a
      // QUEUED one can (POST /assessments/:id/cancel). See "Known limitations".
      const abortController = new AbortController();

      const scannerLogger = {
        info: (obj: Record<string, unknown>, msg?: string) => log.info(obj, msg),
        warn: (obj: Record<string, unknown>, msg?: string) => log.warn(obj, msg),
        error: (obj: Record<string, unknown>, msg?: string) => log.error(obj, msg),
      };

      for (const plugin of plugins) {
        const context: ScannerContext = {
          assessment: { id: assessment.id, assessmentType: assessment.assessmentType },
          asset: { id: asset.id, assetType: asset.assetType, config: asset.config },
          scope: assessment.scope,
          httpClient,
          logger: scannerLogger,
          signal: abortController.signal,
          reportFinding: (input: ReportFindingInput) =>
            persistFinding(deps, assessmentId, plugin.name, input),
        };
        await plugin.run(context);
      }

      await markCompleted(deps, assessmentId, assessmentJobId);
      log.info(
        { assessmentId, assessmentJobId, durationMs: Date.now() - startedAt },
        'assessment completed',
      );
    } catch (error) {
      const permanent = isPermanentFailure(error);
      const message = toPersistableErrorMessage(error);
      log.error({ assessmentId, err: message, permanent }, 'assessment execution failed');

      await deps.db
        .update(schema.assessments)
        .set({
          status: 'FAILED',
          errorMessage: message,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(eq(schema.assessments.id, assessmentId), eq(schema.assessments.status, 'RUNNING')),
        );
      await deps.db
        .update(schema.assessmentJobs)
        .set({
          status: 'FAILED',
          errorMessage: message,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.assessmentJobs.id, assessmentJobId));

      if (!permanent) {
        // A genuinely unexpected error (e.g. a scanner programming error, a
        // transient DB write failure) — rethrow so BullMQ's own attempts/
        // backoff (configured at enqueue time) can retry it. A permanent,
        // security-relevant failure (scope/SSRF/resource-limit) must never
        // be retried — retrying it would just fail identically forever, or
        // worse, mask a real policy violation as "still trying". See Part R.
        throw error;
      }
    }
  };
}

async function persistFinding(
  deps: AssessmentProcessorDeps,
  assessmentId: string,
  scannerName: string,
  input: ReportFindingInput,
): Promise<void> {
  const fingerprint = computeFindingFingerprint({
    assessmentId,
    scanner: scannerName,
    category: input.category,
    target: input.target,
    key: input.key,
  });

  const [finding] = await deps.db
    .insert(schema.findings)
    .values({
      assessmentId,
      scanner: scannerName,
      title: input.title,
      description: input.description,
      severity: input.severity,
      confidence: input.confidence,
      category: input.category,
      target: input.target,
      fingerprint,
    })
    .onConflictDoNothing({ target: [schema.findings.assessmentId, schema.findings.fingerprint] })
    .returning();

  // A conflict (finding already exists) is expected on a retried job — see
  // Part O — and is not an error; there's simply nothing new to insert evidence for.
  if (finding && input.evidence) {
    await deps.db
      .insert(schema.evidence)
      .values({ findingId: finding.id, data: sanitizeEvidence(input.evidence) });
  }
}

async function markCompleted(
  deps: AssessmentProcessorDeps,
  assessmentId: string,
  assessmentJobId: string,
): Promise<void> {
  await deps.db
    .update(schema.assessments)
    .set({ status: 'COMPLETED', completedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(schema.assessments.id, assessmentId), eq(schema.assessments.status, 'RUNNING')));
  await deps.db
    .update(schema.assessmentJobs)
    .set({ status: 'COMPLETED', completedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.assessmentJobs.id, assessmentJobId));
}

async function markFailed(
  deps: AssessmentProcessorDeps,
  assessmentId: string,
  assessmentJobId: string,
  fromStatus: 'QUEUED' | 'RUNNING',
  reason: string,
): Promise<void> {
  deps.logger.error({ assessmentId, reason }, 'assessment cannot execute');
  await deps.db
    .update(schema.assessments)
    .set({ status: 'FAILED', errorMessage: reason, completedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(schema.assessments.id, assessmentId), eq(schema.assessments.status, fromStatus)));
  await deps.db
    .update(schema.assessmentJobs)
    .set({ status: 'FAILED', errorMessage: reason, completedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.assessmentJobs.id, assessmentJobId));
}
