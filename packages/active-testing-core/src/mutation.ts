import type { RequestMutation } from './types.js';

/**
 * Applies one controlled mutation to a baseline URL and returns the mutated
 * URL — pure, no I/O. The result still passes through scope/SSRF validation
 * and SafeHttpClient exactly like any other request (see executor.ts); this
 * function only computes what the mutated URL looks like.
 */
export function applyMutation(baseUrl: URL, mutation: RequestMutation): URL {
  const mutated = new URL(baseUrl.toString());

  if (mutation.kind === 'query-param') {
    mutated.searchParams.set(mutation.name, mutation.value);
    return mutated;
  }

  // path-segment
  const segments = mutated.pathname.split('/');
  // split('/') on a path starting with '/' yields a leading '' element —
  // index 0 is that leading empty segment, so a caller targeting the first
  // real path segment passes index 1, matching how the path visually reads.
  if (mutation.index < 0 || mutation.index >= segments.length) {
    throw new RangeError(
      `Path-segment mutation index ${mutation.index} is out of range for path "${mutated.pathname}"`,
    );
  }
  segments[mutation.index] = mutation.value;
  mutated.pathname = segments.join('/');
  return mutated;
}
