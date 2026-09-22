import type { AssetType } from './assets.js';

export const ASSESSMENT_TYPES = [
  'WEB',
  'API',
  'ANDROID_STATIC',
  'ANDROID_DYNAMIC',
  'IOS_STATIC',
  'IOS_DYNAMIC',
] as const;
export type AssessmentType = (typeof ASSESSMENT_TYPES)[number];

export function isAssessmentType(value: string): value is AssessmentType {
  return (ASSESSMENT_TYPES as readonly string[]).includes(value);
}

/**
 * Which assessment types are valid for each asset type. The single source of
 * truth for this rule — services must call isAssessmentTypeCompatibleWithAsset()
 * rather than re-deriving compatibility inline.
 */
export const ASSET_TYPE_ASSESSMENT_COMPATIBILITY: Readonly<
  Record<AssetType, readonly AssessmentType[]>
> = {
  WEB: ['WEB', 'API'],
  API: ['API'],
  ANDROID: ['ANDROID_STATIC', 'ANDROID_DYNAMIC', 'API'],
  IOS: ['IOS_STATIC', 'IOS_DYNAMIC', 'API'],
};

export function isAssessmentTypeCompatibleWithAsset(
  assetType: AssetType,
  assessmentType: AssessmentType,
): boolean {
  return ASSET_TYPE_ASSESSMENT_COMPATIBILITY[assetType].includes(assessmentType);
}

// Shared by both Assessment and AssessmentJob (see assessment-status.ts) — the
// execution lifecycle is identical for a top-level assessment and each of its
// underlying jobs, but kept as separate named types per asset type since they
// model different rows and may diverge later (e.g. a job-only 'RETRYING' state).
export const ASSESSMENT_STATUSES = [
  'QUEUED',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const;
export type AssessmentStatus = (typeof ASSESSMENT_STATUSES)[number];

export const ASSESSMENT_JOB_STATUSES = [
  'QUEUED',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const;
export type AssessmentJobStatus = (typeof ASSESSMENT_JOB_STATUSES)[number];

const VALID_STATUS_TRANSITIONS: Readonly<Record<AssessmentStatus, readonly AssessmentStatus[]>> = {
  QUEUED: ['RUNNING', 'CANCELLED', 'FAILED'],
  RUNNING: ['COMPLETED', 'FAILED', 'CANCELLED'],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

/** True if the lifecycle allows moving from `from` to `to` — terminal states (COMPLETED/FAILED/CANCELLED) never transition further. */
export function canTransitionAssessmentStatus(
  from: AssessmentStatus,
  to: AssessmentStatus,
): boolean {
  return VALID_STATUS_TRANSITIONS[from].includes(to);
}

export function canTransitionAssessmentJobStatus(
  from: AssessmentJobStatus,
  to: AssessmentJobStatus,
): boolean {
  return VALID_STATUS_TRANSITIONS[from].includes(to);
}
