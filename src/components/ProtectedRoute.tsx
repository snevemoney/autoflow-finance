import { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { LogOut, RotateCw, WifiOff } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';

export function FullPageSpinner({ label = 'Loading AutoFlow…' }: { label?: string }) {
  return (
    <div className="flex h-screen items-center justify-center bg-background" role="status" aria-live="polite">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </div>
  );
}

/** Roles/profile could not be loaded (server error or offline) — not the same as having no access. */
export function AccessErrorScreen() {
  const { refreshAccess, signOut } = useAuth();
  const [retrying, setRetrying] = useState(false);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div role="alert" className="w-full max-w-md space-y-4 rounded-xl border bg-card p-6 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-warning/10">
          <WifiOff className="h-6 w-6 text-warning" aria-hidden="true" />
        </div>
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Can’t reach AutoFlow</h1>
          <p className="text-sm text-muted-foreground">
            We couldn’t load your account. Check your internet connection, then try again.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button
            disabled={retrying}
            onClick={async () => {
              setRetrying(true);
              try { await refreshAccess(); } finally { setRetrying(false); }
            }}
          >
            <RotateCw className={retrying ? 'mr-2 h-4 w-4 animate-spin' : 'mr-2 h-4 w-4'} aria-hidden="true" />
            {retrying ? 'Retrying…' : 'Retry'}
          </Button>
          <Button variant="outline" onClick={() => signOut()}>
            <LogOut className="mr-2 h-4 w-4" aria-hidden="true" /> Sign out
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Staff see the deal desk, dealers see their portal, accounts without access wait on /pending.
 * mode="any" only requires a session.
 */
export function ProtectedRoute({ mode = 'staff' }: { mode?: 'staff' | 'dealer' | 'any' }) {
  const { session, loading, accessLoading, accessError, isStaff, isDealer, sessionEnded, signedOut } = useAuth();
  const location = useLocation();

  if (loading || (session && accessLoading)) return <FullPageSpinner />;
  if (!session) {
    // after a deliberate sign-out the next person starts from their own home page
    if (signedOut) return <Navigate to="/auth" replace />;
    const from = `${location.pathname}${location.search}`;
    return <Navigate to="/auth" replace state={sessionEnded ? { from, reason: 'session-ended' } : { from }} />;
  }
  if (accessError) return <AccessErrorScreen />;
  if (mode === 'any') return <Outlet />;
  if (mode === 'staff') {
    if (isStaff) return <Outlet />;
    return <Navigate to={isDealer ? '/portal' : '/pending'} replace />;
  }
  if (isDealer) return <Outlet />;
  return <Navigate to={isStaff ? '/' : '/pending'} replace />;
}

function NoAccessRedirect({ to }: { to: string }) {
  useEffect(() => {
    toast({ title: 'No access', description: 'That page is only available to administrators.', variant: 'destructive' });
  }, []);
  return <Navigate to={to} replace />;
}

/** Admin-only pages (Users, Settings, Dealers); other staff go back to the dashboard. */
export function AdminRoute() {
  const { isAdmin } = useAuth();
  if (isAdmin) return <Outlet />;
  return <NoAccessRedirect to="/" />;
}
