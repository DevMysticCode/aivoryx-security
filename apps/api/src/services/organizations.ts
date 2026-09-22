import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { schema, type AuditService } from '@aivoryx/db';
import { AuthenticationError, requirePlatformPermission } from '@aivoryx/auth';
import type { RequestIdentity } from '../auth/context.js';
import { resolveTenantPrincipalForOrganization } from '../auth/context.js';

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
     * authenticated identity may call this — there is no tenant permission for
     * "create an organization" (permissions apply *within* an org that already
     * exists). When a real, session-authenticated user creates the organization
     * (identity.userId set), they are automatically added as its OWNER — fixing
     * the Batch 2 bootstrap gap. API-key-authenticated creation does not create
     * a membership: an API key isn't tied to a real user row, so there is no one
     * to make OWNER. See docs/authorization.md.
     */
    async create(
      identity: RequestIdentity,
      input: CreateOrganizationInput,
      context: RequestContext,
    ) {
      if (!identity.principal && !identity.userId) throw new AuthenticationError();

      const [organization] = await deps.db
        .insert(schema.organizations)
        .values({ name: input.name, slug: input.slug })
        .returning();
      if (!organization) throw new Error('Failed to create organization');

      if (identity.userId) {
        await deps.db.insert(schema.organizationMembers).values({
          organizationId: organization.id,
          userId: identity.userId,
          role: 'OWNER',
          status: 'active',
        });
      }

      const actorUserId =
        identity.userId ??
        (identity.principal?.type === 'platform' ? identity.principal.userId : null);

      await deps.audit.record({
        organizationId: organization.id,
        actorUserId,
        action: 'organization.created',
        resourceType: 'organization',
        resourceId: organization.id,
        metadata: {
          name: organization.name,
          slug: organization.slug,
          ownerCreated: Boolean(identity.userId),
        },
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      return organization;
    },

    /**
     * Tenant (api-key) principals only ever see their own organization. Session
     * users see every organization where they hold an active membership.
     * Platform principals may list every organization, but only with explicit
     * platform:organizations:read permission — no platform role gets this for free.
     */
    async listVisibleTo(identity: RequestIdentity) {
      if (identity.principal?.type === 'tenant') {
        return deps.db
          .select()
          .from(schema.organizations)
          .where(eq(schema.organizations.id, identity.principal.organizationId));
      }
      if (identity.principal?.type === 'platform') {
        requirePlatformPermission(identity.principal, 'platform:organizations:read');
        return deps.db.select().from(schema.organizations);
      }
      if (!identity.userId) return [];

      return deps.db
        .select({
          id: schema.organizations.id,
          name: schema.organizations.name,
          slug: schema.organizations.slug,
          status: schema.organizations.status,
          createdAt: schema.organizations.createdAt,
          updatedAt: schema.organizations.updatedAt,
        })
        .from(schema.organizations)
        .innerJoin(
          schema.organizationMembers,
          and(
            eq(schema.organizationMembers.organizationId, schema.organizations.id),
            eq(schema.organizationMembers.userId, identity.userId),
            eq(schema.organizationMembers.status, 'active'),
          ),
        );
    },

    /** Returns null both when the org does not exist and when the caller has no access to it. */
    async getById(identity: RequestIdentity, organizationId: string) {
      const [organization] = await deps.db
        .select()
        .from(schema.organizations)
        .where(eq(schema.organizations.id, organizationId))
        .limit(1);
      if (!organization) return null;

      const principal = await resolveTenantPrincipalForOrganization(
        identity,
        organizationId,
        deps.db,
      );
      if (!principal) return null;

      return organization;
    },
  };
}

export type OrganizationsService = ReturnType<typeof createOrganizationsService>;
