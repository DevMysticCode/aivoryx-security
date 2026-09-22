// Finding/evidence domain types shared between the worker (which writes them)
// and the API (which reads them back). Severity/confidence/status are plain
// string-literal unions, matching the pattern already used for
// AssetType/AssessmentType/AssessmentStatus elsewhere in this package.

export const FINDING_SEVERITIES = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

export const FINDING_CONFIDENCES = ['LOW', 'MEDIUM', 'HIGH', 'CONFIRMED'] as const;
export type FindingConfidence = (typeof FINDING_CONFIDENCES)[number];

export const FINDING_STATUSES = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'FALSE_POSITIVE'] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];

export function isFindingSeverity(value: string): value is FindingSeverity {
  return (FINDING_SEVERITIES as readonly string[]).includes(value);
}
