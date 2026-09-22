import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { schema } from '@aivoryx/db';
import {
  AuthenticationError,
  API_KEY_DEFAULT_ROLE,
  createTenantPrincipal,
  verifyApiKeyCredential,
  type AuthPrincipal,
} from '@aivoryx/auth';

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * The authenticated caller for this request, or null if unauthenticated.
     * Populated fresh per request by the onRequest hook below — never shared
     * mutable state, safe under concurrency. See docs/authorization.md.
     */
    principal: AuthPrincipal | null;
  }
}

export interface AuthContextDependencies {
  db: PostgresJsDatabase<typeof schema>;
  credentialMasterKey: string;
}

/**
 * Populates `request.principal` for every request based on the Authorization
 * header. Only API-key authentication exists in this batch (see
 * docs/authorization.md) — there is no user login/session provider yet, so no
 * request can ever produce a 'platform' or user-authenticated 'tenant' principal.
 * Health/ready remain unauthenticated: they never read request.principal.
 */
export function registerAuthContext(app: FastifyInstance, deps: AuthContextDependencies): void {
  app.decorateRequest('principal', null);

  app.addHook('onRequest', async (request) => {
    request.principal = await authenticateRequest(request, deps);
  });
}

async function authenticateRequest(
  request: FastifyRequest,
  deps: AuthContextDependencies,
): Promise<AuthPrincipal | null> {
  const header = request.headers.authorization;
  if (!header) return null;

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

export function requireAuthenticated(request: FastifyRequest): AuthPrincipal {
  if (!request.principal) throw new AuthenticationError();
  return request.principal;
}
