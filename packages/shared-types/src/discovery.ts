// Discovery domain types shared between the worker (which writes discovered
// URLs) and the API (which reads them back) — Batch 6. Plain string-literal
// unions, matching the pattern already used for AssetType/AssessmentType/
// FindingSeverity elsewhere in this package.

export const URL_TYPES = ['PAGE', 'RESOURCE', 'FORM_ACTION', 'SITEMAP', 'ROBOTS'] as const;
export type UrlType = (typeof URL_TYPES)[number];

export const DISCOVERY_METHODS = [
  'SEED',
  'HTML_LINK',
  'HTML_RESOURCE',
  'FORM',
  'ROBOTS',
  'SITEMAP',
  'REDIRECT',
] as const;
export type DiscoveryMethod = (typeof DISCOVERY_METHODS)[number];

export function isUrlType(value: string): value is UrlType {
  return (URL_TYPES as readonly string[]).includes(value);
}

export function isDiscoveryMethod(value: string): value is DiscoveryMethod {
  return (DISCOVERY_METHODS as readonly string[]).includes(value);
}
