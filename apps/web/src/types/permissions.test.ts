import { describe, expect, it } from 'vitest';
import { roleHasPermission } from './permissions';

describe('roleHasPermission', () => {
  it('grants OWNER organization:update', () => {
    expect(roleHasPermission('OWNER', 'organization:update')).toBe(true);
  });

  it('denies VIEWER organization:update', () => {
    expect(roleHasPermission('VIEWER', 'organization:update')).toBe(false);
  });

  it('denies DEVELOPER member:invite', () => {
    expect(roleHasPermission('DEVELOPER', 'member:invite')).toBe(false);
  });

  it('grants SECURITY_MANAGER assessment:create', () => {
    expect(roleHasPermission('SECURITY_MANAGER', 'assessment:create')).toBe(true);
  });

  it('returns false when no role is given', () => {
    expect(roleHasPermission(undefined, 'project:read')).toBe(false);
  });
});
