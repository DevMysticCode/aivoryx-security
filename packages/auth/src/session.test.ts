import { describe, expect, it } from 'vitest';
import {
  generateSessionToken,
  hashSessionToken,
  verifySessionToken,
  verifySessionCredential,
  type SessionRecordLike,
} from './session.js';

const MASTER_KEY = 'test-master-key-not-for-production-use';

describe('generateSessionToken', () => {
  it('returns a raw token and a hash that never contains the raw token', () => {
    const generated = generateSessionToken(MASTER_KEY);
    expect(generated.tokenHash).not.toContain(generated.raw);
  });

  it('generates unique tokens on each call', () => {
    const a = generateSessionToken(MASTER_KEY);
    const b = generateSessionToken(MASTER_KEY);
    expect(a.raw).not.toBe(b.raw);
  });
});

describe('verifySessionToken', () => {
  it('verifies a correct token against its hash', () => {
    const { raw, tokenHash } = generateSessionToken(MASTER_KEY);
    expect(verifySessionToken(raw, tokenHash, MASTER_KEY)).toBe(true);
  });

  it('rejects a wrong token', () => {
    const hash = hashSessionToken('correct-token', MASTER_KEY);
    expect(verifySessionToken('wrong-token', hash, MASTER_KEY)).toBe(false);
  });

  it('rejects a hash produced with a different master key', () => {
    const hash = hashSessionToken('some-token', 'other-master-key');
    expect(verifySessionToken('some-token', hash, MASTER_KEY)).toBe(false);
  });
});

describe('verifySessionCredential', () => {
  function recordFor(raw: string, overrides: Partial<SessionRecordLike> = {}): SessionRecordLike {
    return {
      id: 'session-1',
      userId: 'user-1',
      tokenHash: hashSessionToken(raw, MASTER_KEY),
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      ...overrides,
    };
  }

  it('authenticates a valid, active, non-expired session', async () => {
    const { raw } = generateSessionToken(MASTER_KEY);
    const record = recordFor(raw);

    const result = await verifySessionCredential({
      rawToken: raw,
      masterKey: MASTER_KEY,
      findByTokenHash: async (hash) => (hash === record.tokenHash ? record : null),
    });

    expect(result).toEqual({ ok: true, session: record });
  });

  it('rejects when no token is present', async () => {
    const result = await verifySessionCredential({
      rawToken: undefined,
      masterKey: MASTER_KEY,
      findByTokenHash: async () => null,
    });
    expect(result).toEqual({ ok: false, reason: 'missing' });
  });

  it('rejects when no session matches the token hash', async () => {
    const { raw } = generateSessionToken(MASTER_KEY);
    const result = await verifySessionCredential({
      rawToken: raw,
      masterKey: MASTER_KEY,
      findByTokenHash: async () => null,
    });
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  it('rejects a revoked session', async () => {
    const { raw } = generateSessionToken(MASTER_KEY);
    const record = recordFor(raw, { revokedAt: new Date() });

    const result = await verifySessionCredential({
      rawToken: raw,
      masterKey: MASTER_KEY,
      findByTokenHash: async () => record,
    });
    expect(result).toEqual({ ok: false, reason: 'revoked' });
  });

  it('rejects an expired session', async () => {
    const { raw } = generateSessionToken(MASTER_KEY);
    const record = recordFor(raw, { expiresAt: new Date(Date.now() - 60_000) });

    const result = await verifySessionCredential({
      rawToken: raw,
      masterKey: MASTER_KEY,
      findByTokenHash: async () => record,
    });
    expect(result).toEqual({ ok: false, reason: 'expired' });
  });
});
