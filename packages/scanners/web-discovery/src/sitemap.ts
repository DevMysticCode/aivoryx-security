import { Parser } from 'htmlparser2';

// sitemap.xml parsing (Part 9). Minimal on purpose: only `<loc>` extraction,
// no sitemap-index recursion (a sitemap referencing further sitemaps is not
// followed in this batch — that would reopen the "recursive sitemap abuse"
// risk the spec explicitly calls out). Oversized files are already bounded
// by SafeHttpClient's maxResponseBytes on the fetch itself; `maxUrls` here
// additionally bounds how many <loc> entries are read out of a (still
// size-limited) response, so a sitemap that is technically small but lists
// an enormous number of URLs can't blow out the crawl queue.

/** Extracts `<loc>` URLs from sitemap XML, tolerant of malformed markup, capped at `maxUrls`. */
export function parseSitemap(xml: string, maxUrls: number): string[] {
  const locs: string[] = [];
  let inLoc = false;
  let currentText = '';

  const parser = new Parser(
    {
      onopentag(name) {
        if (name.toLowerCase() === 'loc') {
          inLoc = true;
          currentText = '';
        }
      },
      ontext(text) {
        if (inLoc) currentText += text;
      },
      onclosetag(name) {
        if (name.toLowerCase() === 'loc') {
          inLoc = false;
          const value = currentText.trim();
          if (value && locs.length < maxUrls) locs.push(value);
          currentText = '';
        }
      },
    },
    { xmlMode: true, decodeEntities: true },
  );

  parser.write(xml);
  parser.end();

  return locs;
}
