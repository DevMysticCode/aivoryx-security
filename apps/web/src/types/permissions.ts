import type { OrganizationRole } from './api';

// A UI-only mirror of packages/auth/src/role-permissions.ts's ROLE_PERMISSIONS
// table — used exclusively to decide what to show/enable so the interface
// doesn't dangle controls a role can never use. It is NEVER the authorization
// boundary: every mutating request still gets independently checked and can
// still be rejected server-side even if this table says otherwise (e.g. if it
// ever drifts out of sync). See PermissionGate.tsx.
export type Permission =
  | 'organization:read'
  | 'organization:update'
  | 'member:read'
  | 'member:invite'
  | 'member:update'
  | 'member:remove'
  | 'project:read'
  | 'project:create'
  | 'project:update'
  | 'project:delete'
  | 'asset:read'
  | 'asset:create'
  | 'asset:update'
  | 'asset:delete'
  | 'assessment:read'
  | 'assessment:create'
  | 'assessment:cancel'
  | 'finding:read'
  | 'finding:update';

const ROLE_PERMISSIONS: Record<OrganizationRole, readonly Permission[]> = {
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
    'asset:read',
    'asset:create',
    'asset:update',
    'asset:delete',
    'assessment:read',
    'assessment:create',
    'assessment:cancel',
    'finding:read',
    'finding:update',
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
    'asset:read',
    'asset:create',
    'asset:update',
    'asset:delete',
    'assessment:read',
    'assessment:create',
    'assessment:cancel',
    'finding:read',
    'finding:update',
  ],
  SECURITY_MANAGER: [
    'organization:read',
    'member:read',
    'project:read',
    'project:update',
    'asset:read',
    'asset:create',
    'asset:update',
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
    'asset:read',
    'asset:create',
    'assessment:read',
    'assessment:create',
    'finding:read',
  ],
  VIEWER: [
    'organization:read',
    'member:read',
    'project:read',
    'asset:read',
    'assessment:read',
    'finding:read',
  ],
};

export function roleHasPermission(
  role: OrganizationRole | undefined,
  permission: Permission,
): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role].includes(permission);
}
