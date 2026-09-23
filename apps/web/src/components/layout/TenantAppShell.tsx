import { Outlet } from 'react-router-dom';
import { Sidebar, type SidebarItem } from './Sidebar';
import { TopBar } from './TopBar';
import { OrganizationSwitcher } from './OrganizationSwitcher';
import { UserMenu } from './UserMenu';
import { useOrganization } from '../../organization/OrganizationContext';
import { LoadingState } from '../ui/LoadingState';
import { EmptyState } from '../ui/EmptyState';
import { CreateOrganizationForm } from '../../pages/organizations/CreateOrganizationForm';

const NAV_ITEMS: SidebarItem[] = [
  { label: 'Dashboard', to: '/app', end: true },
  { label: 'Projects', to: '/app/projects' },
  { label: 'Assessments', to: '/app/assessments' },
  { label: 'Reports', to: '/app/reports' },
  { label: 'Team', to: '/app/team' },
  { label: 'Organization Settings', to: '/app/settings' },
];

export function TenantAppShell() {
  const { organizations, currentOrganization, isLoading } = useOrganization();

  if (isLoading) return <LoadingState label="Loading your organizations…" />;

  if (organizations.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="w-full max-w-md">
          <EmptyState
            title="No organization yet"
            description="Create an organization to start onboarding assets and running assessments."
          />
          <div className="mt-6">
            <CreateOrganizationForm />
          </div>
        </div>
      </div>
    );
  }

  if (!currentOrganization) return <LoadingState label="Loading organization…" />;

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar
        items={NAV_ITEMS}
        header={<span className="text-lg font-semibold text-primary">Aivoryx</span>}
      />
      <div className="flex flex-1 flex-col">
        <TopBar left={<OrganizationSwitcher />} right={<UserMenu />} />
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
