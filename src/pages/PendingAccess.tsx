import { Navigate } from 'react-router-dom';
import { Clock, LogOut, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { BrandMark } from '@/components/layout/AppSidebar';

/** Signed in, but an admin hasn't given this account a role or linked it to a dealership yet. */
export default function PendingAccess() {
  const { user, isStaff, isDealer, roles, signOut, refreshAccess } = useAuth();
  if (isStaff) return <Navigate to="/" replace />;
  if (isDealer) return <Navigate to="/portal" replace />;
  const dealerWithoutLink = roles.includes('dealer');

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-4">
          <div className="mx-auto rounded-xl bg-sidebar px-4 py-3"><BrandMark /></div>
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-warning/10">
            <Clock className="h-6 w-6 text-warning" />
          </div>
          <CardTitle>Almost there</CardTitle>
          <CardDescription>
            {dealerWithoutLink
              ? 'Your dealer account is set up, but it isn\'t linked to a dealership yet.'
              : 'Your account was created. An administrator needs to give you access.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-center">
          <p className="text-sm text-muted-foreground">
            Signed in as <span className="font-medium text-foreground">{user?.email}</span>. Ask your AutoFlow contact to
            {dealerWithoutLink ? ' link you to your dealership' : ' assign your role'} in Users, then check again.
          </p>
          <div className="flex gap-2 justify-center">
            <Button onClick={() => refreshAccess()}><RefreshCw className="h-4 w-4 mr-2" /> Check again</Button>
            <Button variant="outline" onClick={signOut}><LogOut className="h-4 w-4 mr-2" /> Sign out</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
