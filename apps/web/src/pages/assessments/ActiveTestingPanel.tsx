import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../lib/api-client';
import { LoadingState } from '../../components/ui/LoadingState';
import { ErrorState } from '../../components/ui/ErrorState';
import { EmptyState } from '../../components/ui/EmptyState';
import { DataTable } from '../../components/ui/DataTable';
import { Card, CardContent } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import type {
  ActiveTestExecution,
  ActiveTestExecutionStatus,
  ActiveTestFailureReason,
  ActiveTestPlan,
  ActiveTestPlanStatus,
  ActiveTestSkipReason,
  AssessmentStatus,
} from '../../types/api';

const PAGE_SIZE = 25;

const PLAN_STATUS_TONE: Record<
  ActiveTestPlanStatus,
  'neutral' | 'info' | 'success' | 'destructive' | 'warning'
> = {
  RUNNING: 'info',
  COMPLETED: 'success',
  FAILED: 'destructive',
  CANCELLED: 'neutral',
  BUDGET_EXHAUSTED: 'warning',
  SKIPPED: 'neutral',
};

const PLAN_STATUS_LABEL: Record<ActiveTestPlanStatus, string> = {
  RUNNING: 'Running',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
  BUDGET_EXHAUSTED: 'Budget exhausted',
  SKIPPED: 'Skipped',
};

const EXECUTION_STATUS_TONE: Record<
  ActiveTestExecutionStatus,
  'neutral' | 'success' | 'destructive' | 'warning'
> = {
  COMPLETED: 'success',
  FAILED: 'destructive',
  CANCELLED: 'neutral',
  BUDGET_EXHAUSTED: 'warning',
  SKIPPED: 'neutral',
};

const SKIP_REASON_LABEL: Record<ActiveTestSkipReason, string> = {
  NO_ELIGIBLE_TARGETS: 'no eligible targets',
  NO_PARAMETERS: 'no parameters',
  UNSUPPORTED_CONTENT_TYPE: 'unsupported content type',
  LIMIT_REACHED: 'limit reached',
  UNSUPPORTED_ASSET_TYPE: 'unsupported asset type',
  MISSING_CAPABILITY: 'missing capability',
};

const FAILURE_REASON_LABEL: Record<ActiveTestFailureReason, string> = {
  NETWORK_ERROR: 'network error',
  SCOPE_REJECTED: 'scope rejected',
  SSRF_REJECTED: 'SSRF rejected',
  RATE_LIMITED: 'rate limited',
  INTERNAL_ERROR: 'internal error',
  INVALID_TEST_CONFIGURATION: 'invalid configuration',
};

function PlanStatusBadge({ status }: { status: ActiveTestPlanStatus }) {
  return <Badge tone={PLAN_STATUS_TONE[status]}>{PLAN_STATUS_LABEL[status]}</Badge>;
}

/**
 * The per-row "Result" indicator — deliberately distinct from the generic
 * execution Status badge (Batch 10 spec Part 20): a SKIPPED/FAILED
 * execution explains itself (its reason), not just a bare status word, and
 * a COMPLETED execution shows the actual security verdict rather than
 * requiring the viewer to cross-reference the Finding column.
 */
function ResultBadge({ execution }: { execution: ActiveTestExecution }) {
  if (execution.status === 'SKIPPED') {
    return (
      <Badge tone="neutral">
        Skipped{execution.skipReason ? `: ${SKIP_REASON_LABEL[execution.skipReason]}` : ''}
      </Badge>
    );
  }
  if (execution.status === 'FAILED') {
    return (
      <Badge tone="destructive">
        Failed{execution.failureReason ? `: ${FAILURE_REASON_LABEL[execution.failureReason]}` : ''}
      </Badge>
    );
  }
  if (execution.status === 'BUDGET_EXHAUSTED')
    return <Badge tone="warning">Budget exhausted</Badge>;
  if (execution.status === 'CANCELLED') return <Badge tone="neutral">Cancelled</Badge>;

  switch (execution.securityResult) {
    case 'FINDING':
      return <Badge tone="destructive">Finding</Badge>;
    case 'INCONCLUSIVE':
      return <Badge tone="warning">Inconclusive</Badge>;
    case 'NO_FINDING':
      return <Badge tone="success">No finding</Badge>;
    default:
      return <span className="text-muted-foreground">—</span>;
  }
}

