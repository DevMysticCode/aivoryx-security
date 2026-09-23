import { Parser } from 'htmlparser2';
import type { DiscoveredForm, DiscoveredFormInput, HtmlExtractionResult } from './types.js';

// Navigational: these ARE candidate pages to crawl further (Part 5).
const NAVIGATIONAL_TAGS: Record<string, string> = {
  a: 'href',
  area: 'href',
  link: 'href',
  iframe: 'src',
  frame: 'src',
};

// Embedded/resource references: recorded as discovered but never parsed for
// further links or crawled recursively (Part 5 — "Do not treat every
// resource as a page to crawl recursively").
const RESOURCE_TAGS: Record<string, string> = {
  script: 'src',
  img: 'src',
  source: 'src',
  video: 'src',
  audio: 'src',
  object: 'data',
};

interface FormBuilder {
  action: string | null;
  method: string;
  inputs: DiscoveredFormInput[];
  textareas: string[];
  selects: string[];
}

/**
 * Extracts navigational links, resource references, and form metadata from
 * one HTML document. Uses a tolerant SAX-style parser (htmlparser2) —
 * malformed HTML never throws, it's just parsed best-effort. Never executes
 * script content; `<script src>` is recorded as a resource reference only,
 * the referenced file is never fetched or parsed. See Part 7.
 */
export function extractFromHtml(html: string, maxLinksPerPage: number): HtmlExtractionResult {
  const navigational: string[] = [];
  const resources: string[] = [];
  const forms: DiscoveredForm[] = [];
  let currentForm: FormBuilder | null = null;
  let linksExtracted = 0;

  const pushIfRoom = (list: string[], value: string) => {
    if (linksExtracted >= maxLinksPerPage) return;
    list.push(value);
    linksExtracted += 1;
  };

  const parser = new Parser(
    {
      onopentag(name, attribs) {
        const tag = name.toLowerCase();

        if (tag === 'form') {
          currentForm = {
            action: attribs.action ?? null,
            method: (attribs.method ?? 'GET').toUpperCase(),
            inputs: [],
            textareas: [],
            selects: [],
          };
          return;
        }

        if (currentForm) {
          if (tag === 'input') {
            const name2 = attribs.name;
            if (name2) currentForm.inputs.push({ name: name2, type: attribs.type ?? 'text' });
            return;
          }
          if (tag === 'textarea') {
            if (attribs.name) currentForm.textareas.push(attribs.name);
            return;
          }
          if (tag === 'select') {
            if (attribs.name) currentForm.selects.push(attribs.name);
            return;
          }
          if (tag === 'button') {
            if (attribs.name) currentForm.inputs.push({ name: attribs.name, type: 'submit' });
            return;
          }
        }

        const navAttr = NAVIGATIONAL_TAGS[tag];
        if (navAttr && attribs[navAttr]) {
          pushIfRoom(navigational, attribs[navAttr]);
          return;
        }

        const resAttr = RESOURCE_TAGS[tag];
        if (resAttr && attribs[resAttr]) {
          pushIfRoom(resources, attribs[resAttr]);
        }
      },
      onclosetag(name) {
        if (name.toLowerCase() === 'form' && currentForm) {
          const built = currentForm;
          currentForm = null;
          // A form with no `action` attribute submits to the current page —
          // '' resolves to exactly that when the caller joins it against the page URL.
          forms.push({
            actionUrl: built.action ?? '',
            method: built.method,
            sourceUrl: '', // filled in by the caller, which knows the page URL
            inputs: built.inputs,
            textareas: built.textareas,
            selects: built.selects,
          });
        }
      },
    },
    { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true },
  );

  // htmlparser2 never throws on malformed markup — it recovers and keeps parsing.
  parser.write(html);
  parser.end();

  return { navigational, resources, forms };
}
