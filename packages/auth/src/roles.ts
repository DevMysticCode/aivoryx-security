// Platform roles operate Aivoryx Security itself. They are never derived from,
// or combined with, tenant membership — see principals.ts.
export const PLATFORM_ROLES = ['SUPER_ADMIN', 'SUPPORT', 'BILLING', 'OPERATIONS'] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

// Tenant (organization) roles. Values are kept identical to
// packages/db's organization_role enum by convention, but this package does not
// import from @aivoryx/db — auth primitives must stay persistence-agnostic.
export const ORGANIZATION_ROLES = [
  'OWNER',
  'ADMIN',
  'SECURITY_MANAGER',
  'DEVELOPER',
  'VIEWER',
] as const;
export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

export function isPlatformRole(value: string): value is PlatformRole {
  return (PLATFORM_ROLES as readonly string[]).includes(value);
}

export function isOrganizationRole(value: string): value is OrganizationRole {
  return (ORGANIZATION_ROLES as readonly string[]).includes(value);
}
