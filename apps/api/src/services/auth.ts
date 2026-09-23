import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { schema, type AuditService } from '@aivoryx/db';
import {
  hashPassword,
  verifyPassword,
  validatePasswordStrength,
  normalizeEmail,
  generateSessionToken,
  hashSessionToken,
  SESSION_TTL_MS,
} from '@aivoryx/auth';
import { DomainError } from '../domain-errors.js';
import type { RequestContext } from './organizations.js';

export interface AuthServiceDeps {
  db: PostgresJsDatabase<typeof schema>;
  audit: AuditService;
  credentialMasterKey: string;
}

export interface RegisterInput {
  email: string;
  password: string;
  name?: string | undefined;
}

export interface LoginInput {
  email: string;
  password: string;
}

// Never returned/logged: passwordHash. Only these fields ever leave the service.
// platformRole is the user's own account data (never another user's) — safe to
// expose so the frontend knows whether to offer the Platform Admin experience;
// it is never treated as authoritative by any route, which always re-checks
// server-side (see auth/context.ts's resolvePlatformPrincipal).
const SAFE_USER_COLUMNS = {
  id: schema.users.id,
  email: schema.users.email,
  name: schema.users.name,
  avatarUrl: schema.users.avatarUrl,
  status: schema.users.status,
  platformRole: schema.users.platformRole,
  createdAt: schema.users.createdAt,
} as const;

export function createAuthService(deps: AuthServiceDeps) {
  return {
    async register(input: RegisterInput, context: RequestContext) {
      const strength = validatePasswordStrength(input.password);
      if (!strength.valid) {
        throw new DomainError(400, strength.errors.join('; '));
      }

      const email = normalizeEmail(input.email);
      const [existing] = await deps.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.email, email))
        .limit(1);
      if (existing) {
        throw new DomainError(409, 'An account with this email already exists');
      }

      const passwordHash = await hashPassword(input.password);
      const [user] = await deps.db
        .insert(schema.users)
        .values({ email, passwordHash, name: input.name ?? null })
        .returning(SAFE_USER_COLUMNS);
      if (!user) throw new Error('Failed to create user');

      await deps.audit.record({
        actorUserId: user.id,
        action: 'user.registered',
        resourceType: 'user',
        resourceId: user.id,
        metadata: { email },
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      const session = await createSession(deps, user.id, context);
      return { user, sessionToken: session.raw };
    },

    /**
     * Deliberately returns the same generic error for "no such account" and
     * "wrong password" — distinguishing them lets an attacker enumerate
     * registered emails. See docs/authorization.md.
     */
    async login(input: LoginInput, context: RequestContext) {
      const email = normalizeEmail(input.email);
      const [user] = await deps.db
        .select({
          id: schema.users.id,
          email: schema.users.email,
          name: schema.users.name,
          avatarUrl: schema.users.avatarUrl,
          status: schema.users.status,
          platformRole: schema.users.platformRole,
          createdAt: schema.users.createdAt,
          passwordHash: schema.users.passwordHash,
        })
        .from(schema.users)
        .where(eq(schema.users.email, email))
        .limit(1);

      const invalidCredentials = () => new DomainError(401, 'Invalid email or password');

      if (!user || !user.passwordHash) {
        // Run a hash verification anyway against a fixed dummy hash so the
        // response time doesn't reveal whether the account exists.
        await verifyPassword(
          '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0c2FsdA$AAAAAAAAAAAAAAAAAAAAAA',
          input.password,
        );
        throw invalidCredentials();
      }

      if (!(await verifyPassword(user.passwordHash, input.password))) {
        throw invalidCredentials();
      }
      if (user.status !== 'active') {
        throw new DomainError(403, 'This account is not active');
      }

      await deps.db
        .update(schema.users)
        .set({ lastLoginAt: new Date() })
        .where(eq(schema.users.id, user.id));

      await deps.audit.record({
        actorUserId: user.id,
        action: 'user.logged_in',
        resourceType: 'user',
        resourceId: user.id,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      const session = await createSession(deps, user.id, context);
      const { passwordHash: _passwordHash, ...safeUser } = user;
      return { user: safeUser, sessionToken: session.raw };
    },

    async logout(userId: string, rawSessionToken: string, context: RequestContext) {
      const tokenHash = hashSessionToken(rawSessionToken, deps.credentialMasterKey);

      await deps.db
        .update(schema.sessions)
        .set({ revokedAt: new Date() })
        .where(eq(schema.sessions.tokenHash, tokenHash));

      await deps.audit.record({
        actorUserId: userId,
        action: 'user.logged_out',
        resourceType: 'user',
        resourceId: userId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });
    },

    async getCurrentUser(userId: string) {
      const [user] = await deps.db
        .select(SAFE_USER_COLUMNS)
        .from(schema.users)
        .where(eq(schema.users.id, userId))
        .limit(1);
      return user ?? null;
    },
  };
}

async function createSession(deps: AuthServiceDeps, userId: string, context: RequestContext) {
  const generated = generateSessionToken(deps.credentialMasterKey);
  await deps.db.insert(schema.sessions).values({
    userId,
    tokenHash: generated.tokenHash,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    userAgent: context.userAgent ?? null,
    ipAddress: context.ipAddress ?? null,
  });
  return generated;
}

export type AuthService = ReturnType<typeof createAuthService>;
