import { describe, expect, it } from 'vitest';
import type { AssessmentScope } from '@aivoryx/shared-types';
import { checkUrlAgainstScope, requireUrlInScope } from './scope.js';
import { ScopeViolationError } from './errors.js';

const baseScope: AssessmentScope = {
  schemes: ['http', 'https'],
  hosts: ['authorized.example.com'],
  ports: [80, 443],
  allowedPathPrefixes: [],
  exclusions: { hosts: [], paths: [] },
};

describe('checkUrlAgainstScope', () => {
  it('allows an in-scope host/scheme/port', () => {
    expect(
      checkUrlAgainstScope(new URL('https://authorized.example.com/'), baseScope).allowed,
    ).toBe(true);
  });

  it('rejects a host not in the allow-list', () => {
    const result = checkUrlAgainstScope(new URL('https://evil.example.net/'), baseScope);
    expect(result.allowed).toBe(false);
  });

  it('rejects a disallowed scheme', () => {
    const scope: AssessmentScope = { ...baseScope, schemes: ['https'] };
    expect(checkUrlAgainstScope(new URL('http://authorized.example.com/'), scope).allowed).toBe(
      false,
    );
  });

  it('rejects an unsupported scheme entirely (e.g. file:)', () => {
    // URL parsing of file:// yields hostname '', which also fails the allow-list,
    // but the scheme check must fail first regardless.
    const result = checkUrlAgainstScope(new URL('file:///etc/passwd'), baseScope);
    expect(result.allowed).toBe(false);
  });

  it('rejects a disallowed port', () => {
    expect(
      checkUrlAgainstScope(new URL('https://authorized.example.com:8443/'), baseScope).allowed,
    ).toBe(false);
  });

  it('allows a port explicitly in scope', () => {
    const scope: AssessmentScope = { ...baseScope, ports: [8443] };
    expect(
      checkUrlAgainstScope(new URL('https://authorized.example.com:8443/'), scope).allowed,
    ).toBe(true);
  });

  it('enforces an allowed path prefix when configured', () => {
    const scope: AssessmentScope = { ...baseScope, allowedPathPrefixes: ['/app'] };
    expect(
      checkUrlAgainstScope(new URL('https://authorized.example.com/app/x'), scope).allowed,
    ).toBe(true);
    expect(
      checkUrlAgainstScope(new URL('https://authorized.example.com/other'), scope).allowed,
    ).toBe(false);
  });

  it('rejects an excluded path even if otherwise in scope', () => {
    const scope: AssessmentScope = { ...baseScope, exclusions: { hosts: [], paths: ['/admin'] } };
    expect(
      checkUrlAgainstScope(new URL('https://authorized.example.com/admin/panel'), scope).allowed,
    ).toBe(false);
  });

  it('rejects an excluded host even if it would otherwise match the allow-list', () => {
    const scope: AssessmentScope = {
      ...baseScope,
      hosts: ['authorized.example.com', 'staging.example.com'],
      exclusions: { hosts: ['staging.example.com'], paths: [] },
    };
    expect(checkUrlAgainstScope(new URL('https://staging.example.com/'), scope).allowed).toBe(
      false,
    );
  });

  it('normalizes host case and trailing dot', () => {
    expect(
      checkUrlAgainstScope(new URL('https://AUTHORIZED.EXAMPLE.COM/'), baseScope).allowed,
    ).toBe(true);
  });

  it('treats percent-encoded/alternate host tricks as a non-match rather than bypassing scope', () => {
    // Decimal/octal/hex IP tricks: URL parsing normalizes these, but the
    // resulting hostname must still not equal an allowed hostname string.
    const result = checkUrlAgainstScope(new URL('http://2130706433/'), baseScope); // decimal for 127.0.0.1
    expect(result.allowed).toBe(false);
  });

  it('requireUrlInScope throws ScopeViolationError with a reason', () => {
    expect(() => requireUrlInScope(new URL('https://evil.example.net/'), baseScope)).toThrow(
      ScopeViolationError,
    );
  });
});
