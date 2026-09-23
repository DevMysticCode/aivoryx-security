export { checkIpAgainstSsrfPolicy, isValidIpAddress } from './ssrf.js';
export type { SsrfCheckResult } from './ssrf.js';

export { checkUrlAgainstScope, requireUrlInScope } from './scope.js';
export type { ScopeCheckResult } from './scope.js';

export { resolveHostSafely } from './dns-safe-resolve.js';
export type { SafeResolveResult, SafeResolveOptions } from './dns-safe-resolve.js';

export { SafeHttpClient } from './http-client.js';
export type {
  SafeHttpClientOptions,
  SafeHttpRequestOptions,
  SafeHttpResponse,
  SafeHttpHop,
  SafeHttpMethod,
} from './http-client.js';

export { buildHttpObservation, parseSetCookieHeader } from './http-observation.js';
export type {
  HttpObservation,
  HttpObservationRedirectHop,
  HttpCookieObservation,
  SameSiteValue,
} from './http-observation.js';

export { createPassiveCheckRegistry, runPassiveChecks } from './passive-check.js';
export type { PassiveCheck, PassiveCheckContext } from './passive-check.js';

export {
  ScopeViolationError,
  SsrfViolationError,
  ResourceLimitExceededError,
  UnsupportedAssessmentTypeError,
} from './errors.js';

export {
  WORKER_CAPABILITIES,
  pluginAppliesTo,
  workerHasCapabilities,
  selectApplicablePlugins,
} from './plugin.js';
export type {
  WorkerCapability,
  ScannerLogger,
  ScannerContext,
  ScannerPlugin,
  ReportFindingInput,
} from './plugin.js';

export { computeFindingFingerprint } from './fingerprint.js';
export type { FindingFingerprintInput } from './fingerprint.js';

export { RequestLimiter } from './request-limiter.js';
