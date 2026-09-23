import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useSession } from './SessionContext';
import { LoadingState } from '../components/ui/LoadingState';

/**
 * Client-side route gating is a UX convenience only, never the security
 * boundary — every route it protects also calls an API that independently
 * re-checks the same thing server-side (session validity, platform role,
 * tenant membership/permission), so a bypassed or stale client check can
 * never grant real access. See Batch 7's "unauthorized direct navigation
 * must also be handled safely" requirement.
 */
export function RequireAuth() {
  const { isAuthenticated, isLoading } = useSession();
  const location = useLocation();

  if (isLoading) return <LoadingState label="Checking your session…" />;
  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}

export function RequirePlatformAdmin() {
  const { isPlatformAdmin, isLoading } = useSession();

  if (isLoading) return <LoadingState label="Checking your session…" />;
  if (!isPlatformAdmin) return <Navigate to="/app" replace />;
  return <Outlet />;
}

export function RequireTenantUser() {
  const { isPlatformAdmin, isLoading } = useSession();

  if (isLoading) return <LoadingState label="Checking your session…" />;
  if (isPlatformAdmin) return <Navigate to="/platform" replace />;
  return <Outlet />;
}
