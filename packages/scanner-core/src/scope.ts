import type { AssessmentScope } from '@aivoryx/shared-types';
import { isAssessmentScheme } from '@aivoryx/shared-types';
import { ScopeViolationError } from './errors.js';

export interface ScopeCheckResult {
  allowed: boolean;
  reason?: string;
}

function normalizeHost(host: string): string {
  // Strip a trailing dot (DNS root label) and lower-case — the two ways the
  // same hostname can be spelled differently while meaning the same host.
  return host.toLowerCase().replace(/\.$/, '');
}

/**
 * Validates a parsed URL against an assessment's scope. Does NOT touch the
 * network or DNS — pure scope semantics (Part B, steps 1-3 and 7-9). Callers
 * must separately resolve the hostname and run checkIpAgainstSsrfPolicy
 * (step 4-6) before actually connecting.
 */
export function checkUrlAgainstScope(url: URL, scope: AssessmentScope): ScopeCheckResult {
  const scheme = url.protocol.replace(':', '');
  if (!isAssessmentScheme(scheme) || !scope.schemes.includes(scheme)) {
    return { allowed: false, reason: `Scheme "${scheme}" is not permitted by scope` };
  }

  const host = normalizeHost(url.hostname);
  const port = url.port ? Number(url.port) : scheme === 'https' ? 443 : 80;

  const excludedHosts = new Set((scope.exclusions.hosts ?? []).map(normalizeHost));
  if (excludedHosts.has(host)) {
    return { allowed: false, reason: `Host "${host}" is explicitly excluded from scope` };
  }

  const allowedHosts = new Set(scope.hosts.map(normalizeHost));
  if (!allowedHosts.has(host)) {
    return { allowed: false, reason: `Host "${host}" is not in the allowed scope host list` };
  }

  if (!scope.ports.includes(port)) {
    return { allowed: false, reason: `Port ${port} is not in the allowed scope port list` };
  }

  const path = url.pathname;
  const excludedPaths = scope.exclusions.paths ?? [];
  if (excludedPaths.some((prefix) => path.startsWith(prefix))) {
    return { allowed: false, reason: `Path "${path}" is explicitly excluded from scope` };
  }

  if (scope.allowedPathPrefixes.length > 0) {
    const matches = scope.allowedPathPrefixes.some((prefix) => path.startsWith(prefix));
    if (!matches) {
      return { allowed: false, reason: `Path "${path}" does not match any allowed path prefix` };
    }
  }

  return { allowed: true };
}

/** Throwing variant used by the safe HTTP client at each hop (initial request and every redirect). */
export function requireUrlInScope(url: URL, scope: AssessmentScope): void {
  const result = checkUrlAgainstScope(url, scope);
  if (!result.allowed) {
    throw new ScopeViolationError(result.reason ?? `URL is out of scope: ${url.toString()}`);
  }
}
