import { describe, expect, it } from 'vitest';
import {
  generateApiKey,
  hashApiKeySecret,
  verifyApiKeySecret,
  parseApiKeyHeader,
  verifyApiKeyCredential,
  type ApiKeyRecordLike,
} from './api-key.js';

const MASTER_KEY = 'test-master-key-not-for-production-use';

describe('generateApiKey', () => {
  it('returns a raw secret, a safe prefix, and a hash that never contains the raw secret', () => {
    const generated = generateApiKey(MASTER_KEY);

    expect(generated.raw).toContain(generated.keyPrefix);
    expect(generated.keyHash).not.toContain(generated.raw);
    // The hash must not simply be recoverable by string containment of the secret half either.
    const [, secretPart] = generated.raw.split('.');
    expect(generated.keyHash).not.toContain(secretPart);
  });

  it('generates unique keys on each call', () => {
    const a = generateApiKey(MASTER_KEY);
    const b = generateApiKey(MASTER_KEY);
    expect(a.raw).not.toBe(b.raw);
    expect(a.keyHash).not.toBe(b.keyHash);
  });
});

describe('verifyApiKeySecret', () => {
  it('verifies a correct secret against its hash, and rejects an unrelated hash', () => {
    const secret = 'known-secret-value';
    const hash = hashApiKeySecret(secret, MASTER_KEY);
    const unrelatedHash = generateApiKey(MASTER_KEY).keyHash;

    expect(verifyApiKeySecret(secret, hash, MASTER_KEY)).toBe(true);
    expect(verifyApiKeySecret(secret, unrelatedHash, MASTER_KEY)).toBe(false);
  });

  it('rejects a wrong secret', () => {
    const hash = hashApiKeySecret('correct-secret', MASTER_KEY);
    expect(verifyApiKeySecret('wrong-secret', hash, MASTER_KEY)).toBe(false);
  });

  it('rejects a hash produced with a different master key', () => {
    const hash = hashApiKeySecret('some-secret', 'other-master-key');
    expect(verifyApiKeySecret('some-secret', hash, MASTER_KEY)).toBe(false);
  });

  it('rejects a tampered/malformed stored hash without throwing', () => {
    expect(verifyApiKeySecret('some-secret', 'not-a-valid-hex-hash', MASTER_KEY)).toBe(false);
  });
});

describe('parseApiKeyHeader', () => {
  it('parses a bare raw key', () => {
    const { raw, keyPrefix } = generateApiKey(MASTER_KEY);
    const parsed = parseApiKeyHeader(raw);
    expect(parsed?.keyPrefix).toBe(keyPrefix);
  });

  it('parses a Bearer-prefixed header', () => {
    const { raw, keyPrefix } = generateApiKey(MASTER_KEY);
    const parsed = parseApiKeyHeader(`Bearer ${raw}`);
    expect(parsed?.keyPrefix).toBe(keyPrefix);
  });

  it('returns null for missing, empty, or malformed headers', () => {
    expect(parseApiKeyHeader(undefined)).toBeNull();
    expect(parseApiKeyHeader(null)).toBeNull();
    expect(parseApiKeyHeader('')).toBeNull();
    expect(parseApiKeyHeader('not-an-api-key')).toBeNull();
    expect(parseApiKeyHeader('avx_missingdot')).toBeNull();
    expect(parseApiKeyHeader('Bearer sometoken')).toBeNull();
  });
});

describe('verifyApiKeyCredential', () => {
  function recordFor(secret: string, overrides: Partial<ApiKeyRecordLike> = {}): ApiKeyRecordLike {
    return {
      id: 'key-1',
      organizationId: 'org-1',
      keyHash: hashApiKeySecret(secret, MASTER_KEY),
      status: 'active',
      expiresAt: null,
      ...overrides,
    };
  }

  it('authenticates a valid, active, non-expired key', async () => {
    const { raw, keyPrefix } = generateApiKey(MASTER_KEY);
    const secret = raw.split('.')[1] as string;
    const record = recordFor(secret);

    const result = await verifyApiKeyCredential({
      headerValue: raw,
      masterKey: MASTER_KEY,
      findByPrefix: async (prefix) => (prefix === keyPrefix ? record : null),
    });

    expect(result).toEqual({ ok: true, apiKey: record });
  });

  it('rejects when no header is present', async () => {
    const result = await verifyApiKeyCredential({
      headerValue: undefined,
      masterKey: MASTER_KEY,
      findByPrefix: async () => null,
    });
    expect(result).toEqual({ ok: false, reason: 'missing' });
  });

  it('rejects an unparseable header', async () => {
    const result = await verifyApiKeyCredential({
      headerValue: 'garbage',
      masterKey: MASTER_KEY,
      findByPrefix: async () => null,
    });
    expect(result).toEqual({ ok: false, reason: 'malformed' });
  });

  it('rejects when the prefix has no matching record', async () => {
    const { raw } = generateApiKey(MASTER_KEY);
    const result = await verifyApiKeyCredential({
      headerValue: raw,
      masterKey: MASTER_KEY,
      findByPrefix: async () => null,
    });
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  it('rejects a revoked key even with the correct secret', async () => {
    const { raw, keyPrefix } = generateApiKey(MASTER_KEY);
    const secret = raw.split('.')[1] as string;
    const record = recordFor(secret, { status: 'revoked' });

    const result = await verifyApiKeyCredential({
      headerValue: raw,
      masterKey: MASTER_KEY,
      findByPrefix: async (prefix) => (prefix === keyPrefix ? record : null),
    });
    expect(result).toEqual({ ok: false, reason: 'revoked' });
  });

  it('rejects an expired key even with the correct secret', async () => {
    const { raw, keyPrefix } = generateApiKey(MASTER_KEY);
    const secret = raw.split('.')[1] as string;
    const record = recordFor(secret, { expiresAt: new Date(Date.now() - 60_000) });

    const result = await verifyApiKeyCredential({
      headerValue: raw,
      masterKey: MASTER_KEY,
      findByPrefix: async (prefix) => (prefix === keyPrefix ? record : null),
    });
    expect(result).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects when the secret does not match the stored hash', async () => {
    const { keyPrefix } = generateApiKey(MASTER_KEY);
    const record = recordFor('the-real-secret');
    const forged = `avx_${keyPrefix}.wrong-secret-value`;

    const result = await verifyApiKeyCredential({
      headerValue: forged,
      masterKey: MASTER_KEY,
      findByPrefix: async (prefix) => (prefix === keyPrefix ? record : null),
    });
    expect(result).toEqual({ ok: false, reason: 'invalid_secret' });
  });

  it('never includes the raw secret anywhere in a failure result', async () => {
    const { raw, keyPrefix } = generateApiKey(MASTER_KEY);
    const record = recordFor('a-different-secret');

    const result = await verifyApiKeyCredential({
      headerValue: raw,
      masterKey: MASTER_KEY,
      findByPrefix: async (prefix) => (prefix === keyPrefix ? record : null),
    });

    expect(JSON.stringify(result)).not.toContain(raw.split('.')[1]);
  });
});
