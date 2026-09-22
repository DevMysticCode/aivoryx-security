import type { Permission } from './permissions.js';
import type { OrganizationRole, PlatformRole } from './roles.js';
import type { PlatformPermission } from './permissions.js';

/**
 * The single source of truth for tenant role -> permission grants. Route
 * handlers must never branch on `role` directly (e.g. `if (role === 'ADMIN')`) —
 * they call hasPermission()/requirePermission() (see authorization.ts) instead,
 * which consults this table. OWNER and ADMIN are deliberately not identical:
 * only OWNER manages billing.
 */
export const ROLE_PERMISSIONS: Readonly<Record<OrganizationRole, readonly Permission[]>> = {
  OWNER: [
    'organization:read',
    'organization:update',
    'member:read',
    'member:invite',
    'member:update',
    'member:remove',
    'project:read',
    'project:create',
    'project:update',
    'project:delete',
    'assessment:read',
    'assessment:create',
    'assessment:cancel',
    'finding:read',
    'finding:update',
    'billing:read',
    'billing:manage',
    'api_key:create',
    'api_key:read',
    'api_key:revoke',
  ],
  ADMIN: [
    'organization:read',
    'organization:update',
    'member:read',
    'member:invite',
    'member:update',
    'member:remove',
    'project:read',
    'project:create',
    'project:update',
    'project:delete',
    'assessment:read',
    'assessment:create',
    'assessment:cancel',
    'finding:read',
    'finding:update',
    // Billing administration is OWNER-only; ADMIN can see billing state but not change it.
    'billing:read',
    'api_key:create',
    'api_key:read',
    'api_key:revoke',
  ],
  SECURITY_MANAGER: [
    'organization:read',
    'member:read',
    'project:read',
    'project:update',
    'assessment:read',
    'assessment:create',
    'assessment:cancel',
    'finding:read',
    'finding:update',
  ],
  DEVELOPER: [
    'organization:read',
    'project:read',
    'project:create',
    'project:update',
    'assessment:read',
    'assessment:create',
    'finding:read',
  ],
  VIEWER: ['organization:read', 'member:read', 'project:read', 'assessment:read', 'finding:read'],
};

/**
 * Platform role -> platform permission grants. Deliberately least-privilege:
 * SUPPORT and OPERATIONS do not get billing or user-management permissions,
 * and no role except SUPER_ADMIN gets unrestricted access.
 */
export const PLATFORM_ROLE_PERMISSIONS: Readonly<
  Record<PlatformRole, readonly PlatformPermission[]>
> = {
  SUPER_ADMIN: [
    'platform:organizations:read',
    'platform:organizations:manage',
    'platform:users:read',
    'platform:users:manage',
    'platform:billing:read',
    'platform:billing:manage',
    'platform:system:operate',
    'platform:audit:read',
  ],
  SUPPORT: ['platform:organizations:read', 'platform:users:read', 'platform:audit:read'],
  BILLING: ['platform:organizations:read', 'platform:billing:read', 'platform:billing:manage'],
  OPERATIONS: ['platform:system:operate', 'platform:audit:read'],
};
