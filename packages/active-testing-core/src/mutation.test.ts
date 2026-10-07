import { describe, expect, it } from 'vitest';
import { applyMutation } from './mutation.js';

describe('applyMutation', () => {
  it('sets a query parameter, overwriting an existing value', () => {
    const result = applyMutation(new URL('https://example.com/search?q=hello'), {
      kind: 'query-param',
      name: 'q',
      value: 'mutated',
    });
    expect(result.searchParams.get('q')).toBe('mutated');
    expect(result.toString()).toBe('https://example.com/search?q=mutated');
  });

  it('adds a query parameter that was not present in the baseline', () => {
    const result = applyMutation(new URL('https://example.com/search'), {
      kind: 'query-param',
      name: 'q',
      value: 'mutated',
    });
    expect(result.searchParams.get('q')).toBe('mutated');
  });

  it('replaces one path segment, leaving the rest of the path intact', () => {
    // '/users/123/profile'.split('/') === ['', 'users', '123', 'profile'] —
    // index 0 is the leading empty segment from the path's leading slash.
    const result = applyMutation(new URL('https://example.com/users/123/profile'), {
      kind: 'path-segment',
      index: 2,
      value: 'mutated',
    });
    expect(result.pathname).toBe('/users/mutated/profile');
  });

  it('never mutates the original URL object', () => {
    const original = new URL('https://example.com/search?q=hello');
    applyMutation(original, { kind: 'query-param', name: 'q', value: 'mutated' });
    expect(original.searchParams.get('q')).toBe('hello');
  });

  it('throws on an out-of-range path-segment index', () => {
    expect(() =>
      applyMutation(new URL('https://example.com/a/b'), {
        kind: 'path-segment',
        index: 99,
        value: 'mutated',
      }),
    ).toThrow(RangeError);
  });
});
