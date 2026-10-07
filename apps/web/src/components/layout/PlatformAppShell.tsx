import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar, type SidebarItem } from './Sidebar';
import { TopBar } from './TopBar';
import { UserMenu } from './UserMenu';

const NAV_ITEMS: SidebarItem[] = [
  { label: 'Dashboard', to: '/platform', end: true },
  { label: 'Organizations', to: '/platform/organizations' },
];

export function PlatformAppShell() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar
        items={NAV_ITEMS}
        header={
          <span className="text-lg font-semibold text-secondary">
            Aivoryx <span className="text-muted-foreground">Platform</span>
          </span>
        }
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          onMenuClick={() => setIsSidebarOpen(true)}
          left={
            <span className="text-sm font-medium text-muted-foreground">
              Platform Administration
            </span>
          }
          right={<UserMenu />}
        />
        <main className="flex-1 overflow-y-auto overflow-x-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
