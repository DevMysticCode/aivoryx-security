import { createHash } from 'node:crypto';

export interface FindingFingerprintInput {
  assessmentId: string;
  scanner: string;
  category: string;
  target: string;
  key: string;
}

/** Normalizes a target URL/host so trivially-equivalent forms (trailing slash, default port, scheme case) fingerprint identically. */
function normalizeTarget(target: string): string {
  try {
    const url = new URL(target);
    const scheme = url.protocol.replace(':', '').toLowerCase();
    const defaultPort = scheme === 'https' ? '443' : scheme === 'http' ? '80' : '';
    const port = url.port && url.port !== defaultPort ? `:${url.port}` : '';
    const path = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '');
    return `${scheme}://${url.hostname.toLowerCase()}${port}${path}`;
  } catch {
    return target.trim().toLowerCase();
  }
}

/**
 * A deterministic fingerprint identifying "this same observation" so the
 * same scanner reporting the same thing twice (e.g. a retried job) never
 * creates a duplicate finding row. Deliberately excludes response bodies,
 * timings, or anything non-deterministic — see Part O.
 */
export function computeFindingFingerprint(input: FindingFingerprintInput): string {
  const material = [
    input.assessmentId,
    input.scanner,
    input.category,
    normalizeTarget(input.target),
    input.key,
  ].join('|');
  return createHash('sha256').update(material).digest('hex');
}
