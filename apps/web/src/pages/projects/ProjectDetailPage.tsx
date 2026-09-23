import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../lib/api-client';
import { PageContainer } from '../../components/layout/PageContainer';
import { PageHeader } from '../../components/layout/PageHeader';
import { LoadingState } from '../../components/ui/LoadingState';
import { ErrorState } from '../../components/ui/ErrorState';
import { Card, CardContent } from '../../components/ui/Card';
import clsx from 'clsx';
import { AssetsPanel } from '../assets/AssetsPanel';
import type { Project } from '../../types/api';

type Tab = 'overview' | 'assets';

export function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [tab, setTab] = useState<Tab>('overview');

  const query = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => apiClient.get<{ project: Project }>(`/api/v1/projects/${projectId}`),
    enabled: Boolean(projectId),
  });

  if (query.isLoading) return <LoadingState label="Loading project…" />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (!query.data) return null;

  const { project } = query.data;

  return (
    <PageContainer>
      <PageHeader title={project.name} description={project.description ?? undefined} />

      <div className="flex gap-1 border-b border-border">
        {(['overview', 'assets'] as const).map((value) => (
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
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <dt className="text-muted-foreground">Slug</dt>
              <dd className="text-foreground">{project.slug}</dd>
              <dt className="text-muted-foreground">Status</dt>
              <dd className="text-foreground">{project.status}</dd>
              <dt className="text-muted-foreground">Created</dt>
              <dd className="text-foreground">{new Date(project.createdAt).toLocaleString()}</dd>
            </dl>
          </CardContent>
        </Card>
      )}

      {tab === 'assets' && <AssetsPanel projectId={project.id} />}
    </PageContainer>
  );
}
