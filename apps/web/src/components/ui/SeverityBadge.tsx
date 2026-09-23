import { Badge } from './Badge';
import type { FindingSeverity } from '../../types/api';

const SEVERITY_TONE: Record<FindingSeverity, 'neutral' | 'info' | 'warning' | 'destructive'> = {
  INFO: 'info',
  LOW: 'neutral',
  MEDIUM: 'warning',
  HIGH: 'destructive',
  CRITICAL: 'destructive',
};

export function SeverityBadge({ severity }: { severity: FindingSeverity }) {
  return (
    <Badge
      tone={SEVERITY_TONE[severity]}
      className={severity === 'CRITICAL' ? 'font-semibold' : undefined}
    >
      {severity}
    </Badge>
  );
}
