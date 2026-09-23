import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../lib/api-client';
import { PageContainer } from '../../components/layout/PageContainer';
import { PageHeader } from '../../components/layout/PageHeader';
import { LoadingState } from '../../components/ui/LoadingState';
import { ErrorState } from '../../components/ui/ErrorState';
import { EmptyState } from '../../components/ui/EmptyState';
import { DataTable } from '../../components/ui/DataTable';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import type { Organization } from '../../types/api';

export function PlatformOrganizationsPage() {
  const [selected, setSelected] = useState<Organization | null>(null);

  const query = useQuery({
    queryKey: ['platform', 'organizations', 'all'],
    queryFn: () => apiClient.get<{ organizations: Organization[] }>('/api/v1/organizations'),
  });

  return (
    <PageContainer>
      <PageHeader title="Organizations" description="Every tenant organization on the platform." />

      {query.isLoading ? (
        <LoadingState label="Loading organizations…" />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : !query.data || query.data.organizations.length === 0 ? (
        <EmptyState
          title="No organizations yet"
          description="No tenant has been created on this platform yet."
        />
      ) : (
        <DataTable
          rows={query.data.organizations}
          rowKey={(org) => org.id}
          onRowClick={setSelected}
          columns={[
            {
              header: 'Name',
              render: (org) => (
                <span className="font-medium text-foreground">{org.displayName || org.name}</span>
              ),
            },
            { header: 'Slug', render: (org) => org.slug },
            {
              header: 'Status',
              render: (org) => (
                <Badge tone={org.status === 'active' ? 'success' : 'neutral'}>{org.status}</Badge>
              ),
            },
            { header: 'Created', render: (org) => new Date(org.createdAt).toLocaleDateString() },
          ]}
        />
      )}

      <Modal
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected?.name ?? ''}
      >
        {selected && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <dt className="text-muted-foreground">Slug</dt>
            <dd className="text-foreground">{selected.slug}</dd>
            <dt className="text-muted-foreground">Status</dt>
            <dd className="text-foreground">{selected.status}</dd>
            <dt className="text-muted-foreground">Website</dt>
            <dd className="text-foreground">{selected.website || '—'}</dd>
            <dt className="text-muted-foreground">Industry</dt>
            <dd className="text-foreground">{selected.industry || '—'}</dd>
            <dt className="text-muted-foreground">Contact email</dt>
            <dd className="text-foreground">{selected.contactEmail || '—'}</dd>
            <dt className="text-muted-foreground">Created</dt>
            <dd className="text-foreground">{new Date(selected.createdAt).toLocaleString()}</dd>
          </dl>
        )}
      </Modal>
    </PageContainer>
  );
}
