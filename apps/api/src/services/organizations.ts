import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { schema, type AuditService } from '@aivoryx/db';
import { AuthenticationError, requirePermission, requirePlatformPermission } from '@aivoryx/auth';
import type { RequestIdentity } from '../auth/context.js';
import { resolveTenantPrincipalForOrganization } from '../auth/context.js';
import type {
  UpdateOrganizationBrandingInput,
  UpdateOrganizationProfileInput,
  UpdateOrganizationThemeInput,
} from '../validation/organization-settings.js';

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

/**
 * Zod's `.optional()` fields are typed `T | undefined`, but under
 * `exactOptionalPropertyTypes` Drizzle's `.set()` rejects an explicit
 * `undefined` value (as opposed to an omitted key) for columns that don't
 * declare `| undefined`. Omitted fields should simply not be part of the
 * update — this strips them rather than writing them as null.
 */
function withoutUndefined<T extends Record<string, unknown>>(
  obj: T,
): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined)) as {
    [K in keyof T]: Exclude<T[K], undefined>;
  };
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
          logoUrl: schema.organizations.logoUrl,
          themePreset: schema.organizations.themePreset,
          primaryColor: schema.organizations.primaryColor,
          secondaryColor: schema.organizations.secondaryColor,
          accentColor: schema.organizations.accentColor,
          // The caller's own role in this org — lets the frontend gate
          // navigation without a second round trip per organization. Never
          // used as the source of truth for an actual permission check
          // (every mutating route still resolves and checks this server-side).
          myRole: schema.organizationMembers.role,
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

    /**
     * Company profile fields (Part 23). Gated on `organization:update` —
     * the same permission that already governs org-level administration, so
     * this introduces no new authorization surface. Returns null both when
     * the org doesn't exist and when the caller can't access it.
     */
    async updateProfile(
      identity: RequestIdentity,
      organizationId: string,
      input: UpdateOrganizationProfileInput,
      context: RequestContext,
    ) {
      const principal = await resolveTenantPrincipalForOrganization(
        identity,
        organizationId,
        deps.db,
      );
      if (!principal) return null;
      requirePermission(principal, 'organization:update');

      const [organization] = await deps.db
        .update(schema.organizations)
        .set({ ...withoutUndefined(input), updatedAt: new Date() })
        .where(eq(schema.organizations.id, organizationId))
        .returning();
      if (!organization) return null;

      await deps.audit.record({
        organizationId,
        actorUserId: principal.authType === 'user' ? principal.userId : null,
        action: 'organization.profile_updated',
        resourceType: 'organization',
        resourceId: organizationId,
        metadata: { fields: Object.keys(input) },
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      return organization;
    },

    /** Branding (Part 24) — URL references only, validated before this is ever called. */
    async updateBranding(
      identity: RequestIdentity,
      organizationId: string,
      input: UpdateOrganizationBrandingInput,
      context: RequestContext,
    ) {
      const principal = await resolveTenantPrincipalForOrganization(
        identity,
        organizationId,
        deps.db,
      );
      if (!principal) return null;
      requirePermission(principal, 'organization:update');

      const [organization] = await deps.db
        .update(schema.organizations)
        .set({ ...withoutUndefined(input), updatedAt: new Date() })
        .where(eq(schema.organizations.id, organizationId))
        .returning();
      if (!organization) return null;

      await deps.audit.record({
        organizationId,
        actorUserId: principal.authType === 'user' ? principal.userId : null,
        action: 'organization.branding_updated',
        resourceType: 'organization',
        resourceId: organizationId,
        metadata: { fields: Object.keys(input) },
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      return organization;
    },

    /** Theme (Part 25) — strictly validated hex colors + a fixed preset enum, never free-form CSS. */
    async updateTheme(
      identity: RequestIdentity,
      organizationId: string,
      input: UpdateOrganizationThemeInput,
      context: RequestContext,
    ) {
      const principal = await resolveTenantPrincipalForOrganization(
        identity,
        organizationId,
        deps.db,
      );
      if (!principal) return null;
      requirePermission(principal, 'organization:update');

      const [organization] = await deps.db
        .update(schema.organizations)
        .set({ ...withoutUndefined(input), updatedAt: new Date() })
        .where(eq(schema.organizations.id, organizationId))
        .returning();
      if (!organization) return null;

      await deps.audit.record({
        organizationId,
        actorUserId: principal.authType === 'user' ? principal.userId : null,
        action: 'organization.theme_updated',
        resourceType: 'organization',
        resourceId: organizationId,
        metadata: { fields: Object.keys(input) },
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      return organization;
    },
  };
}

export type OrganizationsService = ReturnType<typeof createOrganizationsService>;
