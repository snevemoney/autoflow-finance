import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

function Spinner() {
  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>
  );
}

/**
 * Staff see the deal desk, dealers see their portal, accounts without access wait on /pending.
 * mode="any" only requires a session.
 */
export function ProtectedRoute({ mode = 'staff' }: { mode?: 'staff' | 'dealer' | 'any' }) {
  const { session, loading, accessLoading, isStaff, isDealer } = useAuth();
  const location = useLocation();

  if (loading || (session && accessLoading)) return <Spinner />;
  if (!session) return <Navigate to="/auth" replace state={{ from: location.pathname }} />;
  if (mode === 'any') return <Outlet />;
  if (mode === 'staff') {
    if (isStaff) return <Outlet />;
    return <Navigate to={isDealer ? '/portal' : '/pending'} replace />;
  }
  if (isDealer) return <Outlet />;
  return <Navigate to={isStaff ? '/' : '/pending'} replace />;
}
