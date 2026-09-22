import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { Queue } from 'bullmq';
import { schema, type AuditService } from '@aivoryx/db';
import { hasPermission, requirePermission } from '@aivoryx/auth';
import {
  buildWebAssetScope,
  canTransitionAssessmentStatus,
  isAssessmentTypeCompatibleWithAsset,
  type AssessmentScope,
  type AssessmentType,
} from '@aivoryx/shared-types';
import type { AssessmentJobData } from '@aivoryx/queue';
import { DomainError } from '../domain-errors.js';
import { resolveTenantPrincipalForOrganization, type RequestIdentity } from '../auth/context.js';
import type { RequestContext } from './organizations.js';

export interface AssessmentsServiceDeps {
  db: PostgresJsDatabase<typeof schema>;
  audit: AuditService;
  assessmentJobsQueue: Queue<AssessmentJobData>;
}

export interface CreateAssessmentInput {
  assetId: string;
  assessmentType: AssessmentType;
  assetBuildId?: string | undefined;
}

const EMPTY_SCOPE: AssessmentScope = {
  schemes: [],
  hosts: [],
  ports: [],
  allowedPathPrefixes: [],
  exclusions: { hosts: [], paths: [] },
};

/**
 * Builds the technical scope this assessment's scanner(s) may contact,
 * snapshotted from the asset's config at creation time (immutable
 * afterward — see docs/security-model.md). Only WEB/API asset configs carry
 * a baseUrl today; ANDROID/IOS assessments get an empty scope, since no
 * scanner targets them yet (Part A/L).
 */
function computeScopeForAsset(config: unknown): AssessmentScope {
  if (config && typeof config === 'object' && 'baseUrl' in config) {
    try {
      return buildWebAssetScope(config as { baseUrl: string; additionalHosts?: string[] });
    } catch {
      return EMPTY_SCOPE;
    }
  }
  return EMPTY_SCOPE;
}

async function getProjectContext(
  deps: AssessmentsServiceDeps,
  identity: RequestIdentity,
  projectId: string,
) {
  const [project] = await deps.db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .limit(1);
  if (!project) return null;
  const principal = await resolveTenantPrincipalForOrganization(
    identity,
    project.organizationId,
    deps.db,
  );
  if (!principal) return null;
  return { project, principal };
}

async function getAssessmentContext(
  deps: AssessmentsServiceDeps,
  identity: RequestIdentity,
  assessmentId: string,
) {
  const [row] = await deps.db
    .select({ assessment: schema.assessments, project: schema.projects })
    .from(schema.assessments)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.assessments.projectId))
    .where(eq(schema.assessments.id, assessmentId))
    .limit(1);
  if (!row) return null;

  const principal = await resolveTenantPrincipalForOrganization(
    identity,
    row.project.organizationId,
    deps.db,
  );
  if (!principal) return null;

  return { assessment: row.assessment, project: row.project, principal };
}

