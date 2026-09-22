/** A URL was rejected by the assessment scope (host/scheme/port/path/exclusion). Never retried. */
export class ScopeViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScopeViolationError';
  }
}

/** A resolved IP address was rejected by SSRF policy. Never retried. */
export class SsrfViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfViolationError';
  }
}

/** A resource limit (timeout, response size, redirect count, header size) was exceeded. */
export class ResourceLimitExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResourceLimitExceededError';
  }
}

/**
 * No scanner plugin implements the requested asset-type/assessment-type
 * combination (e.g. ANDROID_STATIC has no scanner yet). COMPLETED must mean
 * an assessment actually ran — this is a permanent failure, never retried,
 * and never silently treated as "nothing to do." The `code` is a stable,
 * safe-to-persist/expose machine identifier distinct from the free-text
 * message.
 */
export class UnsupportedAssessmentTypeError extends Error {
  readonly code = 'UNSUPPORTED_ASSESSMENT_TYPE';

  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedAssessmentTypeError';
  }
}
