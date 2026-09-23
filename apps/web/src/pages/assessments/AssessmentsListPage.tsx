import { useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../../lib/api-client';
import { useOrganization } from '../../organization/OrganizationContext';
import { PageContainer } from '../../components/layout/PageContainer';
import { PageHeader } from '../../components/layout/PageHeader';
import { LoadingState } from '../../components/ui/LoadingState';
import { ErrorState } from '../../components/ui/ErrorState';
import { EmptyState } from '../../components/ui/EmptyState';
import { DataTable } from '../../components/ui/DataTable';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { Button } from '../../components/ui/Button';
import { PermissionGate } from '../../components/ui/PermissionGate';
import { NewAssessmentModal } from './NewAssessmentModal';
import type { Assessment, Project } from '../../types/api';

export function AssessmentsListPage() {
  const { currentOrganization } = useOrganization();
  const organizationId = currentOrganization?.id;
  const navigate = useNavigate();
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const projectsQuery = useQuery({
    queryKey: ['projects', organizationId],
    queryFn: () => apiClient.get<{ projects: Project[] }>('/api/v1/projects', { organizationId }),
    enabled: Boolean(organizationId),
  });

  const projects = projectsQuery.data?.projects ?? [];

  const assessmentQueries = useQueries({
    queries: projects.map((project) => ({
      queryKey: ['assessments', project.id],
      queryFn: () =>
        apiClient.get<{ assessments: Assessment[] }>(`/api/v1/projects/${project.id}/assessments`),
    })),
  });

  const isLoading = projectsQuery.isLoading || assessmentQueries.some((q) => q.isLoading);
  const rows = projects.flatMap((project, index) =>
    (assessmentQueries[index]?.data?.assessments ?? []).map((assessment) => ({
      assessment,
      projectName: project.name,
    })),
  );

  return (
    <PageContainer>
      <PageHeader
        title="Assessments"
        description="Security assessments across every project in this organization."
        actions={
          <PermissionGate permission="assessment:create">
            <Button onClick={() => setIsCreateOpen(true)}>New assessment</Button>
          </PermissionGate>
        }
      />

      {isLoading ? (
        <LoadingState label="Loading assessments…" />
      ) : projectsQuery.isError ? (
        <ErrorState error={projectsQuery.error} onRetry={() => void projectsQuery.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No assessments yet"
          description="Start an assessment against an authorized asset to see results here."
        />
      ) : (
        <DataTable
          rows={rows}
          rowKey={({ assessment }) => assessment.id}
          onRowClick={({ assessment }) => navigate(`/app/assessments/${assessment.id}`)}
          columns={[
            { header: 'Project', render: ({ projectName }) => projectName },
            { header: 'Type', render: ({ assessment }) => assessment.assessmentType },
            {
              header: 'Status',
              render: ({ assessment }) => <StatusBadge status={assessment.status} />,
            },
            {
              header: 'Started',
              render: ({ assessment }) =>
                assessment.startedAt ? new Date(assessment.startedAt).toLocaleString() : '—',
            },
          ]}
        />
      )}

      <NewAssessmentModal open={isCreateOpen} onClose={() => setIsCreateOpen(false)} />
    </PageContainer>
  );
}