export function ActiveTestingPanel({
  assessmentId,
  assessmentStatus,
}: {
  assessmentId: string;
  assessmentStatus: AssessmentStatus;
}) {
  const navigate = useNavigate();
  const [offset, setOffset] = useState(0);

  const planQuery = useQuery({
    queryKey: ['active-test-plan', assessmentId],
    queryFn: () =>
      apiClient.get<{ activeTestPlan: ActiveTestPlan | null }>(
        `/api/v1/assessments/${assessmentId}/active-test-plan`,
      ),
    refetchInterval: (query) => {
      const status = query.state.data?.activeTestPlan?.status;
      return status === 'RUNNING' ? 3000 : false;
    },
  });

  const executionsQuery = useQuery({
    queryKey: ['active-test-executions', assessmentId, offset],
    queryFn: () =>
      apiClient.get<{
        activeTestExecutions: ActiveTestExecution[];
        pagination: { total: number; limit: number; offset: number };
      }>(`/api/v1/assessments/${assessmentId}/active-test-executions`, {
        limit: PAGE_SIZE,
        offset,
      }),
    enabled: Boolean(
      planQuery.data?.activeTestPlan && planQuery.data.activeTestPlan.status !== 'SKIPPED',
    ),
  });

  if (planQuery.isLoading) return <LoadingState label="Loading active testing status…" />;
  if (planQuery.isError) {
    return <ErrorState error={planQuery.error} onRetry={() => void planQuery.refetch()} />;
  }

  const plan = planQuery.data?.activeTestPlan ?? null;

  if (!plan) {
    const stillRunning = assessmentStatus === 'QUEUED' || assessmentStatus === 'RUNNING';
    return (
      <EmptyState
        title="Active testing has not run yet"
        description={
          stillRunning
            ? 'Active testing runs automatically after discovery and passive analysis finish — check back once the assessment is further along.'
            : 'Active testing did not run because an earlier phase of this assessment did not complete successfully.'
        }
      />
    );
  }

  if (plan.status === 'SKIPPED') {
    return (
      <EmptyState
        title="Active testing framework is ready"
        description="No active test modules are enabled for this assessment."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <PlanStatusBadge status={plan.status} />
            {plan.status === 'RUNNING' && (
              <span className="text-sm text-muted-foreground">In progress…</span>
            )}
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
            <dt className="text-muted-foreground">Requests used</dt>
            <dd className="text-foreground">
              {plan.requestsUsed} / {plan.requestBudget}
            </dd>
            <dt className="text-muted-foreground">Tests selected</dt>
            <dd className="text-foreground">{plan.testsSelectedCount}</dd>
            <dt className="text-muted-foreground">Completed</dt>
            <dd className="text-foreground">{plan.testsCompletedCount}</dd>
            <dt className="text-muted-foreground">Failed / skipped</dt>
            <dd className="text-foreground">
              {plan.testsFailedCount} / {plan.testsSkippedCount}
            </dd>
          </dl>
          {plan.errorMessage && <p className="text-sm text-destructive">{plan.errorMessage}</p>}
        </CardContent>
      </Card>

      {executionsQuery.isLoading && <LoadingState label="Loading test executions…" />}
      {executionsQuery.isError && (
        <ErrorState error={executionsQuery.error} onRetry={() => void executionsQuery.refetch()} />
      )}
      {executionsQuery.data && executionsQuery.data.activeTestExecutions.length === 0 && (
        <EmptyState
          title="No test executions yet"
          description="Active testing hasn't produced any execution records for this assessment yet."
        />
      )}
      {executionsQuery.data && executionsQuery.data.activeTestExecutions.length > 0 && (
        <div className="flex flex-col gap-3">
          <DataTable
            rows={executionsQuery.data.activeTestExecutions}
            rowKey={(row) => row.id}
            onRowClick={(row) => row.findings[0] && navigate(`/app/findings/${row.findings[0].id}`)}
            columns={[
              {
                header: 'Test',
                render: (row) => <span className="font-medium">{row.testId}</span>,
              },
              {
                header: 'Target',
                render: (row) => <span className="break-all font-mono text-xs">{row.target}</span>,
              },
              {
                header: 'Status',
                render: (row) => (
                  <Badge tone={EXECUTION_STATUS_TONE[row.status]}>{row.status}</Badge>
                ),
              },
              { header: 'Result', render: (row) => <ResultBadge execution={row} /> },
              { header: 'Requests', render: (row) => row.requestsUsed },
              {
                header: 'Finding',
                render: (row) => {
                  if (row.findings.length === 0) {
                    return <span className="text-muted-foreground">No finding</span>;
                  }
                  // Clicking the row (onRowClick below) navigates to the
                  // finding — this cell just names it so the viewer knows
                  // what they're about to open.
                  return (
                    <span className="text-primary underline-offset-2 hover:underline">
                      {row.findings.length === 1
                        ? row.findings[0]!.title
                        : `${row.findings.length} findings`}
                    </span>
                  );
                },
              },
            ]}
          />
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              {executionsQuery.data.pagination.offset + 1}–
              {Math.min(
                executionsQuery.data.pagination.offset + executionsQuery.data.pagination.limit,
                executionsQuery.data.pagination.total,
              )}{' '}
              of {executionsQuery.data.pagination.total}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={offset === 0}
                onClick={() => setOffset((current) => Math.max(0, current - PAGE_SIZE))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={offset + PAGE_SIZE >= executionsQuery.data.pagination.total}
                onClick={() => setOffset((current) => current + PAGE_SIZE)}
              >
                Next
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
