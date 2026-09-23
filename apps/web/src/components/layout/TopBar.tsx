import type { ReactNode } from 'react';

export function TopBar({ left, right }: { left?: ReactNode; right?: ReactNode }) {
  return (
    <header className="flex h-16 items-center justify-between border-b border-border bg-card px-6">
      <div className="flex items-center gap-3">{left}</div>
      <div className="flex items-center gap-3">{right}</div>
    </header>
  );
}
