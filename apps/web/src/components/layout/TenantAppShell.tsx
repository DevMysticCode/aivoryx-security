import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar, type SidebarItem } from './Sidebar';
import { TopBar } from './TopBar';
import { OrganizationSwitcher } from './OrganizationSwitcher';
import { UserMenu } from './UserMenu';
import { useOrganization } from '../../organization/OrganizationContext';
import { useSession } from '../../auth/SessionContext';
import { LoadingState } from '../ui/LoadingState';
import { EmptyState } from '../ui/EmptyState';
import { Button } from '../ui/Button';
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
  const { logout } = useSession();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  if (isLoading) return <LoadingState label="Loading your organizations…" />;

  if (organizations.length === 0) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <div className="flex justify-end p-4">
          <Button variant="outline" size="sm" onClick={() => void logout()}>
            Sign out
          </Button>
        </div>
        <div className="flex flex-1 items-center justify-center p-6">
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
      </div>
    );
  }

  if (!currentOrganization) return <LoadingState label="Loading organization…" />;

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar
        items={NAV_ITEMS}
        header={<span className="text-lg font-semibold text-primary">Aivoryx</span>}
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          onMenuClick={() => setIsSidebarOpen(true)}
          left={<OrganizationSwitcher />}
          right={<UserMenu />}
        />
        <main className="flex-1 overflow-y-auto overflow-x-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
