import { describe, expect, it } from 'vitest';
import { analyzeHtmlContext } from './html-context.js';

const MARKER = 'aivoryxXSSabcd1234';

describe('analyzeHtmlContext', () => {
  it('classifies plain HTML text context', () => {
    expect(analyzeHtmlContext(`<div>${MARKER}</div>`, MARKER)).toEqual(['TEXT']);
  });

  it('classifies HTML attribute-value context', () => {
    expect(analyzeHtmlContext(`<input value="${MARKER}">`, MARKER)).toEqual(['ATTRIBUTE']);
  });

  it('classifies a URL-relevant attribute (href/src/action/formaction) distinctly', () => {
    expect(analyzeHtmlContext(`<a href="${MARKER}">link</a>`, MARKER)).toEqual(['URL_ATTRIBUTE']);
  });

  it('classifies <script> block context', () => {
    expect(analyzeHtmlContext(`<script>const value = "${MARKER}";</script>`, MARKER)).toEqual([
      'SCRIPT',
    ]);
  });

  it('classifies <style> block context', () => {
    expect(
      analyzeHtmlContext(`<style>.x::before { content: "${MARKER}"; }</style>`, MARKER),
    ).toEqual(['STYLE']);
  });

  it('classifies HTML comment context', () => {
    expect(analyzeHtmlContext(`<!-- ${MARKER} -->`, MARKER)).toEqual(['COMMENT']);
  });

  it('returns UNKNOWN when the marker is not found anywhere', () => {
    expect(analyzeHtmlContext('<div>nothing here</div>', MARKER)).toEqual(['UNKNOWN']);
  });

  it('returns an empty array for an empty marker', () => {
    expect(analyzeHtmlContext('<div>x</div>', '')).toEqual([]);
  });

  it('records a context for every occurrence, not just the first', () => {
    const body = `<div>${MARKER}</div><script>"${MARKER}"</script>`;
    const contexts = analyzeHtmlContext(body, MARKER);
    expect(contexts).toEqual(['TEXT', 'SCRIPT']);
  });

  it('does not throw and fails safe on malformed/unclosed HTML', () => {
    const malformed = `<div><span>${MARKER}<div><p>unclosed`;
    expect(() => analyzeHtmlContext(malformed, MARKER)).not.toThrow();
    expect(analyzeHtmlContext(malformed, MARKER).length).toBeGreaterThan(0);
  });

  it('remains bounded on a huge response body (performance/resource-exhaustion safety)', () => {
    const huge = '<div>filler</div>'.repeat(200_000) + `<div>${MARKER}</div>`;
    const start = Date.now();
    const contexts = analyzeHtmlContext(huge, MARKER);
    expect(Date.now() - start).toBeLessThan(5000);
    expect(contexts).toEqual(['TEXT']);
  });
});
