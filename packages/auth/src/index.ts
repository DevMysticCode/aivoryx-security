export { PLATFORM_ROLES, ORGANIZATION_ROLES, isPlatformRole, isOrganizationRole } from './roles.js';
export type { PlatformRole, OrganizationRole } from './roles.js';

export {
  PERMISSIONS,
  PLATFORM_PERMISSIONS,
  isPermission,
  isPlatformPermission,
} from './permissions.js';
export type { Permission, PlatformPermission } from './permissions.js';

export { ROLE_PERMISSIONS, PLATFORM_ROLE_PERMISSIONS } from './role-permissions.js';

export {
  isPlatformPrincipal,
  isTenantPrincipal,
  createPlatformPrincipal,
  createTenantPrincipal,
} from './principals.js';
export type { AuthPrincipal, PlatformPrincipal, TenantPrincipal } from './principals.js';

export {
  hasPermission,
  hasPlatformPermission,
  requirePermission,
  requirePlatformPermission,
  assertTenantAccess,
  requireTenant,
  requireTenantPermission,
} from './authorization.js';

export {
  generateApiKey,
  hashApiKeySecret,
  verifyApiKeySecret,
  parseApiKeyHeader,
  verifyApiKeyCredential,
  API_KEY_DEFAULT_ROLE,
} from './api-key.js';
export type {
  GeneratedApiKey,
  ParsedApiKey,
  ApiKeyRecordLike,
  VerifyApiKeyOptions,
  VerifyApiKeyResult,
  ApiKeyVerificationFailureReason,
} from './api-key.js';

export {
  hashPassword,
  verifyPassword,
  validatePasswordStrength,
  PASSWORD_MIN_LENGTH,
} from './password.js';
export type { PasswordValidationResult } from './password.js';

export {
  generateSessionToken,
  hashSessionToken,
  verifySessionToken,
  verifySessionCredential,
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
} from './session.js';
export type {
  GeneratedSessionToken,
  SessionRecordLike,
  VerifySessionOptions,
  VerifySessionResult,
  SessionVerificationFailureReason,
} from './session.js';

export { normalizeEmail } from './email.js';

export { AuthenticationError, AuthorizationError, TenantAccessError } from './errors.js';
