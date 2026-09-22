import { describe, expect, it } from 'vitest';
import { computeFindingFingerprint } from './fingerprint.js';

describe('computeFindingFingerprint', () => {
  const base = {
    assessmentId: 'a1',
    scanner: 'http-reachability',
    category: 'reachability',
    target: 'https://Example.com/',
    key: 'reachable',
  };

  it('is deterministic for identical input', () => {
    expect(computeFindingFingerprint(base)).toBe(computeFindingFingerprint(base));
  });

  it('normalizes trivially-equivalent target URLs to the same fingerprint', () => {
    const a = computeFindingFingerprint({ ...base, target: 'https://example.com/' });
    const b = computeFindingFingerprint({ ...base, target: 'https://EXAMPLE.com:443/' });
    expect(a).toBe(b);
  });

  it('differs when the assessment differs', () => {
    expect(computeFindingFingerprint(base)).not.toBe(
      computeFindingFingerprint({ ...base, assessmentId: 'a2' }),
    );
  });

  it('differs when the key differs', () => {
    expect(computeFindingFingerprint(base)).not.toBe(
      computeFindingFingerprint({ ...base, key: 'unreachable' }),
    );
  });

  it('is a stable-looking hex digest, not derived from response bodies', () => {
    expect(computeFindingFingerprint(base)).toMatch(/^[0-9a-f]{64}$/);
  });
});
