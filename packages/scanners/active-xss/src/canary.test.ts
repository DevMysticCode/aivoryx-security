import { describe, expect, it } from 'vitest';
import { generateCanary, PROBE_CHARS } from './canary.js';

describe('generateCanary', () => {
  it('is deterministic — same url+param always produces the same canary', () => {
    const a = generateCanary('https://example.com/search', 'q');
    const b = generateCanary('https://example.com/search', 'q');
    expect(a).toEqual(b);
  });

  it('differs by parameter name for the same URL', () => {
    const q = generateCanary('https://example.com/search', 'q');
    const page = generateCanary('https://example.com/search', 'page');
    expect(q.marker).not.toBe(page.marker);
  });

  it('differs by URL for the same parameter name', () => {
    const a = generateCanary('https://example.com/search', 'q');
    const b = generateCanary('https://example.com/other', 'q');
    expect(a.marker).not.toBe(b.marker);
  });

  it('the marker is alphanumeric only — survives HTML/URL-encoding unchanged', () => {
    const { marker } = generateCanary('https://example.com/search', 'q');
    expect(marker).toMatch(/^[a-zA-Z0-9]+$/);
  });

  it('the payload is the marker followed by the probe characters, bounded in length', () => {
    const { marker, payload } = generateCanary('https://example.com/search', 'q');
    expect(payload).toBe(`${marker}${PROBE_CHARS}`);
    expect(payload.length).toBeLessThan(40);
  });

  it('never uses a <script>alert(...)</script>-style payload', () => {
    const { payload } = generateCanary('https://example.com/search', 'q');
    expect(payload.toLowerCase()).not.toContain('script');
    expect(payload.toLowerCase()).not.toContain('alert');
  });

  it('is ASCII-safe', () => {
    const { payload } = generateCanary('https://example.com/search', 'q');
    expect(/^[\x20-\x7e]+$/.test(payload)).toBe(true);
  });
});
