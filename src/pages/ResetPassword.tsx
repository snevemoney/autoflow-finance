import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { KeyRound, Loader2, TimerOff } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { AuthCard, AuthIcon, FormNotice } from '@/components/auth/AuthCard';
import { NewPasswordFields } from '@/components/auth/PasswordInput';
import { FullPageSpinner } from '@/components/ProtectedRoute';
import { useEmailLinkSession } from '@/components/auth/use-email-link';
import { passwordProblem } from '@/lib/password';
import { passwordUpdateErrorMessage } from '@/lib/authErrors';
import type { AuthPageState } from './Auth';

const linkClass = 'rounded-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** Opened from the password-reset email: choose a new password, then sign in with it. */
export default function ResetPassword() {
  const { status, session } = useEmailLinkSession('recovery');
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (done) return <FullPageSpinner label="Password saved. Signing you out…" />;
  if (status === 'checking') return <FullPageSpinner label="Checking your link…" />;

  if (status === 'invalid') {
    return (
      <AuthCard
        title="This link has expired"
        icon={<AuthIcon tone="warning"><TimerOff /></AuthIcon>}
        description="Reset links work once and only for a limited time."
      >
        <div className="space-y-3 text-center text-sm">
          <Button asChild className="w-full"><Link to="/forgot-password">Request a new one</Link></Button>
          <Link to="/auth" className={linkClass}>Back to sign in</Link>
        </div>
      </AuthCard>
    );
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = passwordProblem(password, confirmation);
    if (problem) { setError(problem); return; }
    setError(null);
    setSaving(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(passwordUpdateErrorMessage(updateError));
        setSaving(false);
        return;
      }
      const email = session?.user.email;
      setDone(true);
      await signOut();
      const state: AuthPageState = { notice: 'password-updated', email };
      navigate('/auth', { replace: true, state });
    } catch (err) {
      setDone(false);
      setError(passwordUpdateErrorMessage(err));
      setSaving(false);
    }
  };

  return (
    <AuthCard
      title="Choose a new password"
      icon={<AuthIcon><KeyRound /></AuthIcon>}
      description={session?.user.email ? <>For <span className="font-medium text-foreground">{session.user.email}</span></> : undefined}
    >
      <form onSubmit={onSubmit} className="space-y-4" aria-busy={saving}>
        {/* lets password managers attach the new password to the right account */}
        <input type="email" name="username" autoComplete="username" value={session?.user.email ?? ''} readOnly hidden />
        {error && <FormNotice tone="error">{error}</FormNotice>}
        <NewPasswordFields
          password={password}
          confirmation={confirmation}
          onPassword={setPassword}
          onConfirmation={setConfirmation}
          disabled={saving}
        />
        <Button type="submit" className="w-full" disabled={saving}>
          {saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> Saving…</> : 'Save new password'}
        </Button>
      </form>
    </AuthCard>
  );
}
