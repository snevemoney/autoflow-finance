import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2, MailX, UserPlus } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AuthCard, AuthIcon, FormNotice } from '@/components/auth/AuthCard';
import { NewPasswordFields } from '@/components/auth/PasswordInput';
import { FullPageSpinner } from '@/components/ProtectedRoute';
import { useEmailLinkSession } from '@/components/auth/use-email-link';
import { passwordProblem } from '@/lib/password';
import { passwordUpdateErrorMessage } from '@/lib/authErrors';

const linkClass = 'rounded-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/**
 * Opened from an invitation email (the link signs the user in): choose a password and confirm
 * the full name, then continue into the app — the routes send staff to the dashboard, dealers
 * to their portal, and accounts without access yet to the waiting page.
 */
export default function AcceptInvite() {
  const { status, session } = useEmailLinkSession('invite');
  const { profileName, refreshAccess } = useAuth();
  const navigate = useNavigate();
  const metaName = typeof session?.user.user_metadata?.name === 'string' ? session.user.user_metadata.name : '';
  const [name, setName] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fullName = name ?? (profileName || metaName);

  if (status === 'checking') return <FullPageSpinner label="Opening your invitation…" />;

  if (status === 'invalid' || !session) {
    return (
      <AuthCard
        title="This invitation link has expired"
        icon={<AuthIcon tone="warning"><MailX /></AuthIcon>}
        description="Invitation links work once and only for a limited time. Ask your AutoFlow administrator to send you a new invitation."
      >
        <div className="text-center text-sm">
          <Link to="/auth" className={linkClass}>Already set up? Sign in</Link>
        </div>
      </AuthCard>
    );
  }

  const uid = session.user.id;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = fullName.trim();
    if (trimmed.length < 2) { setError('Enter your full name.'); return; }
    if (!passwordSaved) {
      const problem = passwordProblem(password, confirmation);
      if (problem) { setError(problem); return; }
    }
    setError(null);
    setSaving(true);
    try {
      if (!passwordSaved) {
        const { error: updateError } = await supabase.auth.updateUser({ password, data: { name: trimmed } });
        if (updateError) { setError(passwordUpdateErrorMessage(updateError)); return; }
        setPasswordSaved(true);
      }
      const { error: profileError } = await supabase.from('profiles').update({ name: trimmed }).eq('user_id', uid);
      if (profileError) {
        setError('Your password is saved, but your name couldn’t be. Check your connection and try again.');
        return;
      }
      await refreshAccess();
      navigate('/', { replace: true });
    } catch (err) {
      setError(passwordUpdateErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <AuthCard
      title="Welcome to AutoFlow"
      icon={<AuthIcon><UserPlus /></AuthIcon>}
      description={<>Set up your account for <span className="font-medium text-foreground">{session.user.email}</span>.</>}
    >
      <form onSubmit={onSubmit} className="space-y-4" aria-busy={saving}>
        <input type="email" name="username" autoComplete="username" value={session.user.email ?? ''} readOnly hidden />
        {error && <FormNotice tone="error">{error}</FormNotice>}
        <div className="space-y-2">
          <Label htmlFor="full-name">Full name</Label>
          <Input
            id="full-name"
            name="name"
            autoComplete="name"
            required
            disabled={saving}
            value={fullName}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        {passwordSaved ? (
          <FormNotice tone="success">Password saved.</FormNotice>
        ) : (
          <NewPasswordFields
            password={password}
            confirmation={confirmation}
            onPassword={setPassword}
            onConfirmation={setConfirmation}
            disabled={saving}
          />
        )}
        <Button type="submit" className="w-full" disabled={saving}>
          {saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> Saving…</> : 'Save and continue'}
        </Button>
      </form>
    </AuthCard>
  );
}
