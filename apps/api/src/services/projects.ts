import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { schema, type AuditService } from '@aivoryx/db';
import { requirePermission, type TenantPrincipal } from '@aivoryx/auth';
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

export function createProjectsService(deps: ProjectsServiceDeps) {
  return {
    async list(principal: TenantPrincipal) {
      requirePermission(principal, 'project:read');
      return deps.db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.organizationId, principal.organizationId));
    },

    async create(principal: TenantPrincipal, input: CreateProjectInput, context: RequestContext) {
      requirePermission(principal, 'project:create');

      const [project] = await deps.db
        .insert(schema.projects)
        .values({
          organizationId: principal.organizationId,
          name: input.name,
          slug: input.slug,
          description: input.description ?? null,
        })
        .returning();
      if (!project) throw new Error('Failed to create project');

      await deps.audit.record({
        organizationId: principal.organizationId,
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
     * Returns null both when the project does not exist and when it belongs to
     * a different organization — a project must never be distinguishable from
     * "does not exist" by an unauthorized caller (no existence leakage).
     */
    async getById(principal: TenantPrincipal, projectId: string) {
      requirePermission(principal, 'project:read');

      const [project] = await deps.db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.id, projectId))
        .limit(1);

      if (!project || project.organizationId !== principal.organizationId) {
        return null;
      }
      return project;
    },
  };
}

export type ProjectsService = ReturnType<typeof createProjectsService>;
