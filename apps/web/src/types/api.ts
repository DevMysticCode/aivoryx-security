// Mirrors the response shapes returned by apps/api — kept hand-written and
// deliberately minimal (only fields the UI actually reads) rather than
// generated, since there is no shared OpenAPI/schema export yet.

export const PLATFORM_ROLES = ['SUPER_ADMIN', 'SUPPORT', 'BILLING', 'OPERATIONS'] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const ORGANIZATION_ROLES = [
  'OWNER',
  'ADMIN',
  'SECURITY_MANAGER',
  'DEVELOPER',
  'VIEWER',
] as const;
export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

export interface User {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  status: string;
  platformRole: PlatformRole | null;
  createdAt: string;
}

export const THEME_PRESETS = ['aivoryx', 'ocean', 'enterprise', 'slate', 'custom'] as const;
export type ThemePreset = (typeof THEME_PRESETS)[number];

export interface Organization {
  id: string;
  name: string;
  slug: string;
  status: string;
  displayName?: string | null;
  website?: string | null;
  industry?: string | null;
  description?: string | null;
  contactEmail?: string | null;
  phone?: string | null;
  address?: string | null;
  country?: string | null;
  timezone?: string | null;
  locale?: string | null;
  currency?: string | null;
  logoUrl?: string | null;
  darkLogoUrl?: string | null;
  faviconUrl?: string | null;
  themePreset: ThemePreset | string;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  accentColor?: string | null;
  createdAt: string;
  updatedAt?: string;
  /** Only present on the session-user branch of GET /organizations — see organizations.ts's listVisibleTo. */
  myRole?: OrganizationRole;
}

export interface Member {
  id: string;
  organizationId: string;
  userId: string;
  email: string;
  name: string | null;
  role: OrganizationRole;
  status: string;
  createdAt: string;
}

export interface Project {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export const ASSET_TYPES = ['WEB', 'API', 'ANDROID', 'IOS'] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

export interface Asset {
  id: string;
  projectId: string;
  assetType: AssetType;
  name: string;
  description: string | null;
  status: string;
  config: Record<string, unknown>;
  authorizationConfirmed: boolean;
  createdAt: string;
  updatedAt: string;
}

export const ASSESSMENT_TYPES = [
  'WEB',
  'API',
  'ANDROID_STATIC',
  'ANDROID_DYNAMIC',
  'IOS_STATIC',
  'IOS_DYNAMIC',
] as const;
export type AssessmentType = (typeof ASSESSMENT_TYPES)[number];

export const SUPPORTED_ASSESSMENT_TYPES: readonly AssessmentType[] = ['WEB'];

export const ASSESSMENT_STATUSES = [
  'QUEUED',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const;
export type AssessmentStatus = (typeof ASSESSMENT_STATUSES)[number];

export interface Assessment {
  id: string;
  projectId: string;
  assetId: string;
  assessmentType: AssessmentType;
  status: AssessmentStatus;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export const FINDING_SEVERITIES = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

export const FINDING_CONFIDENCES = ['LOW', 'MEDIUM', 'HIGH', 'CONFIRMED'] as const;
export type FindingConfidence = (typeof FINDING_CONFIDENCES)[number];

export const FINDING_STATUSES = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'FALSE_POSITIVE'] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];

export interface Finding {
  id: string;
  assessmentId: string;
  scanner: string;
  title: string;
  description: string;
  severity: FindingSeverity;
  confidence: FindingConfidence;
  category: string;
  status: FindingStatus;
  target: string;
  key: string;
  remediation: string | null;
  references: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Evidence {
  id: string;
  findingId: string;
  data: Record<string, unknown>;
  createdAt: string;
}

export const DISCOVERED_URL_TYPES = [
  'PAGE',
  'RESOURCE',
  'FORM_ACTION',
  'SITEMAP',
  'ROBOTS',
] as const;
export type DiscoveredUrlType = (typeof DISCOVERED_URL_TYPES)[number];

export interface DiscoveredUrl {
  id: string;
  assessmentId: string;
  url: string;
  sourceUrl: string | null;
  urlType: DiscoveredUrlType;
  discoveryMethod: string;
  depth: number;
  statusCode: number | null;
  contentType: string | null;
  responseBytes: number | null;
  createdAt: string;
}

export const ACTIVE_TEST_PLAN_STATUSES = [
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'BUDGET_EXHAUSTED',
  'SKIPPED',
] as const;
export type ActiveTestPlanStatus = (typeof ACTIVE_TEST_PLAN_STATUSES)[number];

export interface ActiveTestPlan {
  id: string;
  assessmentId: string;
  status: ActiveTestPlanStatus;
  requestBudget: number;
  requestsUsed: number;
  testsSelectedCount: number;
  testsCompletedCount: number;
  testsFailedCount: number;
  testsSkippedCount: number;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export const ACTIVE_TEST_EXECUTION_STATUSES = [
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'BUDGET_EXHAUSTED',
  'SKIPPED',
] as const;
export type ActiveTestExecutionStatus = (typeof ACTIVE_TEST_EXECUTION_STATUSES)[number];

// Batch 10: the security verdict is a separate axis from `status` above —
// "ran fine, found nothing" (COMPLETED + NO_FINDING) is a different fact
// from "could not be run" (FAILED + INCONCLUSIVE). `null` means no verdict
// was ever reached (CANCELLED/BUDGET_EXHAUSTED/SKIPPED, or a row that
// predates this field) — "not applicable", never a false "no finding".
export const ACTIVE_TEST_SECURITY_RESULTS = ['NO_FINDING', 'FINDING', 'INCONCLUSIVE'] as const;
export type ActiveTestSecurityResult = (typeof ACTIVE_TEST_SECURITY_RESULTS)[number];

export const ACTIVE_TEST_SKIP_REASONS = [
  'NO_ELIGIBLE_TARGETS',
  'NO_PARAMETERS',
  'UNSUPPORTED_CONTENT_TYPE',
  'LIMIT_REACHED',
  'UNSUPPORTED_ASSET_TYPE',
  'MISSING_CAPABILITY',
] as const;
export type ActiveTestSkipReason = (typeof ACTIVE_TEST_SKIP_REASONS)[number];

export const ACTIVE_TEST_FAILURE_REASONS = [
  'NETWORK_ERROR',
  'SCOPE_REJECTED',
  'SSRF_REJECTED',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
  'INVALID_TEST_CONFIGURATION',
] as const;
export type ActiveTestFailureReason = (typeof ACTIVE_TEST_FAILURE_REASONS)[number];

export interface ActiveTestExecutionFindingRef {
  id: string;
  title: string;
  severity: FindingSeverity;
  confidence: FindingConfidence;
}

export interface ActiveTestExecution {
  id: string;
  planId: string;
  assessmentId: string;
  testId: string;
  testVersion: string;
  target: string;
  status: ActiveTestExecutionStatus;
  securityResult: ActiveTestSecurityResult | null;
  skipReason: ActiveTestSkipReason | null;
  failureReason: ActiveTestFailureReason | null;
  requestsUsed: number;
  findings: ActiveTestExecutionFindingRef[];
  durationMs: number | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface ActiveTestDefinitionSummary {
  id: string;
  name: string;
  description: string;
  category: string;
  potentialSeverity: FindingSeverity;
  safety: 'SAFE_READ_ONLY';
}

export interface PlatformStats {
  organizations: number;
  activeOrganizations: number;
  users: number;
  assessments: number;
  runningAssessments: number;
  findings: number;
}
