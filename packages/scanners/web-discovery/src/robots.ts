// robots.txt parsing (Part 8). Deliberately minimal: we only extract
// `Sitemap:` directives (the one thing this batch actually uses). Disallow/
// Allow rules are NOT enforced — robots.txt is not a security boundary, and
// the assessment's explicit scope is the only authority over what may be
// crawled. A URL a robots.txt "allows" that is outside scope is never
// requested; a URL it "disallows" that IS in scope may still be crawled —
// robots.txt never expands or restricts authorization.

export interface ParsedRobots {
  sitemapUrls: string[];
}

const MAX_SITEMAP_DIRECTIVES = 50;

/** Parses raw robots.txt text. Tolerant of malformed input — never throws. */
export function parseRobots(text: string): ParsedRobots {
  const sitemapUrls: string[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split('#')[0]?.trim() ?? '';
    if (!line) continue;

    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;

    const directive = line.slice(0, colonIndex).trim().toLowerCase();
    const value = line.slice(colonIndex + 1).trim();
    if (directive === 'sitemap' && value && sitemapUrls.length < MAX_SITEMAP_DIRECTIVES) {
      sitemapUrls.push(value);
    }
  }

  return { sitemapUrls };
}
