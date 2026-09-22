import type { OrganizationRole, PlatformRole } from './roles.js';

export interface PlatformPrincipal {
  type: 'platform';
  userId: string;
  role: PlatformRole;
}

export interface TenantPrincipal {
  type: 'tenant';
  userId: string;
  organizationId: string;
  role: OrganizationRole;
  /** 'user' for a logged-in human; 'api-key' for machine authentication. */
  authType: 'user' | 'api-key';
}

/**
 * Normalized identity of "who is making this request", independent of how they
 * authenticated. Domain/route code should depend on this union, never on a
 * specific auth provider's user/session shape.
 */
export type AuthPrincipal = PlatformPrincipal | TenantPrincipal;

export function isPlatformPrincipal(principal: AuthPrincipal): principal is PlatformPrincipal {
  return principal.type === 'platform';
}

export function isTenantPrincipal(principal: AuthPrincipal): principal is TenantPrincipal {
  return principal.type === 'tenant';
}

export function createPlatformPrincipal(userId: string, role: PlatformRole): PlatformPrincipal {
  return { type: 'platform', userId, role };
}

export function createTenantPrincipal(params: {
  userId: string;
  organizationId: string;
  role: OrganizationRole;
  authType: 'user' | 'api-key';
}): TenantPrincipal {
  return {
    type: 'tenant',
    userId: params.userId,
    organizationId: params.organizationId,
    role: params.role,
    authType: params.authType,
  };
}
