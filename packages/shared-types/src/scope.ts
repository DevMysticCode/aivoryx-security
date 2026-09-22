import { URL } from 'node:url';

// Assessment scope: an explicit, positive allow-list of what a scanner may
// contact for one specific assessment. `assets.authorization_confirmed` means
// "the organization is allowed to have this asset assessed at all" — it is
// NOT permission for a scanner to contact every host it happens to discover.
// AssessmentScope is the finer-grained boundary that actually constrains
// outbound requests; see docs/security-model.md.

export const ASSESSMENT_SCHEMES = ['http', 'https'] as const;
export type AssessmentScheme = (typeof ASSESSMENT_SCHEMES)[number];

export function isAssessmentScheme(value: string): value is AssessmentScheme {
  return (ASSESSMENT_SCHEMES as readonly string[]).includes(value);
}

export interface AssessmentScopeExclusions {
  /** Hostnames (exact match, case-insensitive) that are never in scope even if `hosts` would otherwise allow them. */
  hosts: string[];
  /** Path prefixes (exact prefix match) that are never in scope. */
  paths: string[];
}

export interface AssessmentScope {
  /** Schemes a scanner may use. Only http/https are ever supported — see Part H. */
  schemes: AssessmentScheme[];
  /** Hostnames (exact match, case-insensitive) a scanner may contact. Never a wildcard. */
  hosts: string[];
  /** Ports a scanner may connect to. */
  ports: number[];
  /** If non-empty, a request's path must start with one of these prefixes. Empty means "no path restriction". */
  allowedPathPrefixes: string[];
  exclusions: AssessmentScopeExclusions;
}

/**
 * Builds the default (and, for this batch, only) scope for a WEB asset: its
 * declared base URL's host/scheme/port, plus any explicitly declared
 * additional hosts — nothing discovered at scan time is ever added.
 */
export function buildWebAssetScope(config: {
  baseUrl: string;
  additionalHosts?: string[];
}): AssessmentScope {
  const base = new URL(config.baseUrl);
  const scheme = base.protocol.replace(':', '');
  if (!isAssessmentScheme(scheme)) {
    throw new Error(`Unsupported scheme in asset baseUrl: ${base.protocol}`);
  }

  const hosts = [
    base.hostname.toLowerCase(),
    ...(config.additionalHosts ?? []).map((h) => h.toLowerCase()),
  ];
  const port = base.port ? Number(base.port) : scheme === 'https' ? 443 : 80;

  return {
    schemes: ['http', 'https'],
    hosts: Array.from(new Set(hosts)),
    ports: [port, 80, 443].filter((p, idx, arr) => arr.indexOf(p) === idx),
    allowedPathPrefixes: [],
    exclusions: { hosts: [], paths: [] },
  };
}
