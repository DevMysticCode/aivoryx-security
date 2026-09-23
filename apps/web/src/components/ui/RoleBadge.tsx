import { Badge } from './Badge';
import type { OrganizationRole } from '../../types/api';

const ROLE_TONE: Record<OrganizationRole, 'primary' | 'info' | 'neutral'> = {
  OWNER: 'primary',
  ADMIN: 'primary',
  SECURITY_MANAGER: 'info',
  DEVELOPER: 'neutral',
  VIEWER: 'neutral',
};

const ROLE_LABEL: Record<OrganizationRole, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  SECURITY_MANAGER: 'Security Manager',
  DEVELOPER: 'Developer',
  VIEWER: 'Viewer',
};

export function RoleBadge({ role }: { role: OrganizationRole }) {
  return <Badge tone={ROLE_TONE[role]}>{ROLE_LABEL[role]}</Badge>;
}
