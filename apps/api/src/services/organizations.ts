import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { schema, type AuditService } from '@aivoryx/db';
import { requirePlatformPermission, type AuthPrincipal } from '@aivoryx/auth';

export interface OrganizationsServiceDeps {
  db: PostgresJsDatabase<typeof schema>;
  audit: AuditService;
}

export interface CreateOrganizationInput {
  name: string;
  slug: string;
}

export interface RequestContext {
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
}

export function createOrganizationsService(deps: OrganizationsServiceDeps) {
  return {
    /**
     * Creating a brand-new tenant needs no existing organization context, so any
     * authenticated principal may call this — there is no tenant permission for
     * "create an organization" (permissions apply *within* an org that already
     * exists). This batch does not create an initial OWNER membership for the
     * new organization: API-key principals aren't tied to a real user, and there
     * is no user-login provider yet to assign as owner. See docs/authorization.md.
     */
    async create(
      principal: AuthPrincipal,
      input: CreateOrganizationInput,
      context: RequestContext,
    ) {
      const [organization] = await deps.db
        .insert(schema.organizations)
        .values({ name: input.name, slug: input.slug })
        .returning();
      if (!organization) throw new Error('Failed to create organization');

      await deps.audit.record({
        organizationId: organization.id,
        actorUserId: principal.type === 'platform' ? principal.userId : null,
        action: 'organization.created',
        resourceType: 'organization',
        resourceId: organization.id,
        metadata: { name: organization.name, slug: organization.slug },
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      return organization;
    },

    /**
     * A tenant principal only ever sees its own organization (tenant isolation).
     * A platform principal may list all organizations, but only with explicit
     * platform:organizations:read permission — no platform role gets this for free.
     */
    async listVisibleTo(principal: AuthPrincipal) {
      if (principal.type === 'tenant') {
        return deps.db
          .select()
          .from(schema.organizations)
          .where(eq(schema.organizations.id, principal.organizationId));
      }
      requirePlatformPermission(principal, 'platform:organizations:read');
      return deps.db.select().from(schema.organizations);
    },
  };
}

export type OrganizationsService = ReturnType<typeof createOrganizationsService>;
