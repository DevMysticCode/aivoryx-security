import { describe, expect, it } from 'vitest';
import { informationDisclosureCheck } from './information-disclosure.js';
import { makeObservation, testContext } from './test-helpers.js';

function run(headers: Record<string, string>) {
  return informationDisclosureCheck.run(makeObservation({ headers }), testContext);
}

describe('informationDisclosureCheck', () => {
  it('flags a Server header at INFO severity', () => {
    const findings = run({ server: 'nginx/1.24.0' });
    const finding = findings.find((f) => f.key === 'disclosure:server');
    expect(finding?.severity).toBe('INFO');
    expect(finding?.confidence).toBe('HIGH');
    expect(finding?.evidence).toEqual({ header: 'Server', value: 'nginx/1.24.0' });
  });

  it('flags an X-Powered-By header', () => {
    const findings = run({ 'x-powered-by': 'Express' });
    expect(findings.find((f) => f.key === 'disclosure:x-powered-by')).toBeDefined();
  });

  it('flags a framework/version indicator header', () => {
    const findings = run({ 'x-aspnet-version': '4.0.30319' });
    expect(findings.find((f) => f.key === 'disclosure:x-aspnet-version')).toBeDefined();
  });

  it('produces no findings when no disclosure headers are present', () => {
    expect(run({})).toHaveLength(0);
  });

  it('never invents technology information not present in the response', () => {
    const findings = run({ 'content-type': 'text/html' });
    expect(findings).toHaveLength(0);
  });
});
