import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiClient } from '../../lib/api-client';
import { PageContainer } from '../../components/layout/PageContainer';
import { PageHeader } from '../../components/layout/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { LoadingState } from '../../components/ui/LoadingState';
import { ErrorState } from '../../components/ui/ErrorState';
import type { Organization, PlatformStats } from '../../types/api';

const STAT_LABELS: { key: keyof PlatformStats; label: string }[] = [
  { key: 'organizations', label: 'Organizations' },
  { key: 'activeOrganizations', label: 'Active organizations' },
  { key: 'users', label: 'Users' },
  { key: 'assessments', label: 'Assessments' },
  { key: 'runningAssessments', label: 'Running assessments' },
  { key: 'findings', label: 'Findings' },
];

export function PlatformDashboardPage() {
  const statsQuery = useQuery({
    queryKey: ['platform', 'stats'],
    queryFn: () => apiClient.get<{ stats: PlatformStats }>('/api/v1/platform/stats'),
  });

  const recentQuery = useQuery({
    queryKey: ['platform', 'organizations', 'recent'],
    queryFn: () =>
      apiClient.get<{ organizations: Organization[] }>('/api/v1/platform/organizations/recent'),
  });

  return (
    <PageContainer>
      <PageHeader
        title="Platform Dashboard"
        description="Real-time, platform-wide operating metrics."
      />

      {statsQuery.isLoading ? (
        <LoadingState label="Loading platform metrics…" />
      ) : statsQuery.isError ? (
        <ErrorState error={statsQuery.error} onRetry={() => void statsQuery.refetch()} />
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {STAT_LABELS.map(({ key, label }) => (
            <Card key={key}>
              <CardContent>
                <p className="text-sm text-muted-foreground">{label}</p>
                <p className="mt-1 text-2xl font-semibold text-foreground">
                  {statsQuery.data?.stats[key] ?? 0}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Recently created organizations</CardTitle>
        </CardHeader>
        <CardContent>
          {recentQuery.isLoading ? (
            <LoadingState label="Loading organizations…" />
          ) : recentQuery.isError ? (
            <ErrorState error={recentQuery.error} onRetry={() => void recentQuery.refetch()} />
          ) : recentQuery.data && recentQuery.data.organizations.length > 0 ? (
            <ul className="flex flex-col divide-y divide-border">
              {recentQuery.data.organizations.map((org) => (
                <li key={org.id} className="flex items-center justify-between py-3 text-sm">
                  <span className="font-medium text-foreground">{org.displayName || org.name}</span>
                  <span className="text-muted-foreground">{org.slug}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No organizations yet.</p>
          )}
          <Link
            to="/platform/organizations"
            className="mt-4 inline-block text-sm font-medium text-primary hover:underline"
          >
            View all organizations →
          </Link>
        </CardContent>
      </Card>
    </PageContainer>
  );
}
