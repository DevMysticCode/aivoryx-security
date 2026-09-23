import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../lib/api-client';
import { LoadingState } from '../../components/ui/LoadingState';
import { ErrorState } from '../../components/ui/ErrorState';
import { EmptyState } from '../../components/ui/EmptyState';
import { DataTable } from '../../components/ui/DataTable';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import type { DiscoveredUrl } from '../../types/api';

const PAGE_SIZE = 25;

export function DiscoveryPanel({ assessmentId }: { assessmentId: string }) {
  const [offset, setOffset] = useState(0);

  const query = useQuery({
    queryKey: ['discovered-urls', assessmentId, offset],
    queryFn: () =>
      apiClient.get<{
        discoveredUrls: DiscoveredUrl[];
        pagination: { total: number; limit: number; offset: number };
      }>(`/api/v1/assessments/${assessmentId}/discovered-urls`, { limit: PAGE_SIZE, offset }),
  });

  if (query.isLoading) return <LoadingState label="Loading discovered attack surface…" />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (!query.data || query.data.discoveredUrls.length === 0) {
    return (
      <EmptyState
        title="Nothing discovered yet"
        description="Discovery runs automatically as part of a Web assessment — check back once it's running."
      />
    );
  }

  const { discoveredUrls, pagination } = query.data;

  return (
    <div className="flex flex-col gap-3">
      <DataTable
        rows={discoveredUrls}
        rowKey={(row) => row.id}
        columns={[
          {
            header: 'URL',
            render: (row) => <span className="break-all font-mono text-xs">{row.url}</span>,
          },
          { header: 'Type', render: (row) => <Badge tone="neutral">{row.urlType}</Badge> },
          { header: 'Method', render: (row) => row.discoveryMethod },
          { header: 'Status', render: (row) => row.statusCode ?? '—' },
          { header: 'Depth', render: (row) => row.depth },
        ]}
      />
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {pagination.offset + 1}–{Math.min(pagination.offset + pagination.limit, pagination.total)}{' '}
          of {pagination.total}
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
            disabled={offset + PAGE_SIZE >= pagination.total}
            onClick={() => setOffset((current) => current + PAGE_SIZE)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
