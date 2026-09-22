// Tenant permissions. These are authorization primitives for future route
// handlers — no assessment/scanner business logic is implemented against them yet.
export const PERMISSIONS = [
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
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

// Platform permissions are a distinct type from tenant Permission so a tenant
// check can never accidentally be satisfied by (or applied to) a platform principal.
export const PLATFORM_PERMISSIONS = [
  'platform:organizations:read',
  'platform:organizations:manage',
  'platform:users:read',
  'platform:users:manage',
  'platform:billing:read',
  'platform:billing:manage',
  'platform:system:operate',
  'platform:audit:read',
] as const;
export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[number];

export function isPlatformPermission(value: string): value is PlatformPermission {
  return (PLATFORM_PERMISSIONS as readonly string[]).includes(value);
}
