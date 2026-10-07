import type { ReactNode } from 'react';

export function TopBar({
  left,
  right,
  onMenuClick,
}: {
  left?: ReactNode;
  right?: ReactNode;
  onMenuClick?: () => void;
}) {
  return (
    <header className="flex h-16 items-center justify-between gap-3 border-b border-border bg-card px-4 sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        {onMenuClick && (
          <button
            type="button"
            onClick={onMenuClick}
            aria-label="Open navigation menu"
            className="rounded-md p-2 text-foreground hover:bg-muted lg:hidden"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path
                d="M2.5 5h15M2.5 10h15M2.5 15h15"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        )}
        <div className="min-w-0 truncate">{left}</div>
      </div>
      <div className="flex shrink-0 items-center gap-3">{right}</div>
    </header>
  );
}
