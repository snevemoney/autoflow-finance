import { Link, useLocation } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AuthCard, AuthIcon } from '@/components/auth/AuthCard';
import { useAuth } from '@/contexts/AuthContext';

export default function NotFound() {
  const { pathname } = useLocation();
  const { session, isDealer } = useAuth();
  const home = !session ? { to: '/auth', label: 'Go to sign in' } : isDealer ? { to: '/portal', label: 'Go to my deals' } : { to: '/', label: 'Go to dashboard' };

  return (
    <AuthCard
      title="Page not found"
      icon={<AuthIcon><Compass /></AuthIcon>}
      description={
        <>
          There’s no page at <code className="break-all rounded bg-muted px-1 py-0.5 text-xs text-foreground">{pathname}</code>.
          {' '}The link may be old or mistyped.
        </>
      }
    >
      <Button asChild className="w-full">
        <Link to={home.to}>{home.label}</Link>
      </Button>
    </AuthCard>
  );
}
