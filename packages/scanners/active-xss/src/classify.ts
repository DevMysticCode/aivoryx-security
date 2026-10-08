import type { ActiveTestFindingCandidate } from '@aivoryx/active-testing-core';
import { PROBE_CHARS } from './canary.js';
import { findMarkerOccurrences, extractSnippet } from './reflection.js';
import { classifyEncoding, type EncodingClassification } from './encoding.js';
import { analyzeHtmlContext, type ReflectionContextType } from './html-context.js';

const HTML_LIKE_CONTENT_TYPES = ['text/html', 'application/xhtml+xml'];

const OWASP_REFERENCES = [
  'https://owasp.org/www-community/attacks/xss/',
  'https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html',
];

/** A context in which raw, unescaped probe characters are directly executable/structurally dangerous — not merely "present somewhere in HTML". */
const EXECUTABLE_RAW_CONTEXTS = new Set<ReflectionContextType>(['SCRIPT', 'URL_ATTRIBUTE']);

function isHtmlLikeContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  const base = contentType.split(';')[0]?.trim().toLowerCase();
  return base !== undefined && HTML_LIKE_CONTENT_TYPES.includes(base);
}

function contextLabel(contexts: ReflectionContextType[]): string {
  return Array.from(new Set(contexts)).join(', ').toLowerCase();
}

export interface ClassifyReflectedXssInput {
  contentType: string | null;
  body: string;
  marker: string;
  paramName: string;
}

/**
 * The confidence-model decision function for reflected XSS — pure, no I/O.
 * Deliberately conservative: never returns CONFIRMED (this batch never
 * executes JavaScript or demonstrates browser execution — see Batch 9 spec
 * Part 9/18), and returns null entirely for non-HTML-like responses
 * regardless of reflection (Part 11/19) or when nothing was reflected at
 * all. See Part 9 for the exact LOW/MEDIUM/HIGH evidence tiers this
 * implements.
 */
export function classifyReflectedXss(
  input: ClassifyReflectedXssInput,
): ActiveTestFindingCandidate | null {
  if (!isHtmlLikeContentType(input.contentType)) return null;

  const occurrences = findMarkerOccurrences(input.body, input.marker);
  if (occurrences.length === 0) return null;

  const firstSnippet = extractSnippet(input.body, occurrences[0]!, input.marker.length);
  const encoding: EncodingClassification = classifyEncoding(
    firstSnippet,
    input.marker,
    PROBE_CHARS,
  );
  const contexts = analyzeHtmlContext(input.body, input.marker);

  const rawExecutableContext =
    encoding === 'RAW' && contexts.some((c) => EXECUTABLE_RAW_CONTEXTS.has(c));
  const multipleRawOccurrences = encoding === 'RAW' && occurrences.length >= 2;

  let severity: ActiveTestFindingCandidate['severity'];
  let confidence: ActiveTestFindingCandidate['confidence'];
  let qualifier: string;

  if (encoding === 'HTML_ENCODED' || encoding === 'URL_ENCODED' || encoding === 'STRIPPED') {
    severity = 'LOW';
    confidence = 'LOW';
    qualifier =
      encoding === 'STRIPPED'
        ? 'the dangerous characters appear to have been filtered or stripped'
        : 'the dangerous characters appear to have been encoded';
  } else if (rawExecutableContext || multipleRawOccurrences) {
    severity = 'HIGH';
    confidence = 'HIGH';
    qualifier = 'the dangerous characters were reflected completely unescaped';
  } else {
    severity = 'MEDIUM';
    confidence = 'MEDIUM';
    qualifier = 'the dangerous characters were reflected unescaped';
  }

  const snippetForEvidence = firstSnippet.slice(0, 160);

  return {
    title:
      severity === 'HIGH'
        ? 'High-confidence reflected cross-site scripting (XSS)'
        : severity === 'MEDIUM'
          ? 'Potential reflected cross-site scripting (XSS)'
          : 'Reflected input detected (encoded/filtered)',
    description:
      `The query parameter "${input.paramName}" reflects attacker-controlled input back into the ` +
      `response (content type: ${input.contentType ?? 'unknown'}), and ${qualifier}. ` +
      `Reflection context: ${contextLabel(contexts)}. Occurrences observed: ${occurrences.length}. ` +
      `See the affected URL above. This does not demonstrate actual JavaScript execution in a ` +
      `browser — no browser was used — but the evidence indicates the response structure ` +
      `attacker-controlled input could influence.`,
    severity,
    confidence,
    key: `reflected-xss:${input.paramName}`,
    remediation:
      'Apply context-aware output encoding to this parameter wherever it is reflected ' +
      '(HTML-entity encode for HTML text/attribute contexts, JavaScript-string escape for script ' +
      'contexts, URL-encode for URL contexts) or use a templating engine that encodes by default. ' +
      'Validate/allow-list input where practical. A Content-Security-Policy is useful defense-in-depth ' +
      'but does not replace proper output encoding.',
    references: OWASP_REFERENCES,
    evidence: {
      parameter: input.paramName,
      contentType: input.contentType,
      encoding,
      contexts: Array.from(new Set(contexts)),
      occurrenceCount: occurrences.length,
      // A bounded snippet of raw response text around the first reflection
      // — never the full body. Subject to the same redaction/size-cap as
      // any other evidence (sanitizeEvidence in assessment-processor.ts).
      responseSnippet: snippetForEvidence,
    },
  };
}
