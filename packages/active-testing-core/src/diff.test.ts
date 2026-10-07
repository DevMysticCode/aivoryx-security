import { describe, expect, it } from 'vitest';
import { diffObservations } from './diff.js';
import type { Observation } from './types.js';

function observation(overrides: Partial<Observation> = {}): Observation {
  return {
    status: 200,
    headers: { 'content-type': 'text/html' },
    contentType: 'text/html',
    bodyLength: 100,
    bodyHash: 'abc',
    markersFound: [],
    ...overrides,
  };
}

describe('diffObservations', () => {
  it('reports no differences between identical observations', () => {
    const diff = diffObservations(observation(), observation());
    expect(diff).toEqual({
      statusChanged: false,
      headersChanged: [],
      contentTypeChanged: false,
      bodyChanged: false,
      bodyLengthDelta: 0,
      markersDetected: [],
    });
  });

  it('detects a status code change', () => {
    const diff = diffObservations(observation({ status: 200 }), observation({ status: 500 }));
    expect(diff.statusChanged).toBe(true);
  });

  it('detects changed, added, and removed headers', () => {
    const diff = diffObservations(
      observation({ headers: { a: '1', b: '2' } }),
      observation({ headers: { a: '1', b: '3', c: '4' } }),
    );
    expect(diff.headersChanged.sort()).toEqual(['b', 'c']);
  });

  it('detects a body change via bodyHash and reports the length delta', () => {
    const diff = diffObservations(
      observation({ bodyHash: 'h1', bodyLength: 100 }),
      observation({ bodyHash: 'h2', bodyLength: 140 }),
    );
    expect(diff.bodyChanged).toBe(true);
    expect(diff.bodyLengthDelta).toBe(40);
  });

  it('only reports markers newly present in the mutated response', () => {
    const diff = diffObservations(
      observation({ markersFound: ['already-present'] }),
      observation({ markersFound: ['already-present', 'new-marker'] }),
    );
    expect(diff.markersDetected).toEqual(['new-marker']);
  });
});
