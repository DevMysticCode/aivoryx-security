import { hash, verify } from '@node-rs/argon2';

// @node-rs/argon2 ships prebuilt native binaries (no node-gyp/compiler needed at
// install time, unlike the reference `argon2` package) and defaults to Argon2id
// with OWASP-recommended parameters — the right primitive for human passwords,
// unlike the keyed-HMAC used for API keys/sessions: passwords are low-entropy
// and attacker-guessable, so they need a deliberately slow, memory-hard KDF.

export async function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    // Malformed/foreign hash (e.g. a future non-Argon2 format) — treat as a
    // failed verification, never throw a credential check up to the caller.
    return false;
  }
}

export const PASSWORD_MIN_LENGTH = 12;

export interface PasswordValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Minimum viable password policy: long enough to resist offline guessing once
 * hashed with Argon2id, with at least one letter and one digit to rule out
 * trivially weak all-numeric/all-repeated inputs. Deliberately not a full
 * breached-password-list check (e.g. HaveIBeenPwned) — that's a reasonable
 * future improvement, not required for this foundation.
 */
export function validatePasswordStrength(password: string): PasswordValidationResult {
  const errors: string[] = [];

  if (password.length < PASSWORD_MIN_LENGTH) {
    errors.push(`Password must be at least ${PASSWORD_MIN_LENGTH} characters`);
  }
  if (!/[a-zA-Z]/.test(password)) {
    errors.push('Password must contain at least one letter');
  }
  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }

  return { valid: errors.length === 0, errors };
}
