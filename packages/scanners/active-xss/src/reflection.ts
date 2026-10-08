/** Hard cap on how many occurrences of a marker are even counted — a response that repeats the canary hundreds of times (e.g. an echo-everything debug page) must never turn analysis into an unbounded scan. */
export const MAX_OCCURRENCES = 20;

/** How many characters of raw text to capture on each side of a marker occurrence, for both encoding analysis and bounded evidence snippets. */
const SNIPPET_RADIUS = 80;

/**
 * Finds up to MAX_OCCURRENCES byte-offsets of `marker` in `body` — plain
 * `indexOf` scanning, never a regex, so there is no catastrophic-
 * backtracking risk regardless of what a hostile response contains (Batch 9
 * spec Part 36).
 */
export function findMarkerOccurrences(body: string, marker: string): number[] {
  if (!marker) return [];
  const indices: number[] = [];
  let from = 0;
  while (indices.length < MAX_OCCURRENCES) {
    const index = body.indexOf(marker, from);
    if (index === -1) break;
    indices.push(index);
    from = index + marker.length;
  }
  return indices;
}

/** A small, bounded window of raw text around one marker occurrence — used for both encoding classification and the finding's evidence snippet. Never the whole body. */
export function extractSnippet(body: string, index: number, markerLength: number): string {
  const start = Math.max(0, index - SNIPPET_RADIUS);
  const end = Math.min(body.length, index + markerLength + SNIPPET_RADIUS);
  return body.slice(start, end);
}
