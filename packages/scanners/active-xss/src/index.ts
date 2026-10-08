export { generateCanary, PROBE_CHARS } from './canary.js';
export type { Canary } from './canary.js';

export { findMarkerOccurrences, extractSnippet, MAX_OCCURRENCES } from './reflection.js';

export { classifyEncoding } from './encoding.js';
export type { EncodingClassification } from './encoding.js';

export { analyzeHtmlContext } from './html-context.js';
export type { ReflectionContextType } from './html-context.js';

export { classifyReflectedXss } from './classify.js';
export type { ClassifyReflectedXssInput } from './classify.js';

export { reflectedXssTest, ACTIVE_TEST_REGISTRY, MAX_PARAMS_PER_URL } from './plugin.js';
