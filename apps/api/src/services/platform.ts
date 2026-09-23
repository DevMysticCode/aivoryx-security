import { count, desc, eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { schema } from '@aivoryx/db';
import { AuthorizationError, requirePlatformPermission } from '@aivoryx/auth';
import type { RequestIdentity } from '../auth/context.js';

export interface PlatformServiceDeps {
  db: PostgresJsDatabase<typeof schema>;
}

const RUNNING_STATUSES: Array<'QUEUED' | 'RUNNING'> = ['QUEUED', 'RUNNING'];

/**
 * Platform-wide aggregate counts for the Platform Dashboard (Part 7). Every
 * number here is a real `count(*)` against the database — never a fabricated
 * placeholder. If a metric isn't backed by a real query, it simply isn't
 * returned rather than being invented.
 */
export function createPlatformService(deps: PlatformServiceDeps) {
  return {
    async getStats(identity: RequestIdentity) {
      if (identity.principal?.type !== 'platform') {
        throw new AuthorizationError('Platform access required');
      }
      requirePlatformPermission(identity.principal, 'platform:organizations:read');

      const [
        [organizations],
        [activeOrganizations],
        [users],
        [assessments],
        [runningAssessments],
        [findings],
      ] = await Promise.all([
        deps.db.select({ value: count() }).from(schema.organizations),
        deps.db
          .select({ value: count() })
          .from(schema.organizations)
          .where(eq(schema.organizations.status, 'active')),
        deps.db.select({ value: count() }).from(schema.users),
        deps.db.select({ value: count() }).from(schema.assessments),
        deps.db
          .select({ value: count() })
          .from(schema.assessments)
          .where(inArray(schema.assessments.status, RUNNING_STATUSES)),
        deps.db.select({ value: count() }).from(schema.findings),
      ]);

      return {
        organizations: organizations?.value ?? 0,
        activeOrganizations: activeOrganizations?.value ?? 0,
        users: users?.value ?? 0,
        assessments: assessments?.value ?? 0,
        runningAssessments: runningAssessments?.value ?? 0,
        findings: findings?.value ?? 0,
      };
    },

    async listRecentOrganizations(identity: RequestIdentity, limit = 10) {
      if (identity.principal?.type !== 'platform') {
        throw new AuthorizationError('Platform access required');
      }
      requirePlatformPermission(identity.principal, 'platform:organizations:read');

      return deps.db
        .select()
        .from(schema.organizations)
        .orderBy(desc(schema.organizations.createdAt))
        .limit(Math.min(Math.max(limit, 1), 50));
    },
  };
}

export type PlatformService = ReturnType<typeof createPlatformService>;
