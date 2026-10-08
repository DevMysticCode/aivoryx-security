import { Parser } from 'htmlparser2';

export type ReflectionContextType =
  'TEXT' | 'ATTRIBUTE' | 'URL_ATTRIBUTE' | 'SCRIPT' | 'STYLE' | 'COMMENT' | 'UNKNOWN';

const URL_ATTRIBUTE_NAMES = new Set(['href', 'src', 'action', 'formaction']);

/** Bounds how many context occurrences are even recorded — same rationale as reflection.ts's MAX_OCCURRENCES. */
const MAX_CONTEXTS = 20;

/**
 * Classifies, for each occurrence of `marker`, which HTML context it landed
 * in — using the same tolerant, already-proven htmlparser2 SAX parser
 * web-discovery's html-extract.ts uses (never throws on malformed markup,
 * recovers and keeps parsing). A single forward pass over the document,
 * tracking the open-tag stack, so "inside <script>" / "inside <style>" is
 * correctly detected even through nesting. Response content has already
 * been treated as hostile/untrusted input by this point (SafeHttpClient
 * bounds its size); this function never throws regardless of what the
 * target sends back (Batch 9 spec Parts 18/35/36).
 */
export function analyzeHtmlContext(body: string, marker: string): ReflectionContextType[] {
  if (!marker) return [];
  const contexts: ReflectionContextType[] = [];
  const tagStack: string[] = [];

  const currentTextContext = (): ReflectionContextType => {
    const top = tagStack[tagStack.length - 1];
    if (top === 'script') return 'SCRIPT';
    if (top === 'style') return 'STYLE';
    return 'TEXT';
  };

  try {
    const parser = new Parser(
      {
        onopentag(name, attribs) {
          tagStack.push(name.toLowerCase());
          for (const [attrName, attrValue] of Object.entries(attribs)) {
            if (contexts.length >= MAX_CONTEXTS) break;
            if (attrValue.includes(marker)) {
              contexts.push(
                URL_ATTRIBUTE_NAMES.has(attrName.toLowerCase()) ? 'URL_ATTRIBUTE' : 'ATTRIBUTE',
              );
            }
          }
        },
        onclosetag() {
          tagStack.pop();
        },
        ontext(text) {
          if (contexts.length >= MAX_CONTEXTS) return;
          if (text.includes(marker)) contexts.push(currentTextContext());
        },
        oncomment(text) {
          if (contexts.length >= MAX_CONTEXTS) return;
          if (text.includes(marker)) contexts.push('COMMENT');
        },
      },
      { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true },
    );
    parser.write(body);
    parser.end();
  } catch {
    // htmlparser2 does not throw on malformed markup in practice, but if
    // parsing fails for any reason, fail safe — report whatever was found
    // so far, or UNKNOWN, rather than crash the scan.
  }

  return contexts.length > 0 ? contexts : ['UNKNOWN'];
}
