import { describe, expect, it } from 'vitest';
import {
  createPassiveCheckRegistry,
  runPassiveChecks,
  type PassiveCheck,
} from './passive-check.js';

interface FakeObservation {
  value: number;
}

function makeCheck(name: string, findingCount: number): PassiveCheck<FakeObservation> {
  return {
    name,
    category: 'test',
    run: (observation) =>
      Array.from({ length: findingCount }, (_, i) => ({
        title: `${name}-${i}`,
        description: 'test',
        severity: 'INFO' as const,
        confidence: 'HIGH' as const,
        category: 'test',
        key: `${name}-${i}`,
        target: `value:${observation.value}`,
      })),
  };
}

describe('createPassiveCheckRegistry', () => {
  it('accepts a set of checks with unique names', () => {
    expect(() => createPassiveCheckRegistry([makeCheck('a', 0), makeCheck('b', 0)])).not.toThrow();
  });

  it('rejects duplicate check names', () => {
    expect(() => createPassiveCheckRegistry([makeCheck('a', 0), makeCheck('a', 0)])).toThrow(
      /Duplicate passive check name/,
    );
  });
});

describe('runPassiveChecks', () => {
  it('concatenates findings from every check', () => {
    const registry = createPassiveCheckRegistry([makeCheck('a', 2), makeCheck('b', 1)]);
    const findings = runPassiveChecks(registry, { value: 1 }, { target: 'x', assetType: 'WEB' });
    expect(findings).toHaveLength(3);
  });

  it('runs every check against the same observation object (no mutation, no extra calls)', () => {
    let callCount = 0;
    const observation = { value: 42 };
    const check: PassiveCheck<FakeObservation> = {
      name: 'counter',
      category: 'test',
      run: (obs) => {
        callCount += 1;
        expect(obs).toBe(observation);
        return [];
      },
    };
    runPassiveChecks([check], observation, { target: 'x', assetType: 'WEB' });
    expect(callCount).toBe(1);
  });

  it('collects errors from failing checks without dropping other checks’ findings, then throws', () => {
    const broken: PassiveCheck<FakeObservation> = {
      name: 'broken',
      category: 'test',
      run: () => {
        throw new Error('boom');
      },
    };
    const registry = [makeCheck('a', 1), broken];
    expect(() =>
      runPassiveChecks(registry, { value: 1 }, { target: 'x', assetType: 'WEB' }),
    ).toThrow(/broken: boom/);
  });
});