export function createAssessmentsService(deps: AssessmentsServiceDeps) {
  return {
    async list(identity: RequestIdentity, projectId: string) {
      const context = await getProjectContext(deps, identity, projectId);
      if (!context) return null;
      requirePermission(context.principal, 'assessment:read');

      return deps.db
        .select()
        .from(schema.assessments)
        .where(eq(schema.assessments.projectId, projectId));
    },

    /**
     * Creates an Assessment + its first AssessmentJob and enqueues the job on
     * the existing assessment-jobs BullMQ queue (see packages/queue). This
     * proves the Assessment -> AssessmentJob -> BullMQ pipeline end to end —
     * the worker that consumes it still only logs and acknowledges (Batch 1
     * behavior, unchanged): no scanner executes, no outbound request is made.
     */
    async create(
      identity: RequestIdentity,
      projectId: string,
      input: CreateAssessmentInput,
      requestContext: RequestContext,
    ) {
      const context = await getProjectContext(deps, identity, projectId);
      if (!context) return null;
      requirePermission(context.principal, 'assessment:create');

      const [asset] = await deps.db
        .select()
        .from(schema.assets)
        .where(eq(schema.assets.id, input.assetId))
        .limit(1);
      if (!asset || asset.projectId !== projectId) {
        throw new DomainError(404, 'Asset not found in this project');
      }

      if (!isAssessmentTypeCompatibleWithAsset(asset.assetType, input.assessmentType)) {
        throw new DomainError(
          400,
          `Assessment type ${input.assessmentType} is not valid for a ${asset.assetType} asset`,
        );
      }

      // The security boundary: no assessment may start against an asset whose
      // authorization has not been explicitly confirmed. See docs/security-model.md.
      if (!asset.authorizationConfirmed) {
        throw new DomainError(
          400,
          'This asset does not have authorization confirmed for assessment',
        );
      }

      const actorUserId = context.principal.authType === 'user' ? context.principal.userId : null;

      const [assessment] = await deps.db
        .insert(schema.assessments)
        .values({
          projectId,
          assetId: asset.id,
          assessmentType: input.assessmentType,
          assetBuildId: input.assetBuildId ?? null,
          createdBy: actorUserId,
          scope: computeScopeForAsset(asset.config),
        })
        .returning();
      if (!assessment) throw new Error('Failed to create assessment');

      const [job] = await deps.db
        .insert(schema.assessmentJobs)
        .values({ assessmentId: assessment.id, jobType: input.assessmentType })
        .returning();
      if (!job) throw new Error('Failed to create assessment job');

      try {
        const queueJob = await deps.assessmentJobsQueue.add(
          'assessment',
          {
            assessmentJobId: job.id,
            assessmentId: assessment.id,
            scannerName: input.assessmentType,
          },
          {
            // Bounds automatic BullMQ retries to genuine transient
            // infrastructure failures — the worker itself never rethrows
            // (and so never triggers a retry) for a scope/SSRF/authorization
            // rejection, only for an unexpected error. See Part R.
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 },
          },
        );
        await deps.db
          .update(schema.assessmentJobs)
          .set({ queueJobId: queueJob.id ?? null, updatedAt: new Date() })
          .where(eq(schema.assessmentJobs.id, job.id));
      } catch (error) {
        await deps.db
          .update(schema.assessmentJobs)
          .set({ status: 'FAILED', errorMessage: 'Failed to enqueue job', updatedAt: new Date() })
          .where(eq(schema.assessmentJobs.id, job.id));
        await deps.db
          .update(schema.assessments)
          .set({
            status: 'FAILED',
            errorMessage: 'Failed to enqueue assessment job',
            updatedAt: new Date(),
          })
          .where(eq(schema.assessments.id, assessment.id));
        throw error;
      }

      await deps.audit.record({
        organizationId: context.project.organizationId,
        actorUserId,
        action: 'assessment.created',
        resourceType: 'assessment',
        resourceId: assessment.id,
        metadata: { assetId: asset.id, assessmentType: input.assessmentType },
        ipAddress: requestContext.ipAddress,
        userAgent: requestContext.userAgent,
      });

      return assessment;
    },

    /** Returns null both when the assessment does not exist and when the caller has no access to it. */
    async getById(identity: RequestIdentity, assessmentId: string) {
      const context = await getAssessmentContext(deps, identity, assessmentId);
      if (!context) return null;
      if (!hasPermission(context.principal, 'assessment:read')) return null;
      return context.assessment;
    },

    /** Findings the worker's scanner(s) persisted for this assessment — see apps/worker/src/assessment-processor.ts. */
    async listFindings(identity: RequestIdentity, assessmentId: string) {
      const context = await getAssessmentContext(deps, identity, assessmentId);
      if (!context) return null;
      if (!hasPermission(context.principal, 'finding:read')) return null;

      return deps.db
        .select()
        .from(schema.findings)
        .where(eq(schema.findings.assessmentId, assessmentId));
    },

    async cancel(identity: RequestIdentity, assessmentId: string, requestContext: RequestContext) {
      const context = await getAssessmentContext(deps, identity, assessmentId);
      if (!context) return null;
      requirePermission(context.principal, 'assessment:cancel');

      if (!canTransitionAssessmentStatus(context.assessment.status, 'CANCELLED')) {
        throw new DomainError(
          409,
          `Cannot cancel an assessment in status ${context.assessment.status}`,
        );
      }

      const [updated] = await deps.db
        .update(schema.assessments)
        .set({ status: 'CANCELLED', cancelledAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.assessments.id, assessmentId))
        .returning();

      await deps.audit.record({
        organizationId: context.project.organizationId,
        actorUserId: context.principal.authType === 'user' ? context.principal.userId : null,
        action: 'assessment.cancelled',
        resourceType: 'assessment',
        resourceId: assessmentId,
        ipAddress: requestContext.ipAddress,
        userAgent: requestContext.userAgent,
      });

      return updated ?? null;
    },
  };
}

export type AssessmentsService = ReturnType<typeof createAssessmentsService>;
