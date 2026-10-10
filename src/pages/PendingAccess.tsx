import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Clock, LogOut, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { AuthCard, AuthIcon } from '@/components/auth/AuthCard';

/** Signed in, but an admin hasn't given this account a role or linked it to a dealership yet. */
export default function PendingAccess() {
  const { user, isStaff, isDealer, roles, signOut, refreshAccess } = useAuth();
  const [checking, setChecking] = useState(false);
  if (isStaff) return <Navigate to="/" replace />;
  if (isDealer) return <Navigate to="/portal" replace />;
  const dealerWithoutLink = roles.includes('dealer');

  return (
    <AuthCard
      title="Almost there"
      icon={<AuthIcon tone="warning"><Clock /></AuthIcon>}
      description={dealerWithoutLink
        ? 'Your dealer account is set up, but it isn’t linked to a dealership yet.'
        : 'Your account exists, but an administrator still needs to give you access.'}
    >
      <div className="space-y-4 text-center">
        <p className="text-sm text-muted-foreground">
          Signed in as <span className="break-all font-medium text-foreground">{user?.email}</span>. Ask your AutoFlow contact to
          {dealerWithoutLink ? ' link you to your dealership' : ' assign your role'}, then check again.
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button
            disabled={checking}
            onClick={async () => {
              setChecking(true);
              try { await refreshAccess(); } finally { setChecking(false); }
            }}
          >
            <RefreshCw className={checking ? 'mr-2 h-4 w-4 animate-spin' : 'mr-2 h-4 w-4'} aria-hidden="true" />
            {checking ? 'Checking…' : 'Check again'}
          </Button>
          <Button variant="outline" onClick={() => signOut()}>
            <LogOut className="mr-2 h-4 w-4" aria-hidden="true" /> Sign out
          </Button>
        </div>
      </div>
    </AuthCard>
  );
}
