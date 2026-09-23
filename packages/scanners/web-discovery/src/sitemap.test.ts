import { describe, expect, it } from 'vitest';
import { parseSitemap } from './sitemap.js';

describe('parseSitemap', () => {
  it('extracts loc entries', () => {
    const xml = `<?xml version="1.0"?>
      <urlset>
        <url><loc>https://example.com/a</loc></url>
        <url><loc>https://example.com/b</loc></url>
      </urlset>`;
    expect(parseSitemap(xml, 100)).toEqual(['https://example.com/a', 'https://example.com/b']);
  });

  it('trims whitespace inside loc', () => {
    const xml = '<urlset><url><loc>  https://example.com/a  </loc></url></urlset>';
    expect(parseSitemap(xml, 100)).toEqual(['https://example.com/a']);
  });

  it('never throws on malformed XML', () => {
    expect(() => parseSitemap('<urlset><url><loc>unterminated', 100)).not.toThrow();
    expect(() => parseSitemap('not xml at all \x00\x01', 100)).not.toThrow();
  });

  it('ignores empty loc entries', () => {
    const xml =
      '<urlset><url><loc></loc></url><url><loc>https://example.com/a</loc></url></urlset>';
    expect(parseSitemap(xml, 100)).toEqual(['https://example.com/a']);
  });

  it('enforces a maximum URL count (oversized sitemap protection)', () => {
    const urls = Array.from(
      { length: 1000 },
      (_, i) => `<url><loc>https://example.com/${i}</loc></url>`,
    );
    const xml = `<urlset>${urls.join('')}</urlset>`;
    expect(parseSitemap(xml, 10)).toHaveLength(10);
  });
});
