import type { ActiveTestDefinition, RequestMutation } from '@aivoryx/active-testing-core';
import { generateCanary } from './canary.js';
import { classifyReflectedXss } from './classify.js';

/** How many query parameters of one URL get tested — bounded so a page with hundreds of parameters can't turn one assessment into unbounded traffic. Local to this scanner, same precedent as web-discovery's DEFAULT_CRAWL_LIMITS. */
export const MAX_PARAMS_PER_URL = 5;

/** Parameter names that look like they hold credentials — skipped entirely. Testing XSS against a password/token field is semantically confusing and these reduce signal, not add it. Same pattern apps/worker/src/assessment-processor.ts uses for evidence redaction. */
const SENSITIVE_PARAM_NAME = /(secret|password|token|api[_-]?key|credential|authorization|cookie)/i;

function queryParamNames(url: string): string[] {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return [];
  }
  const names = Array.from(new Set(parsed.searchParams.keys()));
  return names.filter((name) => !SENSITIVE_PARAM_NAME.test(name)).slice(0, MAX_PARAMS_PER_URL);
}

/**
 * Batch 9's first real active test: safe, GET-only, query-parameter
 * reflected-XSS detection. One combined canary+probe payload per
 * parameter (see canary.ts) — one request per parameter, no separate
 * conditional probe round-trip. Path-segment testing is deliberately
 * deferred (see Batch 9 plan) — query parameters are the well-established,
 * high-value reflected-XSS vector, and path-segment mutation usually
 * changes routing rather than hitting an injectable value.
 */
export const reflectedXssTest: ActiveTestDefinition = {
  id: 'WEB-REFLECTED-XSS',
  name: 'Reflected Cross-Site Scripting (query parameters)',
  description:
    'Tests each query parameter of a discovered page independently with a deterministic canary ' +
    'to detect whether attacker-controlled input is reflected into the response in a way that ' +
    'suggests potential reflected XSS. GET-only, one parameter mutated per request.',
  category: 'active-test-xss',
  potentialSeverity: 'HIGH',
  supportedAssetTypes: ['WEB'],
  supportedAssessmentTypes: ['WEB'],
  safety: 'SAFE_READ_ONLY',
  httpMethod: 'GET',
  requiredCapabilities: ['http-egress'],
  requiresAuthContext: false,
  // 1 baseline (accounted for separately by the executor) + up to
  // MAX_PARAMS_PER_URL mutation requests.
  requestBudgetEstimate: 1 + MAX_PARAMS_PER_URL,
  version: '1.0.0',
  markers: [],

  mutations(baseline) {
    return queryParamNames(baseline.url).map((name): RequestMutation => {
      const canary = generateCanary(baseline.url, name);
      return { kind: 'query-param', name, value: canary.payload, markers: [canary.marker] };
    });
  },

  classify(diff, _baseline, mutated, mutation) {
    // Cheap check first: if the canary itself wasn't found at all, there is
    // nothing to analyze — skip the (comparatively expensive) HTML parsing
    // pass entirely. See Batch 9 spec Part 36.
    if (diff.markersDetected.length === 0) return null;
    if (mutation.kind !== 'query-param') return null;

    const marker = mutation.markers?.[0];
    if (!marker) return null;

    return classifyReflectedXss({
      contentType: mutated.contentType,
      body: mutated.body,
      marker,
      paramName: mutation.name,
    });
  },
};

export const ACTIVE_TEST_REGISTRY = [reflectedXssTest];
