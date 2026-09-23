import { describe, expect, it } from 'vitest';
import { parseRobots } from './robots.js';

describe('parseRobots', () => {
  it('extracts a Sitemap directive', () => {
    const { sitemapUrls } = parseRobots(
      'User-agent: *\nDisallow: /admin\nSitemap: https://example.com/sitemap.xml\n',
    );
    expect(sitemapUrls).toEqual(['https://example.com/sitemap.xml']);
  });

  it('extracts multiple Sitemap directives, case-insensitively', () => {
    const { sitemapUrls } = parseRobots(
      'sitemap: https://example.com/a.xml\nSITEMAP: https://example.com/b.xml\n',
    );
    expect(sitemapUrls).toEqual(['https://example.com/a.xml', 'https://example.com/b.xml']);
  });

  it('ignores Disallow/Allow directives entirely (not a security boundary)', () => {
    const { sitemapUrls } = parseRobots('Disallow: /secret\nAllow: /public\n');
    expect(sitemapUrls).toEqual([]);
  });

  it('handles comments and blank lines without throwing', () => {
    expect(() =>
      parseRobots('# comment\n\nSitemap: https://example.com/sitemap.xml\n# trailing'),
    ).not.toThrow();
  });

  it('never throws on malformed input', () => {
    expect(() => parseRobots('not a valid\nrobots\n\x00\x01 file at all')).not.toThrow();
  });

  it('caps the number of sitemap directives read', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `Sitemap: https://example.com/s${i}.xml`);
    const { sitemapUrls } = parseRobots(lines.join('\n'));
    expect(sitemapUrls.length).toBeLessThanOrEqual(50);
  });

  it('does not treat a robots.txt reference to an out-of-scope sitemap as authorization by itself', () => {
    // parseRobots is pure text extraction — scope enforcement happens at the
    // crawler level (see crawler.test.ts). This test documents that this
    // module has no concept of scope at all, which is intentional.
    const { sitemapUrls } = parseRobots('Sitemap: https://evil.example.net/sitemap.xml\n');
    expect(sitemapUrls).toEqual(['https://evil.example.net/sitemap.xml']);
  });
});
