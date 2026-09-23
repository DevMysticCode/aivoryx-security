import { describe, expect, it } from 'vitest';
import { transportCheck } from './transport.js';
import { makeObservation, testContext } from './test-helpers.js';

describe('transportCheck', () => {
  it('produces no finding for an HTTPS target staying on HTTPS', () => {
    const findings = transportCheck.run(
      makeObservation({
        requestedUrl: 'https://example.com/',
        finalUrl: 'https://example.com/',
        scheme: 'https',
      }),
      testContext,
    );
    expect(findings).toHaveLength(0);
  });

  it('flags an HTTPS target that redirected to HTTP', () => {
    const findings = transportCheck.run(
      makeObservation({
        requestedUrl: 'https://example.com/',
        finalUrl: 'http://example.com/',
        scheme: 'http',
      }),
      testContext,
    );
    const finding = findings.find((f) => f.key === 'https-downgrade-redirect');
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe('MEDIUM');
    expect(finding?.confidence).toBe('HIGH');
  });

  it('flags an HTTP target at LOW severity, not HIGH/CRITICAL', () => {
    const findings = transportCheck.run(
      makeObservation({
        requestedUrl: 'http://example.com/',
        finalUrl: 'http://example.com/',
        scheme: 'http',
      }),
      testContext,
    );
    const finding = findings.find((f) => f.key === 'http-target');
    expect(finding?.severity).toBe('LOW');
  });

  it('does not report both http-target and https-downgrade-redirect for the same observation', () => {
    const findings = transportCheck.run(
      makeObservation({
        requestedUrl: 'http://example.com/',
        finalUrl: 'http://example.com/',
        scheme: 'http',
      }),
      testContext,
    );
    expect(findings).toHaveLength(1);
  });
});
