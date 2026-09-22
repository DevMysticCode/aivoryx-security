import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { OrganizationRole } from './roles.js';

const KEY_ID_PREFIX = 'avx';

/**
 * API keys carry high-entropy random secrets (not human-chosen passwords), so a
 * slow password-hashing KDF (bcrypt/argon2) is unnecessary and would only add
 * latency to every authenticated request. A keyed HMAC-SHA256 (keyed with
 * CREDENTIAL_MASTER_KEY) is the appropriate primitive here: verification is fast,
 * and without the master key an attacker who steals the `key_hash` column cannot
 * brute-force it offline the way they could a plain, unkeyed SHA-256 hash.
 */

export interface GeneratedApiKey {
  /** The full secret. Return this to the caller exactly once; never persist it. */
  raw: string;
  /** Safe, non-secret identifier. Persist and freely log/display this. */
  keyPrefix: string;
  /** Keyed hash of the secret. Persist this — never the raw secret. */
  keyHash: string;
}

export function generateApiKey(masterKey: string): GeneratedApiKey {
  const keyPrefix = randomBytes(6).toString('hex');
  const secret = randomBytes(32).toString('base64url');
  const raw = `${KEY_ID_PREFIX}_${keyPrefix}.${secret}`;
  return { raw, keyPrefix, keyHash: hashApiKeySecret(secret, masterKey) };
}

export function hashApiKeySecret(secret: string, masterKey: string): string {
  return createHmac('sha256', masterKey).update(secret).digest('hex');
}

/** Constant-time comparison against the stored hash — never a plain `===`. */
export function verifyApiKeySecret(
  secret: string,
  expectedHash: string,
  masterKey: string,
): boolean {
  const actual = Buffer.from(hashApiKeySecret(secret, masterKey), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export interface ParsedApiKey {
  keyPrefix: string;
  secret: string;
}

/**
 * Extracts {keyPrefix, secret} from an `Authorization` header value, accepting
 * either `Bearer avx_<prefix>.<secret>` or the bare `avx_<prefix>.<secret>` form.
 * Returns null for anything malformed — never throws on untrusted input.
 */
export function parseApiKeyHeader(headerValue: string | undefined | null): ParsedApiKey | null {
  if (!headerValue) return null;
  const trimmed = headerValue.trim();
  const bearerMatch = /^Bearer\s+(.+)$/i.exec(trimmed);
  const rawKey = bearerMatch?.[1] ?? trimmed;

  const expectedPrefix = `${KEY_ID_PREFIX}_`;
  if (!rawKey.startsWith(expectedPrefix)) return null;

  const remainder = rawKey.slice(expectedPrefix.length);
  const dotIndex = remainder.indexOf('.');
  if (dotIndex <= 0) return null;

  const keyPrefix = remainder.slice(0, dotIndex);
  const secret = remainder.slice(dotIndex + 1);
  if (!keyPrefix || !secret) return null;

  return { keyPrefix, secret };
}

/** Minimal shape verifyApiKeyCredential needs — satisfied by a Drizzle apiKeys row. */
export interface ApiKeyRecordLike {
  id: string;
  organizationId: string;
  keyHash: string;
  status: 'active' | 'revoked';
  expiresAt: Date | null;
}

export interface VerifyApiKeyOptions {
  headerValue: string | undefined | null;
  masterKey: string;
  /** Looks up the candidate row by its safe, non-secret prefix. Injected so this
   * package never depends on @aivoryx/db directly. */
  findByPrefix: (keyPrefix: string) => Promise<ApiKeyRecordLike | null>;
}

export type ApiKeyVerificationFailureReason =
  'missing' | 'malformed' | 'not_found' | 'revoked' | 'expired' | 'invalid_secret';

export type VerifyApiKeyResult =
  { ok: true; apiKey: ApiKeyRecordLike } | { ok: false; reason: ApiKeyVerificationFailureReason };

/**
 * The full API-key authentication flow described in the architecture: parse ->
 * look up by prefix -> verify hash -> check revoked/expired. Never logs or
 * returns the raw secret; callers must not log `headerValue` either.
 */
export async function verifyApiKeyCredential(
  options: VerifyApiKeyOptions,
): Promise<VerifyApiKeyResult> {
  const parsed = parseApiKeyHeader(options.headerValue);
  if (!parsed) {
    return { ok: false, reason: options.headerValue ? 'malformed' : 'missing' };
  }

  const record = await options.findByPrefix(parsed.keyPrefix);
  if (!record) return { ok: false, reason: 'not_found' };
  if (record.status === 'revoked') return { ok: false, reason: 'revoked' };
  if (record.expiresAt && record.expiresAt.getTime() <= Date.now()) {
    return { ok: false, reason: 'expired' };
  }
  if (!verifyApiKeySecret(parsed.secret, record.keyHash, options.masterKey)) {
    return { ok: false, reason: 'invalid_secret' };
  }

  return { ok: true, apiKey: record };
}

/**
 * API keys are organization credentials, not tied to an individual member's role.
 * This batch does not implement per-key scoped permissions (every key for an
 * organization gets the same fixed role), so the default must be broad enough for
 * a key to be useful for automation/CI — including managing the organization's
 * own API keys — while still excluding billing administration, matching ADMIN
 * rather than OWNER. DEVELOPER/SECURITY_MANAGER/VIEWER lack api_key:* entirely,
 * so a key could never manage itself under any of those. Revisit with per-key
 * scopes in a future batch.
 */
export const API_KEY_DEFAULT_ROLE: OrganizationRole = 'ADMIN';
