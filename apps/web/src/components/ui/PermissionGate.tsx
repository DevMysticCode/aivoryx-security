import type { ReactNode } from 'react';
import { useOrganization } from '../../organization/OrganizationContext';
import { roleHasPermission, type Permission } from '../../types/permissions';

interface PermissionGateProps {
  permission: Permission;
  children: ReactNode;
  fallback?: ReactNode;
}

/** UI-only gating — see types/permissions.ts for why this can never be the real authorization boundary. */
export function PermissionGate({ permission, children, fallback = null }: PermissionGateProps) {
  const { currentOrganization } = useOrganization();
  if (!roleHasPermission(currentOrganization?.myRole, permission)) return <>{fallback}</>;
  return <>{children}</>;
}
