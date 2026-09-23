import { describe, expect, it } from 'vitest';
import { cookieSecurityCheck } from './cookies.js';
import { makeObservation, testContext } from './test-helpers.js';

function run(observation: Parameters<typeof cookieSecurityCheck.run>[0]) {
  return cookieSecurityCheck.run(observation, testContext);
}

describe('cookieSecurityCheck', () => {
  it('flags a sensitive-looking cookie missing Secure on HTTPS at MEDIUM severity', () => {
    const findings = run(
      makeObservation({
        scheme: 'https',
        cookies: [
          {
            name: 'session',
            secure: false,
            httpOnly: true,
            sameSite: 'Lax',
            domain: null,
            path: null,
          },
        ],
      }),
    );
    const finding = findings.find((f) => f.key === 'cookie:session:missing-secure');
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe('MEDIUM');
  });

  it('does not flag missing Secure on an HTTP response', () => {
    const findings = run(
      makeObservation({
        scheme: 'http',
        cookies: [
          {
            name: 'session',
            secure: false,
            httpOnly: true,
            sameSite: 'Lax',
            domain: null,
            path: null,
          },
        ],
      }),
    );
    expect(findings.find((f) => f.key === 'cookie:session:missing-secure')).toBeUndefined();
  });

  it('does not flag Secure when present', () => {
    const findings = run(
      makeObservation({
        scheme: 'https',
        cookies: [
          {
            name: 'session',
            secure: true,
            httpOnly: true,
            sameSite: 'Lax',
            domain: null,
            path: null,
          },
        ],
      }),
    );
    expect(findings.find((f) => f.key === 'cookie:session:missing-secure')).toBeUndefined();
  });

  it('flags missing HttpOnly regardless of scheme', () => {
    const findings = run(
      makeObservation({
        cookies: [
          {
            name: 'prefs',
            secure: true,
            httpOnly: false,
            sameSite: 'Lax',
            domain: null,
            path: null,
          },
        ],
      }),
    );
    expect(findings.find((f) => f.key === 'cookie:prefs:missing-httponly')).toBeDefined();
  });

  it('does not flag HttpOnly when present', () => {
    const findings = run(
      makeObservation({
        cookies: [
          {
            name: 'prefs',
            secure: true,
            httpOnly: true,
            sameSite: 'Lax',
            domain: null,
            path: null,
          },
        ],
      }),
    );
    expect(findings.find((f) => f.key === 'cookie:prefs:missing-httponly')).toBeUndefined();
  });

  it('uses LOW severity for a non-sensitive-looking cookie missing flags', () => {
    const findings = run(
      makeObservation({
        scheme: 'https',
        cookies: [
          {
            name: 'theme',
            secure: false,
            httpOnly: false,
            sameSite: 'Lax',
            domain: null,
            path: null,
          },
        ],
      }),
    );
    expect(findings.find((f) => f.key === 'cookie:theme:missing-secure')?.severity).toBe('LOW');
    expect(findings.find((f) => f.key === 'cookie:theme:missing-httponly')?.severity).toBe('LOW');
  });

  it('flags a missing SameSite as INFO', () => {
    const findings = run(
      makeObservation({
        cookies: [
          { name: 'a', secure: true, httpOnly: true, sameSite: null, domain: null, path: null },
        ],
      }),
    );
    const finding = findings.find((f) => f.key === 'cookie:a:missing-samesite');
    expect(finding?.severity).toBe('INFO');
  });

  it('does not flag SameSite when set', () => {
    const findings = run(
      makeObservation({
        cookies: [
          { name: 'a', secure: true, httpOnly: true, sameSite: 'Strict', domain: null, path: null },
        ],
      }),
    );
    expect(findings.find((f) => f.key === 'cookie:a:missing-samesite')).toBeUndefined();
  });

  it('flags SameSite=None without Secure', () => {
    const findings = run(
      makeObservation({
        cookies: [
          { name: 'a', secure: false, httpOnly: true, sameSite: 'None', domain: null, path: null },
        ],
      }),
    );
    expect(findings.find((f) => f.key === 'cookie:a:samesite-none-without-secure')).toBeDefined();
  });

  it('handles multiple cookies independently', () => {
    const findings = run(
      makeObservation({
        scheme: 'https',
        cookies: [
          {
            name: 'session',
            secure: false,
            httpOnly: false,
            sameSite: null,
            domain: null,
            path: null,
          },
          {
            name: 'theme',
            secure: true,
            httpOnly: true,
            sameSite: 'Strict',
            domain: null,
            path: null,
          },
        ],
      }),
    );
    expect(findings.filter((f) => f.key.startsWith('cookie:session:'))).toHaveLength(3);
    expect(findings.filter((f) => f.key.startsWith('cookie:theme:'))).toHaveLength(0);
  });

  it('never includes a cookie value anywhere in the finding output', () => {
    const findings = run(
      makeObservation({
        scheme: 'https',
        cookies: [
          {
            name: 'session',
            secure: false,
            httpOnly: false,
            sameSite: null,
            domain: null,
            path: null,
          },
        ],
      }),
    );
    expect(JSON.stringify(findings)).not.toMatch(/=[^&\s"]+/); // no leftover "name=value" pattern
  });

  it('produces no findings for an observation with no cookies', () => {
    expect(run(makeObservation({ cookies: [] }))).toHaveLength(0);
  });
});
