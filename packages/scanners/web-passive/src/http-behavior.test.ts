import { describe, expect, it } from 'vitest';
import { httpBehaviorCheck } from './http-behavior.js';
import { makeObservation, testContext } from './test-helpers.js';

describe('httpBehaviorCheck', () => {
  it('flags a 5xx response', () => {
    const findings = httpBehaviorCheck.run(makeObservation({ status: 503 }), testContext);
    expect(findings.find((f) => f.key === 'http-5xx-response')).toBeDefined();
  });

  it('does not flag a 200 response', () => {
    const findings = httpBehaviorCheck.run(makeObservation({ status: 200 }), testContext);
    expect(findings.find((f) => f.key === 'http-5xx-response')).toBeUndefined();
  });

  it('flags a 200 response missing Content-Type', () => {
    const findings = httpBehaviorCheck.run(
      makeObservation({ status: 200, contentType: null }),
      testContext,
    );
    expect(findings.find((f) => f.key === 'missing-content-type')).toBeDefined();
  });

  it('does not flag when Content-Type is present', () => {
    const findings = httpBehaviorCheck.run(
      makeObservation({ status: 200, contentType: 'text/html' }),
      testContext,
    );
    expect(findings.find((f) => f.key === 'missing-content-type')).toBeUndefined();
  });
});
