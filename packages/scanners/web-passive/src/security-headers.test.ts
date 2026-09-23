import { describe, expect, it } from 'vitest';
import { securityHeadersCheck } from './security-headers.js';
import { makeObservation, testContext } from './test-helpers.js';

function keys(observation: Parameters<typeof securityHeadersCheck.run>[0]) {
  return securityHeadersCheck.run(observation, testContext).map((f) => f.key);
}

describe('securityHeadersCheck — CSP', () => {
  it('flags missing CSP', () => {
    expect(keys(makeObservation({ headers: {} }))).toContain('csp-missing');
  });

  it('does not flag a safe CSP', () => {
    const found = keys(
      makeObservation({ headers: { 'content-security-policy': "default-src 'self'" } }),
    );
    expect(found).not.toContain('csp-missing');
    expect(found).not.toContain('csp-unsafe-directive');
  });

  it('flags an unsafe-inline/unsafe-eval CSP directive', () => {
    const found = keys(
      makeObservation({
        headers: { 'content-security-policy': "script-src 'self' 'unsafe-inline'" },
      }),
    );
    expect(found).toContain('csp-unsafe-directive');
    expect(found).not.toContain('csp-missing');
  });
});

describe('securityHeadersCheck — HSTS', () => {
  it('flags missing HSTS on an HTTPS response', () => {
    expect(keys(makeObservation({ scheme: 'https', headers: {} }))).toContain('hsts-missing');
  });

  it('does not flag missing HSTS on an HTTP response', () => {
    expect(keys(makeObservation({ scheme: 'http', headers: {} }))).not.toContain('hsts-missing');
  });

  it('does not flag a strong HSTS header', () => {
    const found = keys(
      makeObservation({
        scheme: 'https',
        headers: { 'strict-transport-security': 'max-age=31536000; includeSubDomains' },
      }),
    );
    expect(found).not.toContain('hsts-missing');
    expect(found).not.toContain('hsts-weak-max-age');
  });

  it('flags a very low HSTS max-age', () => {
    const found = keys(
      makeObservation({ scheme: 'https', headers: { 'strict-transport-security': 'max-age=10' } }),
    );
    expect(found).toContain('hsts-weak-max-age');
  });
});

describe('securityHeadersCheck — X-Content-Type-Options', () => {
  it('flags missing X-Content-Type-Options', () => {
    expect(keys(makeObservation({ headers: {} }))).toContain('xcto-missing');
  });

  it('accepts nosniff regardless of casing/whitespace', () => {
    expect(
      keys(makeObservation({ headers: { 'x-content-type-options': ' NoSniff ' } })),
    ).not.toContain('xcto-missing');
    expect(
      keys(makeObservation({ headers: { 'x-content-type-options': ' NoSniff ' } })),
    ).not.toContain('xcto-invalid-value');
  });

  it('flags an unrecognized value', () => {
    expect(keys(makeObservation({ headers: { 'x-content-type-options': 'garbage' } }))).toContain(
      'xcto-invalid-value',
    );
  });
});

describe('securityHeadersCheck — Referrer-Policy', () => {
  it('flags a missing Referrer-Policy', () => {
    expect(keys(makeObservation({ headers: {} }))).toContain('referrer-policy-missing');
  });

  it('does not flag a valid, non-weak policy', () => {
    const found = keys(
      makeObservation({ headers: { 'referrer-policy': 'strict-origin-when-cross-origin' } }),
    );
    expect(found).not.toContain('referrer-policy-missing');
    expect(found).not.toContain('referrer-policy-weak');
  });

  it('flags unsafe-url', () => {
    expect(keys(makeObservation({ headers: { 'referrer-policy': 'unsafe-url' } }))).toContain(
      'referrer-policy-weak',
    );
  });
});

describe('securityHeadersCheck — Permissions-Policy', () => {
  it('reports an INFO observation when missing', () => {
    const findings = securityHeadersCheck.run(makeObservation({ headers: {} }), testContext);
    const finding = findings.find((f) => f.key === 'permissions-policy-missing');
    expect(finding?.severity).toBe('INFO');
  });

  it('does not flag when present', () => {
    expect(
      keys(makeObservation({ headers: { 'permissions-policy': 'geolocation=()' } })),
    ).not.toContain('permissions-policy-missing');
  });
});

describe('securityHeadersCheck — framing protection', () => {
  it('flags when neither X-Frame-Options nor CSP frame-ancestors is present', () => {
    expect(keys(makeObservation({ headers: {} }))).toContain('framing-protection-missing');
  });

  it('does not flag when X-Frame-Options is DENY', () => {
    expect(keys(makeObservation({ headers: { 'x-frame-options': 'DENY' } }))).not.toContain(
      'framing-protection-missing',
    );
  });

  it('does not flag when CSP frame-ancestors is present, even without X-Frame-Options', () => {
    expect(
      keys(makeObservation({ headers: { 'content-security-policy': "frame-ancestors 'self'" } })),
    ).not.toContain('framing-protection-missing');
  });

  it('never reports two separate framing findings when both mechanisms are absent', () => {
    const findings = securityHeadersCheck.run(makeObservation({ headers: {} }), testContext);
    expect(
      findings.filter((f) => f.category === 'security-headers' && f.key.startsWith('framing')),
    ).toHaveLength(1);
  });
});
