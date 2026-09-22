import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { schema, type AuditService } from '@aivoryx/db';
import { generateApiKey, requirePermission, type TenantPrincipal } from '@aivoryx/auth';
import type { RequestContext } from './organizations.js';

export interface ApiKeysServiceDeps {
  db: PostgresJsDatabase<typeof schema>;
  audit: AuditService;
  credentialMasterKey: string;
}

export interface CreateApiKeyInput {
  name: string;
  expiresAt?: Date | undefined;
}

// Columns safe to return from list/revoke — the hash is never selected at all.
const SAFE_API_KEY_COLUMNS = {
  id: schema.apiKeys.id,
  name: schema.apiKeys.name,
  keyPrefix: schema.apiKeys.keyPrefix,
  status: schema.apiKeys.status,
  expiresAt: schema.apiKeys.expiresAt,
  lastUsedAt: schema.apiKeys.lastUsedAt,
  revokedAt: schema.apiKeys.revokedAt,
  createdAt: schema.apiKeys.createdAt,
} as const;

export function createApiKeysService(deps: ApiKeysServiceDeps) {
  return {
    async list(principal: TenantPrincipal) {
      requirePermission(principal, 'api_key:read');
      return deps.db
        .select(SAFE_API_KEY_COLUMNS)
        .from(schema.apiKeys)
        .where(eq(schema.apiKeys.organizationId, principal.organizationId));
    },

    /** Returns the raw secret exactly once, alongside the persisted (safe) fields. */
    async create(principal: TenantPrincipal, input: CreateApiKeyInput, context: RequestContext) {
      requirePermission(principal, 'api_key:create');

      const generated = generateApiKey(deps.credentialMasterKey);
      const [row] = await deps.db
        .insert(schema.apiKeys)
        .values({
          organizationId: principal.organizationId,
          name: input.name,
          keyPrefix: generated.keyPrefix,
          keyHash: generated.keyHash,
          expiresAt: input.expiresAt ?? null,
        })
        .returning(SAFE_API_KEY_COLUMNS);
      if (!row) throw new Error('Failed to create API key');

      await deps.audit.record({
        organizationId: principal.organizationId,
        actorUserId: principal.authType === 'user' ? principal.userId : null,
        action: 'api_key.created',
        resourceType: 'api_key',
        resourceId: row.id,
        // Never the raw key or hash — name/prefix only.
        metadata: { name: input.name, keyPrefix: generated.keyPrefix },
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      return { ...row, rawKey: generated.raw };
    },

    /** Returns null both when the key does not exist and when it belongs to another organization. */
    async revoke(principal: TenantPrincipal, apiKeyId: string, context: RequestContext) {
      requirePermission(principal, 'api_key:revoke');

      const [existing] = await deps.db
        .select({
          id: schema.apiKeys.id,
          organizationId: schema.apiKeys.organizationId,
          name: schema.apiKeys.name,
        })
        .from(schema.apiKeys)
        .where(eq(schema.apiKeys.id, apiKeyId))
        .limit(1);

      if (!existing || existing.organizationId !== principal.organizationId) {
        return null;
      }

      const [updated] = await deps.db
        .update(schema.apiKeys)
        .set({ status: 'revoked', revokedAt: new Date() })
        .where(eq(schema.apiKeys.id, apiKeyId))
        .returning(SAFE_API_KEY_COLUMNS);

      await deps.audit.record({
        organizationId: principal.organizationId,
        actorUserId: principal.authType === 'user' ? principal.userId : null,
        action: 'api_key.revoked',
        resourceType: 'api_key',
        resourceId: apiKeyId,
        metadata: { name: existing.name },
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      return updated ?? null;
    },
  };
}

export type ApiKeysService = ReturnType<typeof createApiKeysService>;
