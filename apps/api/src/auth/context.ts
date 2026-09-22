import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { schema } from '@aivoryx/db';
import {
  AuthenticationError,
  TenantAccessError,
  API_KEY_DEFAULT_ROLE,
  createTenantPrincipal,
  verifyApiKeyCredential,
  verifySessionCredential,
  SESSION_COOKIE_NAME,
  type AuthPrincipal,
  type TenantPrincipal,
} from '@aivoryx/auth';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set only for API-key authentication (a key is inherently single-organization). */
    principal: AuthPrincipal | null;
    /** Set only for session (browser/human) authentication — the real user id. */
    userId: string | null;
  }
}

export interface AuthContextDependencies {
  db: PostgresJsDatabase<typeof schema>;
  credentialMasterKey: string;
}

/**
 * Populates `request.principal` (API-key auth) and `request.userId` (session
 * auth) for every request. Exactly one of the two auth mechanisms applies per
 * request — an Authorization header takes precedence if both are somehow
 * present. Health/ready remain unauthenticated: they never read either field.
 */
export function registerAuthContext(app: FastifyInstance, deps: AuthContextDependencies): void {
  app.decorateRequest('principal', null);
  app.decorateRequest('userId', null);

  app.addHook('onRequest', async (request) => {
    const header = request.headers.authorization;
    if (header) {
      request.principal = await authenticateApiKey(header, deps);
      return;
    }

    const rawToken = request.cookies[SESSION_COOKIE_NAME];
    if (rawToken) {
      request.userId = await authenticateSession(rawToken, deps);
    }
  });
}

async function authenticateApiKey(
  header: string,
  deps: AuthContextDependencies,
): Promise<AuthPrincipal | null> {
  const result = await verifyApiKeyCredential({
    headerValue: header,
    masterKey: deps.credentialMasterKey,
    findByPrefix: async (keyPrefix) => {
      const [row] = await deps.db
        .select()
        .from(schema.apiKeys)
        .where(eq(schema.apiKeys.keyPrefix, keyPrefix))
        .limit(1);
      if (!row) return null;
      return {
        id: row.id,
        organizationId: row.organizationId,
        keyHash: row.keyHash,
        status: row.status,
        expiresAt: row.expiresAt,
      };
    },
  });

  if (!result.ok) return null;

  // Fire-and-forget last-used tracking — must never block or fail the request.
  deps.db
    .update(schema.apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(schema.apiKeys.id, result.apiKey.id))
    .then(
      () => undefined,
      () => undefined,
    );

  return createTenantPrincipal({
    // API keys are organization credentials, not tied to a specific user (see
    // packages/auth/src/api-key.ts) — the key's own id fills the principal's
    // required userId field.
    userId: result.apiKey.id,
    organizationId: result.apiKey.organizationId,
    role: API_KEY_DEFAULT_ROLE,
    authType: 'api-key',
  });
}

async function authenticateSession(
  rawToken: string,
  deps: AuthContextDependencies,
): Promise<string | null> {
  const result = await verifySessionCredential({
    rawToken,
    masterKey: deps.credentialMasterKey,
    findByTokenHash: async (tokenHash) => {
      const [row] = await deps.db
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.tokenHash, tokenHash))
        .limit(1);
      return row ?? null;
    },
  });

  return result.ok ? result.session.userId : null;
}

export function requireAuthenticated(request: FastifyRequest): AuthPrincipal {
  if (!request.principal) throw new AuthenticationError();
  return request.principal;
}

/** Throws AuthenticationError unless *some* identity (api-key or session) authenticated this request. */
export function requireAnyIdentity(request: FastifyRequest): void {
  if (!request.principal && !request.userId) throw new AuthenticationError();
}

/** The bits of the request needed to resolve tenant context, decoupled from Fastify. */
export interface RequestIdentity {
  principal: AuthPrincipal | null;
  userId: string | null;
}

export function identityFromRequest(request: FastifyRequest): RequestIdentity {
  return { principal: request.principal, userId: request.userId };
}

/**
 * Resolves a TenantPrincipal for `organizationId` from whichever identity
 * authenticated the request — an API key already scoped to that org, or a
 * session user's active organization_members row — returning null (never
 * throwing) on any mismatch/absence. Callers that already know the org id is
 * client-asserted (a URL path segment) may prefer the throwing
 * requireTenantPrincipalForOrganization(); callers resolving org id *from* a
 * fetched resource should map null to 404 to avoid existence leakage.
 */
export async function resolveTenantPrincipalForOrganization(
  identity: RequestIdentity,
  organizationId: string,
  db: PostgresJsDatabase<typeof schema>,
): Promise<TenantPrincipal | null> {
  if (identity.principal?.type === 'tenant') {
    return identity.principal.organizationId === organizationId ? identity.principal : null;
  }
  if (identity.principal?.type === 'platform') return null;
  if (!identity.userId) return null;

  const [membership] = await db
    .select()
    .from(schema.organizationMembers)
    .where(
      and(
        eq(schema.organizationMembers.organizationId, organizationId),
        eq(schema.organizationMembers.userId, identity.userId),
      ),
    )
    .limit(1);

  if (!membership || membership.status !== 'active') return null;

  return createTenantPrincipal({
    userId: identity.userId,
    organizationId,
    role: membership.role,
    authType: 'user',
  });
}

/**
 * Throwing counterpart of resolveTenantPrincipalForOrganization() — see its docs
 * for when to prefer each. Callers must call requireAnyIdentity() first so an
 * entirely unauthenticated caller gets 401, not this function's 403.
 */
export async function requireTenantPrincipalForOrganization(
  identity: RequestIdentity,
  organizationId: string,
  db: PostgresJsDatabase<typeof schema>,
): Promise<TenantPrincipal> {
  const principal = await resolveTenantPrincipalForOrganization(identity, organizationId, db);
  if (!principal) throw new TenantAccessError();
  return principal;
}
