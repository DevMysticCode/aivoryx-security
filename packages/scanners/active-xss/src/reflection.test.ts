import { describe, expect, it } from 'vitest';
import { findMarkerOccurrences, extractSnippet, MAX_OCCURRENCES } from './reflection.js';

describe('findMarkerOccurrences', () => {
  it('returns an empty array when the marker is not present', () => {
    expect(findMarkerOccurrences('<div>hello</div>', 'MARKER')).toEqual([]);
  });

  it('finds a single occurrence', () => {
    const body = '<div>before MARKER after</div>';
    expect(findMarkerOccurrences(body, 'MARKER')).toEqual([body.indexOf('MARKER')]);
  });

  it('finds multiple occurrences in order', () => {
    const body = 'MARKER ... MARKER ... MARKER';
    const indices = findMarkerOccurrences(body, 'MARKER');
    expect(indices).toHaveLength(3);
    expect(indices[0]).toBe(0);
  });

  it('caps at MAX_OCCURRENCES even when the marker repeats far more than that', () => {
    const body = Array.from({ length: MAX_OCCURRENCES + 50 }, () => 'MARKER').join(' ');
    const indices = findMarkerOccurrences(body, 'MARKER');
    expect(indices).toHaveLength(MAX_OCCURRENCES);
  });

  it('returns an empty array for an empty marker, never matching every position', () => {
    expect(findMarkerOccurrences('some text', '')).toEqual([]);
  });
});

describe('extractSnippet', () => {
  it('returns a bounded window around the marker, not the whole body', () => {
    const body = 'x'.repeat(1000) + 'MARKER' + 'y'.repeat(1000);
    const index = body.indexOf('MARKER');
    const snippet = extractSnippet(body, index, 'MARKER'.length);
    expect(snippet.length).toBeLessThan(300);
    expect(snippet).toContain('MARKER');
  });

  it('does not throw when the marker is near the start or end of the body', () => {
    const body = 'MARKERtail';
    expect(() => extractSnippet(body, 0, 'MARKER'.length)).not.toThrow();
  });
});
