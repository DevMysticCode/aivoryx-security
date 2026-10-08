export type EncodingClassification = 'RAW' | 'HTML_ENCODED' | 'URL_ENCODED' | 'STRIPPED';

/** Common encoded representations of each probe character, checked immediately after the marker, in order. Plain substring checks only — no regex. */
const HTML_ENTITY_FORMS: Record<string, string[]> = {
  '<': ['&lt;'],
  '>': ['&gt;'],
  '"': ['&quot;', '&#34;', '&#x22;'],
  "'": ['&#39;', '&#x27;', '&apos;'],
};
const URL_ENCODED_FORMS: Record<string, string[]> = {
  '<': ['%3C', '%3c'],
  '>': ['%3E', '%3e'],
  '"': ['%22'],
  "'": ['%27'],
};

/** Greedily consumes one of `forms` starting at exactly `pos` — never scans ahead, so unrelated text further along can never be mistaken for a match. */
function tryConsume(
  text: string,
  pos: number,
  forms: readonly string[],
): { matched: boolean; next: number } {
  for (const form of forms) {
    if (text.startsWith(form, pos)) return { matched: true, next: pos + form.length };
  }
  return { matched: false, next: pos };
}

function allCharsConsumable(
  text: string,
  chars: readonly string[],
  formsByChar: Record<string, string[]>,
): boolean {
  let pos = 0;
  for (const char of chars) {
    const result = tryConsume(text, pos, formsByChar[char] ?? []);
    if (!result.matched) return false;
    pos = result.next;
  }
  return true;
}

/**
 * Classifies what happened to PROBE_CHARS (see canary.ts) at the exact
 * position immediately following one marker occurrence. Deliberately only
 * ever looks at text starting AT that exact position, matched strictly in
 * order with no gap and no look-ahead past a failed match — this is what
 * makes the classification immune to unrelated markup appearing later in
 * the snippet (e.g. a closing `</div>` a few characters further on) being
 * mistaken for surviving probe characters. No regex. When neither the raw
 * nor any recognized encoded form matches exactly, the result is STRIPPED
 * — the conservative default per Batch 9 spec Part 10 ("prefer reducing
 * false positives over aggressively declaring vulnerabilities").
 */
export function classifyEncoding(
  snippet: string,
  marker: string,
  probeChars: string,
): EncodingClassification {
  const markerIndex = snippet.indexOf(marker);
  if (markerIndex === -1) return 'STRIPPED';
  const after = snippet.slice(markerIndex + marker.length);

  if (after.startsWith(probeChars)) return 'RAW';

  const chars = Array.from(probeChars);
  if (allCharsConsumable(after, chars, HTML_ENTITY_FORMS)) return 'HTML_ENCODED';
  if (allCharsConsumable(after, chars, URL_ENCODED_FORMS)) return 'URL_ENCODED';

  return 'STRIPPED';
}
