import type { ReactNode } from 'react';
import clsx from 'clsx';

type AlertTone = 'info' | 'warning' | 'destructive' | 'success';

const TONE_CLASSES: Record<AlertTone, string> = {
  info: 'border-info/30 bg-info/10 text-info',
  warning: 'border-warning/30 bg-warning/10 text-warning',
  destructive: 'border-destructive/30 bg-destructive/10 text-destructive',
  success: 'border-success/30 bg-success/10 text-success',
};

export function Alert({ tone = 'info', children }: { tone?: AlertTone; children: ReactNode }) {
  return (
    <div role="alert" className={clsx('rounded-md border p-3 text-sm', TONE_CLASSES[tone])}>
      {children}
    </div>
  );
}
