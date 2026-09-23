import { Navigate } from 'react-router-dom';
import { useSession } from '../auth/SessionContext';

export function RootRedirect() {
  const { isPlatformAdmin } = useSession();
  return <Navigate to={isPlatformAdmin ? '/platform' : '/app'} replace />;
}
