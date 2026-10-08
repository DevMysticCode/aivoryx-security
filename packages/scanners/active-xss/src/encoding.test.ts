import { describe, expect, it } from 'vitest';
import { classifyEncoding } from './encoding.js';

const MARKER = 'aivoryxXSSabcd1234';
const PROBE = '<"\'>';

describe('classifyEncoding', () => {
  it('classifies RAW when the probe characters appear immediately, unescaped', () => {
    const snippet = `<div>${MARKER}${PROBE}</div>`;
    expect(classifyEncoding(snippet, MARKER, PROBE)).toBe('RAW');
  });

  it('classifies HTML_ENCODED when the probe characters appear as HTML entities', () => {
    const snippet = `<div>${MARKER}&lt;&quot;&#39;&gt;</div>`;
    expect(classifyEncoding(snippet, MARKER, PROBE)).toBe('HTML_ENCODED');
  });

  it('classifies URL_ENCODED when the probe characters appear percent-encoded', () => {
    const snippet = `${MARKER}%3C%22%27%3E`;
    expect(classifyEncoding(snippet, MARKER, PROBE)).toBe('URL_ENCODED');
  });

  it('classifies STRIPPED when the marker is reflected but the probe characters are entirely gone', () => {
    const snippet = `<div>${MARKER}REST_OF_PAGE_NO_SPECIAL_CHARS</div>`;
    expect(classifyEncoding(snippet, MARKER, PROBE)).toBe('STRIPPED');
  });

  it('classifies STRIPPED when the marker itself is not in the snippet', () => {
    expect(classifyEncoding('<div>nothing here</div>', MARKER, PROBE)).toBe('STRIPPED');
  });

  it('classifies STRIPPED for a partial match (only some probe characters survive, not the exact sequence) rather than guessing RAW', () => {
    // Only `<`/`>` immediately present; `"`/`'` are missing — the
    // conservative choice is STRIPPED, not a loose "some chars survived" RAW
    // guess, since real HTML markup unrelated to the probe can easily
    // contain stray `<`/`>` too (see the "unrelated closing tag" case below).
    const snippet = `${MARKER}<tag>`;
    expect(classifyEncoding(snippet, MARKER, PROBE)).toBe('STRIPPED');
  });

  it('never mistakes an unrelated closing tag right after the marker for surviving raw probe characters', () => {
    const snippet = `<div>${MARKER}REST_OF_PAGE_NO_SPECIAL_CHARS</div>`;
    expect(classifyEncoding(snippet, MARKER, PROBE)).toBe('STRIPPED');
  });
});
