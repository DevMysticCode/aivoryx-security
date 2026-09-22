import { describe, expect, it } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  validatePasswordStrength,
  PASSWORD_MIN_LENGTH,
} from './password.js';

describe('hashPassword / verifyPassword', () => {
  it('hashes a password to a value that never contains the plaintext', async () => {
    const password = 'correct horse battery staple 42';
    const hash = await hashPassword(password);
    expect(hash).not.toContain(password);
  });

  it('verifies the correct password against its hash', async () => {
    const password = 'correct horse battery staple 42';
    const hash = await hashPassword(password);
    expect(await verifyPassword(hash, password)).toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('the-real-password-123');
    expect(await verifyPassword(hash, 'a-wrong-password-123')).toBe(false);
  });

  it('produces a different hash for the same password on each call (random salt)', async () => {
    const password = 'same password used twice 99';
    const [a, b] = await Promise.all([hashPassword(password), hashPassword(password)]);
    expect(a).not.toBe(b);
  });

  it('returns false rather than throwing for a malformed/foreign hash', async () => {
    await expect(verifyPassword('not-a-real-argon2-hash', 'anything')).resolves.toBe(false);
  });
});

describe('validatePasswordStrength', () => {
  it('accepts a password meeting all requirements', () => {
    const result = validatePasswordStrength('correcthorse123');
    expect(result).toEqual({ valid: true, errors: [] });
  });

  it('rejects a password shorter than the minimum length', () => {
    const result = validatePasswordStrength('short1');
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes(String(PASSWORD_MIN_LENGTH)))).toBe(true);
  });

  it('rejects an all-numeric password', () => {
    const result = validatePasswordStrength('123456789012');
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('letter'))).toBe(true);
  });

  it('rejects a password with no digits', () => {
    const result = validatePasswordStrength('nodigitsatallhere');
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('number'))).toBe(true);
  });

  it('reports every violated rule, not just the first', () => {
    const result = validatePasswordStrength('short');
    expect(result.errors.length).toBeGreaterThan(1);
  });
});
