import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// Session tokens are high-entropy random data (not a human secret), so — like
// API keys — they're hashed with a keyed HMAC rather than a slow password KDF.
// See api-key.ts for the identical rationale.

export const SESSION_COOKIE_NAME = 'aivoryx_session';
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days, fixed at creation (no sliding renewal yet)

export interface GeneratedSessionToken {
  /** The full token. Set this once in an httpOnly cookie; never persist it. */
  raw: string;
  /** Keyed hash of the token. Persist this — never the raw token. */
  tokenHash: string;
}

export function generateSessionToken(masterKey: string): GeneratedSessionToken {
  const raw = randomBytes(32).toString('base64url');
  return { raw, tokenHash: hashSessionToken(raw, masterKey) };
}

export function hashSessionToken(raw: string, masterKey: string): string {
  return createHmac('sha256', masterKey).update(raw).digest('hex');
}

/** Constant-time comparison against the stored hash — never a plain `===`. */
export function verifySessionToken(raw: string, expectedHash: string, masterKey: string): boolean {
  const actual = Buffer.from(hashSessionToken(raw, masterKey), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export interface SessionRecordLike {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface VerifySessionOptions {
  rawToken: string | undefined | null;
  masterKey: string;
  /** Looks up the session by its token hash. Injected so this package never
   * depends on @aivoryx/db directly. */
  findByTokenHash: (tokenHash: string) => Promise<SessionRecordLike | null>;
}

export type SessionVerificationFailureReason = 'missing' | 'not_found' | 'revoked' | 'expired';

export type VerifySessionResult =
  | { ok: true; session: SessionRecordLike }
  | { ok: false; reason: SessionVerificationFailureReason };

/**
 * Verifies a raw session token from the session cookie: hash it, look up the
 * candidate by hash, then check revoked/expired. Never logs or returns the raw
 * token.
 */
export async function verifySessionCredential(
  options: VerifySessionOptions,
): Promise<VerifySessionResult> {
  if (!options.rawToken) return { ok: false, reason: 'missing' };

  const tokenHash = hashSessionToken(options.rawToken, options.masterKey);
  const record = await options.findByTokenHash(tokenHash);
  if (!record) return { ok: false, reason: 'not_found' };
  if (record.revokedAt) return { ok: false, reason: 'revoked' };
  if (record.expiresAt.getTime() <= Date.now()) return { ok: false, reason: 'expired' };

  return { ok: true, session: record };
}
