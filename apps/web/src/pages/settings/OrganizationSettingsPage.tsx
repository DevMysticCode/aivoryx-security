import { useOrganization } from '../../organization/OrganizationContext';
import { PageContainer } from '../../components/layout/PageContainer';
import { PageHeader } from '../../components/layout/PageHeader';
import { LoadingState } from '../../components/ui/LoadingState';
import { ProfileSection } from './ProfileSection';
import { BrandingSection } from './BrandingSection';
import { ThemeSection } from './ThemeSection';

export function OrganizationSettingsPage() {
  const { currentOrganization, isLoading } = useOrganization();

  if (isLoading) return <LoadingState label="Loading settings…" />;
  if (!currentOrganization) return null;

  return (
    <PageContainer>
      <PageHeader
        title="Organization Settings"
        description="Company profile, branding, and theme."
      />
      <ProfileSection organization={currentOrganization} />
      <BrandingSection organization={currentOrganization} />
      <ThemeSection organization={currentOrganization} />
    </PageContainer>
  );
}
