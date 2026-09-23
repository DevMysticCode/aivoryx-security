import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../../lib/api-client';
import { LoadingState } from '../../components/ui/LoadingState';
import { ErrorState } from '../../components/ui/ErrorState';
import { EmptyState } from '../../components/ui/EmptyState';
import { DataTable } from '../../components/ui/DataTable';
import { SeverityBadge } from '../../components/ui/SeverityBadge';
import { Badge } from '../../components/ui/Badge';
import type { Finding } from '../../types/api';

export function FindingsPanel({ assessmentId }: { assessmentId: string }) {
  const navigate = useNavigate();

  const query = useQuery({
    queryKey: ['assessment-findings', assessmentId],
    queryFn: () =>
      apiClient.get<{ findings: Finding[] }>(`/api/v1/assessments/${assessmentId}/findings`),
  });

  if (query.isLoading) return <LoadingState label="Loading findings…" />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (!query.data || query.data.findings.length === 0) {
    return (
      <EmptyState
        title="No findings"
        description="No findings have been recorded for this assessment yet."
      />
    );
  }

  const sorted = [...query.data.findings].sort(
    (a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity],
  );

  return (
    <DataTable
      rows={sorted}
      rowKey={(finding) => finding.id}
      onRowClick={(finding) => navigate(`/app/findings/${finding.id}`)}
      columns={[
        { header: 'Severity', render: (finding) => <SeverityBadge severity={finding.severity} /> },
        {
          header: 'Title',
          render: (finding) => <span className="font-medium text-foreground">{finding.title}</span>,
        },
        {
          header: 'Target',
          render: (finding) => <span className="font-mono text-xs">{finding.target}</span>,
        },
        { header: 'Status', render: (finding) => <Badge tone="neutral">{finding.status}</Badge> },
      ]}
    />
  );
}

const SEVERITY_ORDER: Record<Finding['severity'], number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
  INFO: 0,
};
