import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../../lib/api-client';
import { useOrganization } from '../../organization/OrganizationContext';
import { Modal } from '../../components/ui/Modal';
import { FormField } from '../../components/ui/FormField';
import { Select } from '../../components/ui/Select';
import { Checkbox } from '../../components/ui/Checkbox';
import { Button } from '../../components/ui/Button';
import { Alert } from '../../components/ui/Alert';
import { errorMessage } from '../../components/ui/ErrorState';
import type { Asset, AssessmentType, Assessment, Project } from '../../types/api';
import { SUPPORTED_ASSESSMENT_TYPES } from '../../types/api';

const ASSET_TYPE_COMPATIBILITY: Record<Asset['assetType'], AssessmentType[]> = {
  WEB: ['WEB', 'API'],
  API: ['API'],
  ANDROID: ['ANDROID_STATIC', 'ANDROID_DYNAMIC', 'API'],
  IOS: ['IOS_STATIC', 'IOS_DYNAMIC', 'API'],
};

export function NewAssessmentModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { currentOrganization } = useOrganization();
  const organizationId = currentOrganization?.id;
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [projectId, setProjectId] = useState('');
  const [assetId, setAssetId] = useState('');
  const [assessmentType, setAssessmentType] = useState<AssessmentType>('WEB');
  const [authorizationChecked, setAuthorizationChecked] = useState(false);

  const projectsQuery = useQuery({
    queryKey: ['projects', organizationId],
    queryFn: () => apiClient.get<{ projects: Project[] }>('/api/v1/projects', { organizationId }),
    enabled: open && Boolean(organizationId),
  });

  const assetsQuery = useQuery({
    queryKey: ['assets', projectId],
    queryFn: () => apiClient.get<{ assets: Asset[] }>(`/api/v1/projects/${projectId}/assets`),
    enabled: open && Boolean(projectId),
  });

  const selectedAsset = assetsQuery.data?.assets.find((asset) => asset.id === assetId) ?? null;
  const compatibleTypes = useMemo(
    () => (selectedAsset ? ASSET_TYPE_COMPATIBILITY[selectedAsset.assetType] : []),
    [selectedAsset],
  );
  const needsAuthorization = selectedAsset ? !selectedAsset.authorizationConfirmed : false;

  const confirmAuthorizationMutation = useMutation({
    mutationFn: (id: string) =>
      apiClient.patch<{ asset: Asset }>(`/api/v1/assets/${id}`, { authorizationConfirmed: true }),
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      if (needsAuthorization && selectedAsset) {
        await confirmAuthorizationMutation.mutateAsync(selectedAsset.id);
      }
      return apiClient.post<{ assessment: Assessment }>(
        `/api/v1/projects/${projectId}/assessments`,
        { assetId, assessmentType },
      );
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['assessments'] });
      onClose();
      navigate(`/app/assessments/${result.assessment.id}`);
    },
  });

  const canSubmit = useMemo(
    () =>
      Boolean(projectId) &&
      Boolean(assetId) &&
      SUPPORTED_ASSESSMENT_TYPES.includes(assessmentType) &&
      compatibleTypes.includes(assessmentType) &&
      (!needsAuthorization || authorizationChecked),
    [projectId, assetId, assessmentType, compatibleTypes, needsAuthorization, authorizationChecked],
  );

  return (
    <Modal open={open} onClose={onClose} title="New assessment">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) createMutation.mutate();
        }}
        className="flex flex-col gap-4"
      >
        <FormField label="Project" htmlFor="assessment-project">
          <Select
            id="assessment-project"
            required
            value={projectId}
            onChange={(event) => {
              setProjectId(event.target.value);
              setAssetId('');
            }}
          >
            <option value="">Select a project…</option>
            {projectsQuery.data?.projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </Select>
        </FormField>

        {projectId && (
          <FormField label="Asset" htmlFor="assessment-asset">
            <Select
              id="assessment-asset"
              required
              value={assetId}
              onChange={(event) => {
                setAssetId(event.target.value);
                setAuthorizationChecked(false);
              }}
            >
              <option value="">Select an asset…</option>
              {assetsQuery.data?.assets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.name} ({asset.assetType})
                </option>
              ))}
            </Select>
          </FormField>
        )}

        {selectedAsset && (
          <FormField label="Assessment type" htmlFor="assessment-type">
            <Select
              id="assessment-type"
              value={assessmentType}
              onChange={(event) => setAssessmentType(event.target.value as AssessmentType)}
            >
              {compatibleTypes.map((type) => (
                <option
                  key={type}
                  value={type}
                  disabled={!SUPPORTED_ASSESSMENT_TYPES.includes(type)}
                >
                  {type} {SUPPORTED_ASSESSMENT_TYPES.includes(type) ? '' : '(coming soon)'}
                </option>
              ))}
            </Select>
          </FormField>
        )}

        {selectedAsset && !SUPPORTED_ASSESSMENT_TYPES.includes(assessmentType) && (
          <Alert tone="warning">
            Automated testing for {assessmentType} assessments is not available yet. Choose a Web
            application assessment to proceed.
          </Alert>
        )}

        {needsAuthorization &&
          selectedAsset &&
          SUPPORTED_ASSESSMENT_TYPES.includes(assessmentType) && (
            <Checkbox
              id="authorization-confirmation"
              label="I confirm I am authorized to run a security assessment against this asset"
              description="This asset has not yet had its testing authorization confirmed. This assessment cannot start until it is."
              checked={authorizationChecked}
              onChange={(event) => setAuthorizationChecked(event.target.checked)}
            />
          )}

        {createMutation.isError && (
          <Alert tone="destructive">{errorMessage(createMutation.error)}</Alert>
        )}

        <Button type="submit" disabled={!canSubmit} isLoading={createMutation.isPending}>
          Start assessment
        </Button>
      </form>
    </Modal>
  );
}
