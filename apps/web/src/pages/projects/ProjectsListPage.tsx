import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../../lib/api-client';
import { useOrganization } from '../../organization/OrganizationContext';
import { PageContainer } from '../../components/layout/PageContainer';
import { PageHeader } from '../../components/layout/PageHeader';
import { LoadingState } from '../../components/ui/LoadingState';
import { ErrorState, errorMessage } from '../../components/ui/ErrorState';
import { EmptyState } from '../../components/ui/EmptyState';
import { DataTable } from '../../components/ui/DataTable';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { FormField } from '../../components/ui/FormField';
import { TextInput } from '../../components/ui/TextInput';
import { Alert } from '../../components/ui/Alert';
import { PermissionGate } from '../../components/ui/PermissionGate';
import type { Project } from '../../types/api';

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export function ProjectsListPage() {
  const { currentOrganization } = useOrganization();
  const organizationId = currentOrganization?.id;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);

  const query = useQuery({
    queryKey: ['projects', organizationId],
    queryFn: () => apiClient.get<{ projects: Project[] }>('/api/v1/projects', { organizationId }),
    enabled: Boolean(organizationId),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      apiClient.post<{ project: Project }>('/api/v1/projects', { organizationId, name, slug }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects', organizationId] });
      setIsCreateOpen(false);
      setName('');
      setSlug('');
      setSlugTouched(false);
    },
  });

  return (
    <PageContainer>
      <PageHeader
        title="Projects"
        description="Group related assets and assessments together."
        actions={
          <PermissionGate permission="project:create">
            <Button onClick={() => setIsCreateOpen(true)}>New project</Button>
          </PermissionGate>
        }
      />

      {query.isLoading ? (
        <LoadingState label="Loading projects…" />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : !query.data || query.data.projects.length === 0 ? (
        <EmptyState
          title="No projects yet"
          description="Create a project to start onboarding assets."
        />
      ) : (
        <DataTable
          rows={query.data.projects}
          rowKey={(project) => project.id}
          onRowClick={(project) => navigate(`/app/projects/${project.id}`)}
          columns={[
            {
              header: 'Name',
              render: (project) => (
                <span className="font-medium text-foreground">{project.name}</span>
              ),
            },
            { header: 'Slug', render: (project) => project.slug },
            {
              header: 'Status',
              render: (project) => (
                <Badge tone={project.status === 'active' ? 'success' : 'neutral'}>
                  {project.status}
                </Badge>
              ),
            },
            {
              header: 'Created',
              render: (project) => new Date(project.createdAt).toLocaleDateString(),
            },
          ]}
        />
      )}

      <Modal open={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="New project">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            createMutation.mutate();
          }}
          className="flex flex-col gap-4"
        >
          <FormField label="Name" htmlFor="project-name">
            <TextInput
              id="project-name"
              required
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                if (!slugTouched) setSlug(slugify(event.target.value));
              }}
            />
          </FormField>
          <FormField label="Slug" htmlFor="project-slug">
            <TextInput
              id="project-slug"
              required
              value={slug}
              onChange={(event) => {
                setSlugTouched(true);
                setSlug(event.target.value);
              }}
            />
          </FormField>
          {createMutation.isError && (
            <Alert tone="destructive">{errorMessage(createMutation.error)}</Alert>
          )}
          <Button type="submit" isLoading={createMutation.isPending}>
            Create project
          </Button>
        </form>
      </Modal>
    </PageContainer>
  );
}
