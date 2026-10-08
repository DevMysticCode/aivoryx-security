import { describe, expect, it } from 'vitest';
import { buildActiveTestRegistry } from '@aivoryx/active-testing-core';
import { reflectedXssTest, ACTIVE_TEST_REGISTRY, MAX_PARAMS_PER_URL } from './plugin.js';

describe('reflectedXssTest', () => {
  it('is a valid, registerable active test definition', () => {
    expect(() => buildActiveTestRegistry([reflectedXssTest])).not.toThrow();
  });

  it('is exported as the production registry, exactly one definition', () => {
    expect(ACTIVE_TEST_REGISTRY).toEqual([reflectedXssTest]);
  });

  it('declares SAFE_READ_ONLY safety and GET only', () => {
    expect(reflectedXssTest.safety).toBe('SAFE_READ_ONLY');
    expect(reflectedXssTest.httpMethod).toBe('GET');
  });

  it('only supports WEB assets and WEB assessments', () => {
    expect(reflectedXssTest.supportedAssetTypes).toEqual(['WEB']);
    expect(reflectedXssTest.supportedAssessmentTypes).toEqual(['WEB']);
  });

  // CASE 9 — one mutation per parameter, each independently mutating a single parameter.
  it('generates exactly one mutation per query parameter, each touching only that parameter', () => {
    const mutations = reflectedXssTest.mutations({
      url: 'https://example.com/search?q=hello&page=2',
      method: 'GET',
    });
    expect(mutations).toHaveLength(2);
    const names = mutations.map((m) => (m.kind === 'query-param' ? m.name : null)).sort();
    expect(names).toEqual(['page', 'q']);
    for (const mutation of mutations) {
      expect(mutation.kind).toBe('query-param');
    }
  });

  it('produces zero mutations for a URL with no query parameters', () => {
    expect(reflectedXssTest.mutations({ url: 'https://example.com/about', method: 'GET' })).toEqual(
      [],
    );
  });

  it('skips parameters whose name looks like it holds a credential', () => {
    const mutations = reflectedXssTest.mutations({
      url: 'https://example.com/login?username=bob&password=x&api_key=y&token=z',
      method: 'GET',
    });
    const names = mutations.map((m) => (m.kind === 'query-param' ? m.name : null));
    expect(names).toEqual(['username']);
  });

  // CASE 16 — a huge number of parameters must be bounded.
  it('caps the number of parameters tested per URL at MAX_PARAMS_PER_URL', () => {
    const params = Array.from({ length: 1000 }, (_, i) => `p${i}=x`).join('&');
    const mutations = reflectedXssTest.mutations({
      url: `https://example.com/page?${params}`,
      method: 'GET',
    });
    expect(mutations).toHaveLength(MAX_PARAMS_PER_URL);
  });

  it('each mutation carries its own deterministic canary as its marker', () => {
    const mutations = reflectedXssTest.mutations({
      url: 'https://example.com/search?q=hello',
      method: 'GET',
    });
    const mutation = mutations[0]!;
    expect(mutation.kind).toBe('query-param');
    if (mutation.kind === 'query-param') {
      expect(mutation.markers).toHaveLength(1);
      expect(mutation.value).toContain(mutation.markers![0]);
    }
  });

  it('returns null from classify() when the mutation produced no marker match', () => {
    const mutation = reflectedXssTest.mutations({
      url: 'https://example.com/search?q=hello',
      method: 'GET',
    })[0]!;
    const noopObservation = {
      status: 200,
      headers: {},
      contentType: 'text/html',
      bodyLength: 0,
      bodyHash: '',
      markersFound: [],
      body: '<html></html>',
    };
    const diff = {
      statusChanged: false,
      headersChanged: [],
      contentTypeChanged: false,
      bodyChanged: false,
      bodyLengthDelta: 0,
      markersDetected: [],
    };
    expect(reflectedXssTest.classify(diff, noopObservation, noopObservation, mutation)).toBeNull();
  });
});
