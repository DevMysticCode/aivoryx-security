import { describe, expect, it } from 'vitest';
import {
  hasPermission,
  hasPlatformPermission,
  requirePermission,
  requirePlatformPermission,
  assertTenantAccess,
  requireTenant,
  requireTenantPermission,
} from './authorization.js';
import { createPlatformPrincipal, createTenantPrincipal } from './principals.js';
import { AuthorizationError, TenantAccessError } from './errors.js';

const ORG_A = 'org-a';
const ORG_B = 'org-b';

function tenantPrincipal(
  role: Parameters<typeof createTenantPrincipal>[0]['role'],
  organizationId = ORG_A,
) {
  return createTenantPrincipal({ userId: 'user-1', organizationId, role, authType: 'user' });
}

describe('hasPermission / requirePermission', () => {
  it('grants OWNER billing:manage and denies it to VIEWER', () => {
    expect(hasPermission(tenantPrincipal('OWNER'), 'billing:manage')).toBe(true);
    expect(hasPermission(tenantPrincipal('VIEWER'), 'billing:manage')).toBe(false);
  });

  it('requirePermission throws AuthorizationError when the role lacks the permission', () => {
    expect(() => requirePermission(tenantPrincipal('DEVELOPER'), 'member:remove')).toThrow(
      AuthorizationError,
    );
  });

  it('requirePermission does not throw when the role has the permission', () => {
    expect(() =>
      requirePermission(tenantPrincipal('SECURITY_MANAGER'), 'assessment:create'),
    ).not.toThrow();
  });

  it('a platform principal never has a tenant permission', () => {
    const platform = createPlatformPrincipal('user-1', 'SUPER_ADMIN');
    expect(hasPermission(platform, 'organization:read')).toBe(false);
  });
});

describe('hasPlatformPermission / requirePlatformPermission', () => {
  it('grants SUPER_ADMIN platform:users:manage and denies it to SUPPORT', () => {
    expect(
      hasPlatformPermission(createPlatformPrincipal('u1', 'SUPER_ADMIN'), 'platform:users:manage'),
    ).toBe(true);
    expect(
      hasPlatformPermission(createPlatformPrincipal('u1', 'SUPPORT'), 'platform:users:manage'),
    ).toBe(false);
  });

  it('a tenant principal never has a platform permission', () => {
    expect(hasPlatformPermission(tenantPrincipal('OWNER'), 'platform:audit:read')).toBe(false);
  });

  it('requirePlatformPermission throws for a role missing the permission', () => {
    expect(() =>
      requirePlatformPermission(
        createPlatformPrincipal('u1', 'OPERATIONS'),
        'platform:billing:manage',
      ),
    ).toThrow(AuthorizationError);
  });
});

describe('assertTenantAccess (tenant isolation)', () => {
  it('allows a tenant principal to access its own organization', () => {
    expect(() => assertTenantAccess(tenantPrincipal('VIEWER', ORG_A), ORG_A)).not.toThrow();
  });

  it('denies a tenant principal access to a different organization', () => {
    expect(() => assertTenantAccess(tenantPrincipal('OWNER', ORG_A), ORG_B)).toThrow(
      TenantAccessError,
    );
  });

  it('denies a platform principal tenant access even to a plausible organization id', () => {
    const platform = createPlatformPrincipal('u1', 'SUPER_ADMIN');
    expect(() => assertTenantAccess(platform, ORG_A)).toThrow(TenantAccessError);
  });
});

describe('requireTenantPermission', () => {
  it('throws TenantAccessError before checking permission when organization does not match', () => {
    expect(() =>
      requireTenantPermission(tenantPrincipal('OWNER', ORG_A), ORG_B, 'billing:manage'),
    ).toThrow(TenantAccessError);
  });

  it('throws AuthorizationError when organization matches but permission is missing', () => {
    expect(() =>
      requireTenantPermission(tenantPrincipal('VIEWER', ORG_A), ORG_A, 'project:create'),
    ).toThrow(AuthorizationError);
  });

  it('passes when organization matches and permission is granted', () => {
    expect(() =>
      requireTenantPermission(tenantPrincipal('DEVELOPER', ORG_A), ORG_A, 'project:create'),
    ).not.toThrow();
  });
});

describe('requireTenant', () => {
  it('returns the principal unchanged when it is a tenant principal', () => {
    const principal = tenantPrincipal('VIEWER');
    expect(requireTenant(principal)).toBe(principal);
  });

  it('throws AuthorizationError for a platform principal', () => {
    expect(() => requireTenant(createPlatformPrincipal('u1', 'SUPER_ADMIN'))).toThrow(
      AuthorizationError,
    );
  });
});
