import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { schema, type AuditService } from '@aivoryx/db';
import { hasPermission, requirePermission } from '@aivoryx/auth';
import type { AssetConfig, AssetType } from '@aivoryx/shared-types';
import { DomainError } from '../domain-errors.js';
import { resolveTenantPrincipalForOrganization, type RequestIdentity } from '../auth/context.js';
import { assetConfigSchemaFor } from '../validation/assets.js';
import type { RequestContext } from './organizations.js';

export interface AssetsServiceDeps {
  db: PostgresJsDatabase<typeof schema>;
  audit: AuditService;
}

export interface CreateAssetInput {
  assetType: AssetType;
  name: string;
  description?: string | undefined;
  config: Record<string, unknown>;
}

export interface UpdateAssetInput {
  name?: string | undefined;
  description?: string | undefined;
  status?: 'active' | 'archived' | undefined;
  config?: Record<string, unknown> | undefined;
  authorizationConfirmed?: boolean | undefined;
}

function validateAssetConfig(assetType: AssetType, config: Record<string, unknown>): AssetConfig {
  const schemaForType = assetConfigSchemaFor(assetType);
  const parsed = schemaForType.safeParse(config);
  if (!parsed.success) {
    throw new DomainError(
      400,
      `Invalid config for asset type ${assetType}: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
    );
  }
  return parsed.data as AssetConfig;
}

/** Shared "fetch project + resolve tenant access" step — null hides both nonexistence and lack of access. */
async function getProjectContext(
  deps: AssetsServiceDeps,
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

/** Shared "fetch asset + its project + resolve tenant access" step for asset-by-id operations. */
async function getAssetContext(
  deps: AssetsServiceDeps,
  identity: RequestIdentity,
  assetId: string,
) {
  const [row] = await deps.db
    .select({ asset: schema.assets, project: schema.projects })
    .from(schema.assets)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.assets.projectId))
    .where(eq(schema.assets.id, assetId))
    .limit(1);
  if (!row) return null;

  const principal = await resolveTenantPrincipalForOrganization(
    identity,
    row.project.organizationId,
    deps.db,
  );
  if (!principal) return null;

  return { asset: row.asset, project: row.project, principal };
}

export function createAssetsService(deps: AssetsServiceDeps) {
  return {
    async list(identity: RequestIdentity, projectId: string) {
      const context = await getProjectContext(deps, identity, projectId);
      if (!context) return null;
      requirePermission(context.principal, 'asset:read');

      return deps.db.select().from(schema.assets).where(eq(schema.assets.projectId, projectId));
    },

    async create(
      identity: RequestIdentity,
      projectId: string,
      input: CreateAssetInput,
      requestContext: RequestContext,
    ) {
      const context = await getProjectContext(deps, identity, projectId);
      if (!context) return null;
      requirePermission(context.principal, 'asset:create');

      const config = validateAssetConfig(input.assetType, input.config);

      const [asset] = await deps.db
        .insert(schema.assets)
        .values({
          projectId,
          assetType: input.assetType,
          name: input.name,
          description: input.description ?? null,
          config,
        })
        .returning();
      if (!asset) throw new Error('Failed to create asset');

      await deps.audit.record({
        organizationId: context.project.organizationId,
        actorUserId: context.principal.authType === 'user' ? context.principal.userId : null,
        action: 'asset.created',
        resourceType: 'asset',
        resourceId: asset.id,
        metadata: { assetType: input.assetType, name: input.name, projectId },
        ipAddress: requestContext.ipAddress,
        userAgent: requestContext.userAgent,
      });

      return asset;
    },

    /** Returns null both when the asset does not exist and when the caller has no access to it. */
    async getById(identity: RequestIdentity, assetId: string) {
      const context = await getAssetContext(deps, identity, assetId);
      if (!context) return null;
      if (!hasPermission(context.principal, 'asset:read')) return null;
      return context.asset;
    },

    async update(
      identity: RequestIdentity,
      assetId: string,
      input: UpdateAssetInput,
      requestContext: RequestContext,
    ) {
      const context = await getAssetContext(deps, identity, assetId);
      if (!context) return null;
      requirePermission(context.principal, 'asset:update');

      const config = input.config
        ? validateAssetConfig(context.asset.assetType, input.config)
        : undefined;

      const wasConfirmed = context.asset.authorizationConfirmed;
      const nowConfirming = input.authorizationConfirmed === true && !wasConfirmed;
      const nowRevoking = input.authorizationConfirmed === false && wasConfirmed;

      const [updated] = await deps.db
        .update(schema.assets)
        .set({
          name: input.name ?? context.asset.name,
          description: input.description ?? context.asset.description,
          status: input.status ?? context.asset.status,
          config: config ?? context.asset.config,
          authorizationConfirmed:
            input.authorizationConfirmed ?? context.asset.authorizationConfirmed,
          authorizationConfirmedBy: nowConfirming
            ? context.principal.authType === 'user'
              ? context.principal.userId
              : null
            : nowRevoking
              ? null
              : context.asset.authorizationConfirmedBy,
          authorizationConfirmedAt: nowConfirming
            ? new Date()
            : nowRevoking
              ? null
              : context.asset.authorizationConfirmedAt,
          updatedAt: new Date(),
        })
        .where(eq(schema.assets.id, assetId))
        .returning();

      const actorUserId = context.principal.authType === 'user' ? context.principal.userId : null;

      await deps.audit.record({
        organizationId: context.project.organizationId,
        actorUserId,
        action: 'asset.updated',
        resourceType: 'asset',
        resourceId: assetId,
        metadata: { name: input.name, status: input.status },
        ipAddress: requestContext.ipAddress,
        userAgent: requestContext.userAgent,
      });

      if (nowConfirming || nowRevoking) {
        await deps.audit.record({
          organizationId: context.project.organizationId,
          actorUserId,
          action: nowConfirming ? 'asset.authorization_confirmed' : 'asset.authorization_revoked',
          resourceType: 'asset',
          resourceId: assetId,
          ipAddress: requestContext.ipAddress,
          userAgent: requestContext.userAgent,
        });
      }

      return updated ?? null;
    },
  };
}

export type AssetsService = ReturnType<typeof createAssetsService>;
