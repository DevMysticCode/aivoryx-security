import { useQuery, useQueries } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiClient } from '../../lib/api-client';
import { useOrganization } from '../../organization/OrganizationContext';
import { PageContainer } from '../../components/layout/PageContainer';
import { PageHeader } from '../../components/layout/PageHeader';
import { Card, CardContent } from '../../components/ui/Card';
import { LoadingState } from '../../components/ui/LoadingState';
import { ErrorState } from '../../components/ui/ErrorState';
import type { Assessment, Project } from '../../types/api';

export function TenantDashboardPage() {
  const { currentOrganization } = useOrganization();
  const organizationId = currentOrganization?.id;

  const projectsQuery = useQuery({
    queryKey: ['projects', organizationId],
    queryFn: () => apiClient.get<{ projects: Project[] }>('/api/v1/projects', { organizationId }),
    enabled: Boolean(organizationId),
  });

  const projects = projectsQuery.data?.projects ?? [];

  // Real, per-project counts fanned out from the actual list-assessments
  // endpoint (there is no organization-wide assessments endpoint) — never a
  // fabricated or placeholder number.
  const assessmentQueries = useQueries({
    queries: projects.map((project) => ({
      queryKey: ['assessments', project.id],
      queryFn: () =>
        apiClient.get<{ assessments: Assessment[] }>(`/api/v1/projects/${project.id}/assessments`),
      enabled: Boolean(organizationId),
    })),
  });

  const allAssessments = assessmentQueries.flatMap((q) => q.data?.assessments ?? []);
  const assessmentsLoading = assessmentQueries.some((q) => q.isLoading);
  const runningCount = allAssessments.filter(
    (a) => a.status === 'RUNNING' || a.status === 'QUEUED',
  ).length;

  return (
    <PageContainer>
      <PageHeader
        title="Dashboard"
        description={`Overview for ${currentOrganization?.displayName || currentOrganization?.name || 'your organization'}.`}
      />

      {projectsQuery.isLoading ? (
        <LoadingState label="Loading dashboard…" />
      ) : projectsQuery.isError ? (
        <ErrorState error={projectsQuery.error} onRetry={() => void projectsQuery.refetch()} />
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Card>
            <CardContent>
              <p className="text-sm text-muted-foreground">Projects</p>
              <p className="mt-1 text-2xl font-semibold text-foreground">{projects.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <p className="text-sm text-muted-foreground">Assessments</p>
              <p className="mt-1 text-2xl font-semibold text-foreground">
                {assessmentsLoading ? '…' : allAssessments.length}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <p className="text-sm text-muted-foreground">In progress</p>
              <p className="mt-1 text-2xl font-semibold text-foreground">
                {assessmentsLoading ? '…' : runningCount}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="flex gap-3">
        <Link to="/app/projects" className="text-sm font-medium text-primary hover:underline">
          View projects →
        </Link>
        <Link to="/app/assessments" className="text-sm font-medium text-primary hover:underline">
          View assessments →
        </Link>
      </div>
    </PageContainer>
  );
}
