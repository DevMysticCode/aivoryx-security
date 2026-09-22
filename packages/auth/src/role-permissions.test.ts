import { describe, expect, it } from 'vitest';
import { ROLE_PERMISSIONS, PLATFORM_ROLE_PERMISSIONS } from './role-permissions.js';
import { ORGANIZATION_ROLES, PLATFORM_ROLES } from './roles.js';

describe('ROLE_PERMISSIONS', () => {
  it('defines a permission set for every tenant role', () => {
    for (const role of ORGANIZATION_ROLES) {
      expect(ROLE_PERMISSIONS[role].length).toBeGreaterThan(0);
    }
  });

  it('OWNER can manage billing', () => {
    expect(ROLE_PERMISSIONS.OWNER).toContain('billing:manage');
  });

  it('ADMIN can read billing but not manage it (OWNER and ADMIN are not identical)', () => {
    expect(ROLE_PERMISSIONS.ADMIN).toContain('billing:read');
    expect(ROLE_PERMISSIONS.ADMIN).not.toContain('billing:manage');
    expect(ROLE_PERMISSIONS.ADMIN).not.toEqual(ROLE_PERMISSIONS.OWNER);
  });

  it('SECURITY_MANAGER has assessment/finding permissions but not membership administration', () => {
    expect(ROLE_PERMISSIONS.SECURITY_MANAGER).toContain('assessment:create');
    expect(ROLE_PERMISSIONS.SECURITY_MANAGER).toContain('finding:update');
    expect(ROLE_PERMISSIONS.SECURITY_MANAGER).not.toContain('member:invite');
    expect(ROLE_PERMISSIONS.SECURITY_MANAGER).not.toContain('billing:manage');
  });

  it('DEVELOPER has project access but no membership or billing administration', () => {
    expect(ROLE_PERMISSIONS.DEVELOPER).toContain('project:create');
    expect(ROLE_PERMISSIONS.DEVELOPER).not.toContain('member:invite');
    expect(ROLE_PERMISSIONS.DEVELOPER).not.toContain('member:remove');
    expect(ROLE_PERMISSIONS.DEVELOPER).not.toContain('billing:read');
    expect(ROLE_PERMISSIONS.DEVELOPER).not.toContain('billing:manage');
  });

  it('DEVELOPER can create an asset but not confirm its authorization (separation of duties)', () => {
    expect(ROLE_PERMISSIONS.DEVELOPER).toContain('asset:create');
    expect(ROLE_PERMISSIONS.DEVELOPER).not.toContain('asset:update');
    expect(ROLE_PERMISSIONS.DEVELOPER).not.toContain('asset:delete');
  });

  it('SECURITY_MANAGER can confirm asset authorization but not delete an asset', () => {
    expect(ROLE_PERMISSIONS.SECURITY_MANAGER).toContain('asset:update');
    expect(ROLE_PERMISSIONS.SECURITY_MANAGER).not.toContain('asset:delete');
  });

  it('VIEWER has only read permissions', () => {
    for (const permission of ROLE_PERMISSIONS.VIEWER) {
      expect(permission.endsWith(':read')).toBe(true);
    }
  });

  it('defines a permission set for every platform role', () => {
    for (const role of PLATFORM_ROLES) {
      expect(PLATFORM_ROLE_PERMISSIONS[role].length).toBeGreaterThan(0);
    }
  });

  it('only SUPER_ADMIN has unrestricted platform permissions', () => {
    const superAdminCount = PLATFORM_ROLE_PERMISSIONS.SUPER_ADMIN.length;
    expect(PLATFORM_ROLE_PERMISSIONS.SUPPORT.length).toBeLessThan(superAdminCount);
    expect(PLATFORM_ROLE_PERMISSIONS.BILLING.length).toBeLessThan(superAdminCount);
    expect(PLATFORM_ROLE_PERMISSIONS.OPERATIONS.length).toBeLessThan(superAdminCount);
  });

  it('SUPPORT does not get billing-management permission', () => {
    expect(PLATFORM_ROLE_PERMISSIONS.SUPPORT).not.toContain('platform:billing:manage');
  });

  it('OPERATIONS does not get user-management permission', () => {
    expect(PLATFORM_ROLE_PERMISSIONS.OPERATIONS).not.toContain('platform:users:manage');
  });
});
