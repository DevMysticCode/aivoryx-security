import { Routes, Route } from 'react-router-dom';
import { RequireAuth, RequirePlatformAdmin, RequireTenantUser } from './auth/ProtectedRoute';
import { LoginPage } from './pages/auth/LoginPage';
import { RegisterPage } from './pages/auth/RegisterPage';
import { RootRedirect } from './pages/RootRedirect';
import { PlatformAppShell } from './components/layout/PlatformAppShell';
import { PlatformDashboardPage } from './pages/platform/PlatformDashboardPage';
import { PlatformOrganizationsPage } from './pages/platform/PlatformOrganizationsPage';
import { TenantAppShell } from './components/layout/TenantAppShell';
import { TenantDashboardPage } from './pages/tenant/TenantDashboardPage';
import { ProjectsListPage } from './pages/projects/ProjectsListPage';
import { ProjectDetailPage } from './pages/projects/ProjectDetailPage';
import { AssessmentsListPage } from './pages/assessments/AssessmentsListPage';
import { AssessmentDetailPage } from './pages/assessments/AssessmentDetailPage';
import { FindingDetailPage } from './pages/findings/FindingDetailPage';
import { TeamPage } from './pages/team/TeamPage';
import { OrganizationSettingsPage } from './pages/settings/OrganizationSettingsPage';
import { ReportsPage } from './pages/reports/ReportsPage';
import { NotFoundPage } from './pages/NotFoundPage';

export function AppRouter() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />

      <Route element={<RequireAuth />}>
        <Route path="/" element={<RootRedirect />} />

        <Route element={<RequirePlatformAdmin />}>
          <Route path="/platform" element={<PlatformAppShell />}>
            <Route index element={<PlatformDashboardPage />} />
            <Route path="organizations" element={<PlatformOrganizationsPage />} />
          </Route>
        </Route>

        <Route element={<RequireTenantUser />}>
          <Route path="/app" element={<TenantAppShell />}>
            <Route index element={<TenantDashboardPage />} />
            <Route path="projects" element={<ProjectsListPage />} />
            <Route path="projects/:projectId" element={<ProjectDetailPage />} />
            <Route path="assessments" element={<AssessmentsListPage />} />
            <Route path="assessments/:assessmentId" element={<AssessmentDetailPage />} />
            <Route path="findings/:findingId" element={<FindingDetailPage />} />
            <Route path="team" element={<TeamPage />} />
            <Route path="settings" element={<OrganizationSettingsPage />} />
            <Route path="reports" element={<ReportsPage />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
