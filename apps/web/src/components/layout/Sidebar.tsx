import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import clsx from 'clsx';

export interface SidebarItem {
  label: string;
  to: string;
  icon?: ReactNode;
  end?: boolean;
}

interface SidebarProps {
  items: SidebarItem[];
  header: ReactNode;
}

export function Sidebar({ items, header }: SidebarProps) {
  return (
    <aside className="flex h-screen w-64 shrink-0 flex-col border-r border-border bg-card">
      <div className="flex h-16 items-center border-b border-border px-5">{header}</div>
      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-3">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )
            }
          >
            {item.icon}
            {item.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
