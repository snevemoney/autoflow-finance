import { useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AuthCard, FormNotice } from '@/components/auth/AuthCard';
import { PasswordInput } from '@/components/auth/PasswordInput';
import { safeReturnPath, signInErrorMessage } from '@/lib/authErrors';

export interface AuthPageState {
  /** where to go after signing in (set by ProtectedRoute) */
  from?: string;
  /** why the user landed here */
  reason?: 'session-ended';
  notice?: 'password-updated';
  email?: string;
}

export default function Auth() {
  const { session } = useAuth();
  const location = useLocation();
  const state = (location.state ?? {}) as AuthPageState;
  const [email, setEmail] = useState(state.email ?? '');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // signed in (now or already): continue where the user was going
  if (session) return <Navigate to={safeReturnPath(state.from)} replace />;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (signInError) setError(signInErrorMessage(signInError));
    } catch (err) {
      setError(signInErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthCard title="Sign in to AutoFlow" description="Lender staff and dealer partners use the same sign-in.">
      <form onSubmit={handleLogin} className="space-y-4" aria-busy={submitting}>
        {state.reason === 'session-ended' && !error && (
          <FormNotice tone="info">Your session ended — please sign in again.</FormNotice>
        )}
        {state.notice === 'password-updated' && !error && (
          <FormNotice tone="success">Your password was changed. Sign in with your new password.</FormNotice>
        )}
        {error && <FormNotice tone="error" id="signin-error">{error}</FormNotice>}

        <div className="space-y-2">
          <Label htmlFor="login-email">Email</Label>
          <Input
            id="login-email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={!!error}
            aria-describedby={error ? 'signin-error' : undefined}
          />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="login-password">Password</Label>
            <Link
              to="/forgot-password"
              state={{ email: email.trim() }}
              className="rounded-sm text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Forgot password?
            </Link>
          </div>
          <PasswordInput
            id="login-password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={!!error}
            aria-describedby={error ? 'signin-error' : undefined}
          />
        </div>
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> Signing in…</> : 'Sign in'}
        </Button>
        <p className="text-center text-sm text-muted-foreground">Have an invitation? Open the link in your email.</p>
      </form>
    </AuthCard>
  );
}
