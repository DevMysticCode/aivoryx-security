import { describe, expect, it } from 'vitest';
import { corsCheck } from './cors.js';
import { makeObservation, testContext } from './test-helpers.js';

function run(headers: Record<string, string>) {
  return corsCheck.run(makeObservation({ headers }), testContext);
}

describe('corsCheck', () => {
  it('flags a wildcard origin at LOW severity, HIGH confidence', () => {
    const findings = run({ 'access-control-allow-origin': '*' });
    const finding = findings.find((f) => f.key === 'cors-wildcard-origin');
    expect(finding?.severity).toBe('LOW');
    expect(finding?.confidence).toBe('HIGH');
  });

  it('flags wildcard origin + credentials at MEDIUM severity with reduced confidence', () => {
    const findings = run({
      'access-control-allow-origin': '*',
      'access-control-allow-credentials': 'true',
    });
    const finding = findings.find((f) => f.key === 'cors-wildcard-with-credentials');
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe('MEDIUM');
    expect(findings.find((f) => f.key === 'cors-wildcard-origin')).toBeUndefined();
  });

  it('does not flag a specific explicit origin', () => {
    const findings = run({ 'access-control-allow-origin': 'https://trusted.example.com' });
    expect(findings).toHaveLength(0);
  });

  it('produces no finding when no CORS headers are present', () => {
    expect(run({})).toHaveLength(0);
  });

  it('does not claim a vulnerability it cannot passively prove (specific origin + credentials)', () => {
    const findings = run({
      'access-control-allow-origin': 'https://trusted.example.com',
      'access-control-allow-credentials': 'true',
    });
    expect(findings).toHaveLength(0);
  });
});
