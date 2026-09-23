import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../lib/api-client';
import { Modal } from '../../components/ui/Modal';
import { FormField } from '../../components/ui/FormField';
import { TextInput } from '../../components/ui/TextInput';
import { Select } from '../../components/ui/Select';
import { Button } from '../../components/ui/Button';
import { Alert } from '../../components/ui/Alert';
import { errorMessage } from '../../components/ui/ErrorState';
import type { Asset, AssetType } from '../../types/api';

export function NewAssetModal({
  projectId,
  open,
  onClose,
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [assetType, setAssetType] = useState<AssetType>('WEB');
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [packageName, setPackageName] = useState('');
  const [bundleId, setBundleId] = useState('');

  const mutation = useMutation({
    mutationFn: () => {
      const config: Record<string, unknown> =
        assetType === 'WEB' || assetType === 'API'
          ? { baseUrl }
          : assetType === 'ANDROID'
            ? { packageName }
            : { bundleId };
      return apiClient.post<{ asset: Asset }>(`/api/v1/projects/${projectId}/assets`, {
        assetType,
        name,
        config,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['assets', projectId] });
      reset();
      onClose();
    },
  });

  function reset() {
    setName('');
    setBaseUrl('');
    setPackageName('');
    setBundleId('');
  }

  return (
    <Modal open={open} onClose={onClose} title="New asset">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
        className="flex flex-col gap-4"
      >
        <FormField label="Asset type" htmlFor="asset-type">
          <Select
            id="asset-type"
            value={assetType}
            onChange={(event) => setAssetType(event.target.value as AssetType)}
          >
            <option value="WEB">Web application</option>
            <option value="API">API</option>
            <option value="ANDROID">Android app</option>
            <option value="IOS">iOS app</option>
          </Select>
        </FormField>
        <FormField label="Name" htmlFor="asset-name">
          <TextInput
            id="asset-name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </FormField>
        {(assetType === 'WEB' || assetType === 'API') && (
          <FormField label="Base URL" htmlFor="asset-base-url" hint="https://example.com">
            <TextInput
              id="asset-base-url"
              type="url"
              required
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
            />
          </FormField>
        )}
        {assetType === 'ANDROID' && (
          <FormField label="Package name" htmlFor="asset-package" hint="com.example.app">
            <TextInput
              id="asset-package"
              required
              value={packageName}
              onChange={(event) => setPackageName(event.target.value)}
            />
          </FormField>
        )}
        {assetType === 'IOS' && (
          <FormField label="Bundle ID" htmlFor="asset-bundle" hint="com.example.app">
            <TextInput
              id="asset-bundle"
              required
              value={bundleId}
              onChange={(event) => setBundleId(event.target.value)}
            />
          </FormField>
        )}
        {(assetType === 'API' || assetType === 'ANDROID' || assetType === 'IOS') && (
          <Alert tone="info">
            Onboarding is supported for this asset type, but automated security testing for it is
            not available yet — only Web application assessments run today.
          </Alert>
        )}
        {mutation.isError && <Alert tone="destructive">{errorMessage(mutation.error)}</Alert>}
        <Button type="submit" isLoading={mutation.isPending}>
          Add asset
        </Button>
      </form>
    </Modal>
  );
}
