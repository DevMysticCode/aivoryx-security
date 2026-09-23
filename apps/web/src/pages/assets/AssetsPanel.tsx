import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../lib/api-client';
import { LoadingState } from '../../components/ui/LoadingState';
import { ErrorState } from '../../components/ui/ErrorState';
import { EmptyState } from '../../components/ui/EmptyState';
import { DataTable } from '../../components/ui/DataTable';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog';
import { PermissionGate } from '../../components/ui/PermissionGate';
import { NewAssetModal } from './NewAssetModal';
import type { Asset } from '../../types/api';

const SCANNER_SUPPORTED_ASSET_TYPES = new Set(['WEB']);

export function AssetsPanel({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [pendingAuthorization, setPendingAuthorization] = useState<Asset | null>(null);

  const query = useQuery({
    queryKey: ['assets', projectId],
    queryFn: () => apiClient.get<{ assets: Asset[] }>(`/api/v1/projects/${projectId}/assets`),
  });

  const confirmMutation = useMutation({
    mutationFn: (assetId: string) =>
      apiClient.patch<{ asset: Asset }>(`/api/v1/assets/${assetId}`, {
        authorizationConfirmed: true,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['assets', projectId] });
      setPendingAuthorization(null);
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <PermissionGate permission="asset:create">
          <Button size="sm" onClick={() => setIsCreateOpen(true)}>
            Add asset
          </Button>
        </PermissionGate>
      </div>

      {query.isLoading ? (
        <LoadingState label="Loading assets…" />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : !query.data || query.data.assets.length === 0 ? (
        <EmptyState
          title="No assets yet"
          description="Add a web application, API, or mobile app to test."
        />
      ) : (
        <DataTable
          rows={query.data.assets}
          rowKey={(asset) => asset.id}
          columns={[
            {
              header: 'Name',
              render: (asset) => <span className="font-medium text-foreground">{asset.name}</span>,
            },
            { header: 'Type', render: (asset) => <Badge tone="neutral">{asset.assetType}</Badge> },
            {
              header: 'Scanning',
              render: (asset) =>
                SCANNER_SUPPORTED_ASSET_TYPES.has(asset.assetType) ? (
                  <Badge tone="success">Available</Badge>
                ) : (
                  <Badge tone="neutral">Coming soon</Badge>
                ),
            },
            {
              header: 'Authorization',
              render: (asset) =>
                asset.authorizationConfirmed ? (
                  <Badge tone="success">Confirmed</Badge>
                ) : (
                  <PermissionGate
                    permission="asset:update"
                    fallback={<Badge tone="warning">Not confirmed</Badge>}
                  >
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setPendingAuthorization(asset)}
                    >
                      Confirm authorization
                    </Button>
                  </PermissionGate>
                ),
            },
          ]}
        />
      )}

      <NewAssetModal
        projectId={projectId}
        open={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
      />

      <ConfirmationDialog
        open={pendingAuthorization !== null}
        title="Confirm testing authorization"
        description={`I confirm that I am authorized to run security assessments against "${pendingAuthorization?.name}", and that this asset is owned by or under contract with my organization. This confirmation is required before any assessment can run against it.`}
        confirmLabel="Confirm authorization"
        isLoading={confirmMutation.isPending}
        onConfirm={() => pendingAuthorization && confirmMutation.mutate(pendingAuthorization.id)}
        onCancel={() => setPendingAuthorization(null)}
      />
    </div>
  );
}
