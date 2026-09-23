import { PageContainer } from '../../components/layout/PageContainer';
import { PageHeader } from '../../components/layout/PageHeader';
import { EmptyState } from '../../components/ui/EmptyState';

export function ReportsPage() {
  return (
    <PageContainer>
      <PageHeader title="Reports" description="Export findings and assessment results." />
      <EmptyState
        title="Reports are not available yet"
        description="Report generation hasn't been built yet. Once it ships, you'll be able to export assessment results and findings from here."
      />
    </PageContainer>
  );
}
