import { describe, expect, it } from 'vitest';
import { classifyReflectedXss } from './classify.js';
import { generateCanary, PROBE_CHARS } from './canary.js';

const { marker, payload } = generateCanary('https://example.com/search', 'q');

describe('classifyReflectedXss', () => {
  // CASE 1 — no reflection.
  it('reports nothing when the canary is not reflected at all', () => {
    const result = classifyReflectedXss({
      contentType: 'text/html',
      body: '<html><body>no match here</body></html>',
      marker,
      paramName: 'q',
    });
    expect(result).toBeNull();
  });

  // CASE 2 — plain HTML reflection with the probe characters raw in TEXT context.
  it('classifies raw reflection in plain HTML text as MEDIUM, not HIGH — conservative, evidence-based', () => {
    const result = classifyReflectedXss({
      contentType: 'text/html',
      body: `<div>${payload}</div>`,
      marker,
      paramName: 'q',
    });
    expect(result).not.toBeNull();
    expect(result!.severity).toBe('MEDIUM');
    expect(result!.confidence).toBe('MEDIUM');
  });

  // CASE 3 — HTML-encoded reflection.
  it('does not report high-confidence XSS when the dangerous characters are HTML-encoded', () => {
    const result = classifyReflectedXss({
      contentType: 'text/html',
      body: `<div>${marker}&lt;&quot;&#39;&gt;</div>`,
      marker,
      paramName: 'q',
    });
    expect(result).not.toBeNull();
    expect(result!.severity).toBe('LOW');
    expect(result!.confidence).toBe('LOW');
  });

  // CASE 4 — attribute reflection.
  it('correctly identifies attribute context and classifies it evidence-based (MEDIUM, raw)', () => {
    const result = classifyReflectedXss({
      contentType: 'text/html',
      body: `<input value="${payload}">`,
      marker,
      paramName: 'q',
    });
    expect(result).not.toBeNull();
    expect(result!.evidence!.contexts).toContain('ATTRIBUTE');
    expect(result!.severity).toBe('MEDIUM');
  });

  // CASE 5 — script-context reflection.
  it('classifies raw reflection inside a <script> block as HIGH', () => {
    const result = classifyReflectedXss({
      contentType: 'text/html',
      body: `<script>const value = "${payload}";</script>`,
      marker,
      paramName: 'q',
    });
    expect(result).not.toBeNull();
    expect(result!.severity).toBe('HIGH');
    expect(result!.confidence).toBe('HIGH');
  });

  // CASE 6 — JSON reflection: no finding merely because reflection exists.
  it('reports nothing for a JSON response even when the canary is reflected verbatim', () => {
    const result = classifyReflectedXss({
      contentType: 'application/json',
      body: JSON.stringify({ q: payload }),
      marker,
      paramName: 'q',
    });
    expect(result).toBeNull();
  });

  // CASE 7 — text/plain reflection.
  it('reports nothing for a text/plain response', () => {
    const result = classifyReflectedXss({
      contentType: 'text/plain',
      body: `you searched for: ${payload}`,
      marker,
      paramName: 'q',
    });
    expect(result).toBeNull();
  });

  // CASE 8 — transformed/normalized reflection.
  it('classifies a stripped/transformed reflection as LOW, not suppressed entirely', () => {
    const result = classifyReflectedXss({
      contentType: 'text/html',
      body: `<div>${marker}</div>`, // probe characters never arrived at all
      marker,
      paramName: 'q',
    });
    expect(result).not.toBeNull();
    expect(result!.severity).toBe('LOW');
  });

  // CASE 17 — sensitive response content elsewhere on the page must not leak
  // into evidence merely because the page is large — the snippet is bounded
  // to a small window around the reflection, not the whole body.
  it('never includes distant page content in evidence — only a bounded snippet around the reflection', () => {
    const secretFarAway = 'Authorization: Bearer super-secret-token-xyz'.repeat(100);
    const result = classifyReflectedXss({
      contentType: 'text/html',
      // Far enough past the snippet's bounded radius that it cannot appear.
      body: `<div>${payload}</div>${'x'.repeat(500)}${secretFarAway}`,
      marker,
      paramName: 'q',
    });
    expect(result).not.toBeNull();
    const snippet = result!.evidence!.responseSnippet as string;
    expect(snippet.length).toBeLessThan(300);
    expect(snippet).not.toContain('super-secret-token-xyz');
  });

  // CASE 18 — malformed HTML must classify conservatively, never throw.
  it('does not throw on malformed/unclosed HTML and still produces a reasonable classification', () => {
    expect(() =>
      classifyReflectedXss({
        contentType: 'text/html',
        body: `<div><span>${payload}<div><p>unclosed`,
        marker,
        paramName: 'q',
      }),
    ).not.toThrow();
  });

  // CASE 19 — non-HTML response with reflected canary: no false finding, generalized beyond JSON/text-plain.
  it('reports nothing for an unrecognized/non-HTML content type', () => {
    const result = classifyReflectedXss({
      contentType: 'application/octet-stream',
      body: payload,
      marker,
      paramName: 'q',
    });
    expect(result).toBeNull();
  });

  it('is deterministic — classifying the same inputs twice produces the same severity/confidence/key (stable fingerprint)', () => {
    const body = `<script>var x = "${payload}";</script>`;
    const first = classifyReflectedXss({ contentType: 'text/html', body, marker, paramName: 'q' });
    const second = classifyReflectedXss({ contentType: 'text/html', body, marker, paramName: 'q' });
    expect(first!.key).toBe(second!.key);
    expect(first!.severity).toBe(second!.severity);
    expect(first!.confidence).toBe(second!.confidence);
  });

  it('never returns CONFIRMED confidence — this batch never demonstrates browser execution', () => {
    const body = `<script>var x = "${payload}";</script>`;
    const result = classifyReflectedXss({ contentType: 'text/html', body, marker, paramName: 'q' });
    expect(result!.confidence).not.toBe('CONFIRMED');
  });

  it('the finding key incorporates the parameter name, so different parameters fingerprint distinctly', () => {
    const body = `<div>${payload}</div>`;
    const forQ = classifyReflectedXss({ contentType: 'text/html', body, marker, paramName: 'q' });
    const forPage = classifyReflectedXss({
      contentType: 'text/html',
      body,
      marker,
      paramName: 'page',
    });
    expect(forQ!.key).not.toBe(forPage!.key);
  });

  it('escalates to HIGH when the same raw reflection occurs multiple independent times', () => {
    const body = `<div>${payload}</div><div>${payload}</div>`;
    const result = classifyReflectedXss({ contentType: 'text/html', body, marker, paramName: 'q' });
    expect(result!.severity).toBe('HIGH');
  });

  it('treats text/html with a charset suffix as HTML-like', () => {
    const result = classifyReflectedXss({
      contentType: 'text/html; charset=utf-8',
      body: `<div>${payload}</div>`,
      marker,
      paramName: 'q',
    });
    expect(result).not.toBeNull();
  });

  it('PROBE_CHARS contains the four syntactically significant characters the spec calls out', () => {
    expect(PROBE_CHARS).toContain('<');
    expect(PROBE_CHARS).toContain('>');
    expect(PROBE_CHARS).toContain('"');
    expect(PROBE_CHARS).toContain("'");
  });
});
