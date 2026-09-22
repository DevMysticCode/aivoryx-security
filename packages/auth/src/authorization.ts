import { AuthorizationError, TenantAccessError } from './errors.js';
import type { Permission, PlatformPermission } from './permissions.js';
import type { AuthPrincipal, TenantPrincipal } from './principals.js';
import { ROLE_PERMISSIONS, PLATFORM_ROLE_PERMISSIONS } from './role-permissions.js';

/** True if a tenant principal's role grants `permission`. Always false for a platform principal. */
export function hasPermission(principal: AuthPrincipal, permission: Permission): boolean {
  if (principal.type !== 'tenant') return false;
  return ROLE_PERMISSIONS[principal.role].includes(permission);
}

/** True if a platform principal's role grants `permission`. Always false for a tenant principal. */
export function hasPlatformPermission(
  principal: AuthPrincipal,
  permission: PlatformPermission,
): boolean {
  if (principal.type !== 'platform') return false;
  return PLATFORM_ROLE_PERMISSIONS[principal.role].includes(permission);
}

/** Throws AuthorizationError if the principal lacks `permission`. */
export function requirePermission(principal: AuthPrincipal, permission: Permission): void {
  if (!hasPermission(principal, permission)) {
    throw new AuthorizationError(`Missing permission: ${permission}`);
  }
}

/** Throws AuthorizationError if the platform principal lacks `permission`. */
export function requirePlatformPermission(
  principal: AuthPrincipal,
  permission: PlatformPermission,
): void {
  if (!hasPlatformPermission(principal, permission)) {
    throw new AuthorizationError(`Missing platform permission: ${permission}`);
  }
}

/**
 * The tenant-isolation boundary: throws TenantAccessError unless `principal` is a
 * tenant principal scoped to exactly `organizationId`. Every handler that reads or
 * mutates an organization-owned resource must call this (or go through a service
 * that does) before touching the resource — a UUID alone is never authorization.
 */
export function assertTenantAccess(
  principal: AuthPrincipal,
  organizationId: string,
): asserts principal is TenantPrincipal {
  if (principal.type !== 'tenant' || principal.organizationId !== organizationId) {
    throw new TenantAccessError();
  }
}

/** Narrows to TenantPrincipal, throwing AuthorizationError for a platform principal. */
export function requireTenant(principal: AuthPrincipal): TenantPrincipal {
  if (principal.type !== 'tenant') {
    throw new AuthorizationError('This action requires organization (tenant) authentication');
  }
  return principal;
}

/** Combines assertTenantAccess with a permission check for the common case. */
export function requireTenantPermission(
  principal: AuthPrincipal,
  organizationId: string,
  permission: Permission,
): asserts principal is TenantPrincipal {
  assertTenantAccess(principal, organizationId);
  requirePermission(principal, permission);
}
