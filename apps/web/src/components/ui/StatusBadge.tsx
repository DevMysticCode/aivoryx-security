import { Badge } from './Badge';
import type { AssessmentStatus } from '../../types/api';

const STATUS_TONE: Record<AssessmentStatus, 'neutral' | 'info' | 'success' | 'destructive'> = {
  QUEUED: 'neutral',
  RUNNING: 'info',
  COMPLETED: 'success',
  FAILED: 'destructive',
  CANCELLED: 'neutral',
};

const STATUS_LABEL: Record<AssessmentStatus, string> = {
  QUEUED: 'Queued',
  RUNNING: 'Running',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
};

export function StatusBadge({ status }: { status: AssessmentStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}
