import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { schema, type AuditService } from '@aivoryx/db';
import { hasPermission, requirePermission } from '@aivoryx/auth';
import {
  requireTenantPrincipalForOrganization,
  resolveTenantPrincipalForOrganization,
  type RequestIdentity,
} from '../auth/context.js';
import type { RequestContext } from './organizations.js';

export interface ProjectsServiceDeps {
  db: PostgresJsDatabase<typeof schema>;
  audit: AuditService;
}

export interface CreateProjectInput {
  name: string;
  slug: string;
  description?: string | undefined;
}

export interface UpdateProjectInput {
  name?: string | undefined;
  description?: string | undefined;
}

export function createProjectsService(deps: ProjectsServiceDeps) {
  return {
    async list(identity: RequestIdentity, organizationId: string) {
      const principal = await requireTenantPrincipalForOrganization(
        identity,
        organizationId,
        deps.db,
      );
      requirePermission(principal, 'project:read');
      return deps.db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.organizationId, organizationId));
    },

    async create(
      identity: RequestIdentity,
      organizationId: string,
      input: CreateProjectInput,
      context: RequestContext,
    ) {
      const principal = await requireTenantPrincipalForOrganization(
        identity,
        organizationId,
        deps.db,
      );
      requirePermission(principal, 'project:create');

      const [project] = await deps.db
        .insert(schema.projects)
        .values({
          organizationId,
          name: input.name,
          slug: input.slug,
          description: input.description ?? null,
        })
        .returning();
      if (!project) throw new Error('Failed to create project');

      await deps.audit.record({
        organizationId,
        actorUserId: principal.authType === 'user' ? principal.userId : null,
        action: 'project.created',
        resourceType: 'project',
        resourceId: project.id,
        metadata: { name: input.name, slug: input.slug },
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      return project;
    },

    /**
     * Returns null both when the project does not exist and when the caller has
     * no access to its organization — a project must never be distinguishable
     * from "does not exist" by an unauthorized caller (no existence leakage).
     */
    async getById(identity: RequestIdentity, projectId: string) {
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
      if (!principal || !hasPermission(principal, 'project:read')) return null;

      return project;
    },

    async update(
      identity: RequestIdentity,
      projectId: string,
      input: UpdateProjectInput,
      context: RequestContext,
    ) {
      const existing = await getProjectForMutation(deps, identity, projectId);
      if (!existing) return null;
      const { project, principal } = existing;

      requirePermission(principal, 'project:update');

      const [updated] = await deps.db
        .update(schema.projects)
        .set({
          name: input.name ?? project.name,
          description: input.description ?? project.description,
          updatedAt: new Date(),
        })
        .where(eq(schema.projects.id, projectId))
        .returning();

      await deps.audit.record({
        organizationId: project.organizationId,
        actorUserId: principal.authType === 'user' ? principal.userId : null,
        action: 'project.updated',
        resourceType: 'project',
        resourceId: projectId,
        metadata: { name: input.name, description: input.description },
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      return updated ?? null;
    },

    /** Soft-delete: sets status to 'archived' — the schema has no hard-delete path for projects. */
    async archive(identity: RequestIdentity, projectId: string, context: RequestContext) {
      const existing = await getProjectForMutation(deps, identity, projectId);
      if (!existing) return null;
      const { project, principal } = existing;

      requirePermission(principal, 'project:delete');

      const [updated] = await deps.db
        .update(schema.projects)
        .set({ status: 'archived', updatedAt: new Date() })
        .where(eq(schema.projects.id, projectId))
        .returning();

      await deps.audit.record({
        organizationId: project.organizationId,
        actorUserId: principal.authType === 'user' ? principal.userId : null,
        action: 'project.archived',
        resourceType: 'project',
        resourceId: projectId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      return updated ?? null;
    },
  };
}

/**
 * Shared "fetch + resolve tenant access" step for mutation methods: returns
 * null (never throws AuthorizationError) when the project doesn't exist or the
 * caller has no access to its organization at all, so a not-found and a
 * cross-tenant attempt are indistinguishable. Once resolved, requirePermission()
 * throwing 403 for "right org, wrong permission" is safe — it doesn't leak
 * anything the caller didn't already know (their own organization's project exists).
 */
async function getProjectForMutation(
  deps: ProjectsServiceDeps,
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

export type ProjectsService = ReturnType<typeof createProjectsService>;
