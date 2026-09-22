import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { schema, type AuditService } from '@aivoryx/db';
import { normalizeEmail, requirePermission, type OrganizationRole } from '@aivoryx/auth';
import { DomainError } from '../domain-errors.js';
import { requireTenantPrincipalForOrganization, type RequestIdentity } from '../auth/context.js';
import type { RequestContext } from './organizations.js';

export interface MembersServiceDeps {
  db: PostgresJsDatabase<typeof schema>;
  audit: AuditService;
}

export interface AddMemberInput {
  email: string;
  role: OrganizationRole;
}

const MEMBER_WITH_USER_COLUMNS = {
  id: schema.organizationMembers.id,
  organizationId: schema.organizationMembers.organizationId,
  userId: schema.organizationMembers.userId,
  role: schema.organizationMembers.role,
  status: schema.organizationMembers.status,
  createdAt: schema.organizationMembers.createdAt,
  updatedAt: schema.organizationMembers.updatedAt,
  email: schema.users.email,
  name: schema.users.name,
} as const;

async function countActiveOwners(
  db: PostgresJsDatabase<typeof schema>,
  organizationId: string,
): Promise<number> {
  const owners = await db
    .select({ id: schema.organizationMembers.id })
    .from(schema.organizationMembers)
    .where(
      and(
        eq(schema.organizationMembers.organizationId, organizationId),
        eq(schema.organizationMembers.role, 'OWNER'),
        eq(schema.organizationMembers.status, 'active'),
      ),
    );
  return owners.length;
}

export function createMembersService(deps: MembersServiceDeps) {
  return {
    async list(identity: RequestIdentity, organizationId: string) {
      const principal = await requireTenantPrincipalForOrganization(
        identity,
        organizationId,
        deps.db,
      );
      requirePermission(principal, 'member:read');

      return deps.db
        .select(MEMBER_WITH_USER_COLUMNS)
        .from(schema.organizationMembers)
        .innerJoin(schema.users, eq(schema.users.id, schema.organizationMembers.userId))
        .where(eq(schema.organizationMembers.organizationId, organizationId));
    },

    /**
     * Adds an already-registered user as a member directly (status 'active').
     * There is no email-delivery infrastructure in this batch, so inviting a
     * not-yet-registered email (create a pending account, send an invite email,
     * they complete signup) is deferred — see docs/authorization.md. The
     * 'invited' membership status remains in the schema for that future flow.
     */
    async add(
      identity: RequestIdentity,
      organizationId: string,
      input: AddMemberInput,
      context: RequestContext,
    ) {
      const principal = await requireTenantPrincipalForOrganization(
        identity,
        organizationId,
        deps.db,
      );
      requirePermission(principal, 'member:invite');

      const email = normalizeEmail(input.email);
      const [targetUser] = await deps.db
        .select({ id: schema.users.id, email: schema.users.email })
        .from(schema.users)
        .where(eq(schema.users.email, email))
        .limit(1);
      if (!targetUser) {
        throw new DomainError(404, 'No registered user was found with that email address');
      }

      const [existingMembership] = await deps.db
        .select({ id: schema.organizationMembers.id })
        .from(schema.organizationMembers)
        .where(
          and(
            eq(schema.organizationMembers.organizationId, organizationId),
            eq(schema.organizationMembers.userId, targetUser.id),
          ),
        )
        .limit(1);
      if (existingMembership) {
        throw new DomainError(409, 'This user is already a member of the organization');
      }

      const [membership] = await deps.db
        .insert(schema.organizationMembers)
        .values({ organizationId, userId: targetUser.id, role: input.role, status: 'active' })
        .returning();
      if (!membership) throw new Error('Failed to add member');

      await deps.audit.record({
        organizationId,
        actorUserId: principal.authType === 'user' ? principal.userId : null,
        action: 'member.invited',
        resourceType: 'organization_member',
        resourceId: membership.id,
        metadata: { email, role: input.role },
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      return { ...membership, email: targetUser.email };
    },

    async updateRole(
      identity: RequestIdentity,
      organizationId: string,
      memberId: string,
      role: OrganizationRole,
      context: RequestContext,
    ) {
      const principal = await requireTenantPrincipalForOrganization(
        identity,
        organizationId,
        deps.db,
      );
      requirePermission(principal, 'member:update');

      const [existing] = await deps.db
        .select()
        .from(schema.organizationMembers)
        .where(
          and(
            eq(schema.organizationMembers.id, memberId),
            eq(schema.organizationMembers.organizationId, organizationId),
          ),
        )
        .limit(1);
      if (!existing) return null;

      if (existing.role === 'OWNER' && role !== 'OWNER') {
        const ownerCount = await countActiveOwners(deps.db, organizationId);
        if (ownerCount <= 1) {
          throw new DomainError(400, 'An organization must always have at least one OWNER');
        }
      }

      const [updated] = await deps.db
        .update(schema.organizationMembers)
        .set({ role, updatedAt: new Date() })
        .where(eq(schema.organizationMembers.id, memberId))
        .returning();

      await deps.audit.record({
        organizationId,
        actorUserId: principal.authType === 'user' ? principal.userId : null,
        action: 'member.role_changed',
        resourceType: 'organization_member',
        resourceId: memberId,
        metadata: { previousRole: existing.role, newRole: role },
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      return updated ?? null;
    },

    async remove(
      identity: RequestIdentity,
      organizationId: string,
      memberId: string,
      context: RequestContext,
    ) {
      const principal = await requireTenantPrincipalForOrganization(
        identity,
        organizationId,
        deps.db,
      );
      requirePermission(principal, 'member:remove');

      const [existing] = await deps.db
        .select()
        .from(schema.organizationMembers)
        .where(
          and(
            eq(schema.organizationMembers.id, memberId),
            eq(schema.organizationMembers.organizationId, organizationId),
          ),
        )
        .limit(1);
      if (!existing) return false;

      if (existing.role === 'OWNER' && existing.status === 'active') {
        const ownerCount = await countActiveOwners(deps.db, organizationId);
        if (ownerCount <= 1) {
          throw new DomainError(400, 'An organization must always have at least one OWNER');
        }
      }

      await deps.db
        .delete(schema.organizationMembers)
        .where(eq(schema.organizationMembers.id, memberId));

      await deps.audit.record({
        organizationId,
        actorUserId: principal.authType === 'user' ? principal.userId : null,
        action: 'member.removed',
        resourceType: 'organization_member',
        resourceId: memberId,
        metadata: { removedUserId: existing.userId, role: existing.role },
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      return true;
    },
  };
}

export type MembersService = ReturnType<typeof createMembersService>;
