import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { apiClient } from '../../lib/api-client';
import { PageContainer } from '../../components/layout/PageContainer';
import { PageHeader } from '../../components/layout/PageHeader';
import { LoadingState } from '../../components/ui/LoadingState';
import { ErrorState, errorMessage } from '../../components/ui/ErrorState';
import { Card, CardContent } from '../../components/ui/Card';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { Button } from '../../components/ui/Button';
import { Alert } from '../../components/ui/Alert';
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog';
import { PermissionGate } from '../../components/ui/PermissionGate';
import { FindingsPanel } from './FindingsPanel';
import { DiscoveryPanel } from './DiscoveryPanel';
import type { Assessment } from '../../types/api';

type Tab = 'overview' | 'findings' | 'discovery';

const CANCELLABLE_STATUSES = new Set(['QUEUED', 'RUNNING']);

export function AssessmentDetailPage() {
  const { assessmentId } = useParams<{ assessmentId: string }>();
  const [tab, setTab] = useState<Tab>('overview');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['assessment', assessmentId],
    queryFn: () => apiClient.get<{ assessment: Assessment }>(`/api/v1/assessments/${assessmentId}`),
    enabled: Boolean(assessmentId),
    // Assessments are queued/running for real work — keep this fresh without
    // requiring a manual refresh, but only while it can still change.
    refetchInterval: (query) => {
      const status = query.state.data?.assessment.status;
      return status === 'QUEUED' || status === 'RUNNING' ? 3000 : false;
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () =>
      apiClient.post<{ assessment: Assessment }>(`/api/v1/assessments/${assessmentId}/cancel`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['assessment', assessmentId] });
      setConfirmCancel(false);
    },
  });

  if (query.isLoading) return <LoadingState label="Loading assessment…" />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (!query.data) return null;

  const { assessment } = query.data;

  return (
    <PageContainer>
      <PageHeader
        title={`${assessment.assessmentType} assessment`}
        description={`Created ${new Date(assessment.createdAt).toLocaleString()}`}
        actions={
          CANCELLABLE_STATUSES.has(assessment.status) && (
            <PermissionGate permission="assessment:cancel">
              <Button variant="outline" onClick={() => setConfirmCancel(true)}>
                Cancel assessment
              </Button>
            </PermissionGate>
          )
        }
      />

      <div className="flex gap-1 border-b border-border">
        {(['overview', 'findings', 'discovery'] as const).map((value) => (
          <button
            key={value}
            onClick={() => setTab(value)}
            className={clsx(
              'border-b-2 px-4 py-2 text-sm font-medium capitalize transition-colors',
              tab === value
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {value}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <Card>
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <StatusBadge status={assessment.status} />
              {(assessment.status === 'QUEUED' || assessment.status === 'RUNNING') && (
                <span className="text-sm text-muted-foreground">
                  {assessment.status === 'QUEUED'
                    ? 'Waiting to start — scope validation runs first.'
                    : 'In progress — discovery and passive analysis run for Web assessments.'}
                </span>
              )}
            </div>

            {assessment.errorMessage && <Alert tone="destructive">{assessment.errorMessage}</Alert>}

            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <dt className="text-muted-foreground">Type</dt>
              <dd className="text-foreground">{assessment.assessmentType}</dd>
              <dt className="text-muted-foreground">Started</dt>
              <dd className="text-foreground">
                {assessment.startedAt ? new Date(assessment.startedAt).toLocaleString() : '—'}
              </dd>
              <dt className="text-muted-foreground">Completed</dt>
              <dd className="text-foreground">
                {assessment.completedAt ? new Date(assessment.completedAt).toLocaleString() : '—'}
              </dd>
              <dt className="text-muted-foreground">Cancelled</dt>
              <dd className="text-foreground">
                {assessment.cancelledAt ? new Date(assessment.cancelledAt).toLocaleString() : '—'}
              </dd>
            </dl>
          </CardContent>
        </Card>
      )}

      {tab === 'findings' && assessmentId && <FindingsPanel assessmentId={assessmentId} />}
      {tab === 'discovery' && assessmentId && <DiscoveryPanel assessmentId={assessmentId} />}

      {cancelMutation.isError && (
        <Alert tone="destructive">{errorMessage(cancelMutation.error)}</Alert>
      )}

      <ConfirmationDialog
        open={confirmCancel}
        title="Cancel this assessment?"
        description="This will stop the assessment. This action cannot be undone."
        confirmLabel="Cancel assessment"
        isDestructive
        isLoading={cancelMutation.isPending}
        onConfirm={() => cancelMutation.mutate()}
        onCancel={() => setConfirmCancel(false)}
      />
    </PageContainer>
  );
}
