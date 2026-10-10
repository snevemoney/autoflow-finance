import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowLeft, Loader2, MailCheck } from 'lucide-react';
import { requestPasswordReset } from '@/lib/passwordReset';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AuthCard, AuthIcon } from '@/components/auth/AuthCard';

export default function ForgotPassword() {
  const location = useLocation();
  const [email, setEmail] = useState(((location.state ?? {}) as { email?: string }).email ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    await requestPasswordReset(email.trim());
    setSubmitting(false);
    setSent(true);
  };

  const backToSignIn = (
    <Link
      to="/auth"
      state={{ email: email.trim() }}
      className="inline-flex items-center gap-1.5 rounded-sm text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to sign in
    </Link>
  );

  if (sent) {
    return (
      <AuthCard
        title="Check your email"
        icon={<AuthIcon tone="success"><MailCheck /></AuthIcon>}
        // the same answer whatever happened, so the page never reveals whether an account exists
        description={<span role="status">If an account exists for that email, a reset link is on its way.</span>}
      >
        <div className="space-y-4 text-center">
          <p className="text-sm text-muted-foreground">
            The link works once and expires after a while. Nothing arrived after a few minutes? Check your spam folder, or
            {' '}
            <button
              type="button"
              className="rounded-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setSent(false)}
            >
              try again
            </button>.
          </p>
          {backToSignIn}
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Forgot your password?" description="Enter your email and we’ll send you a link to choose a new one.">
      <form onSubmit={onSubmit} className="space-y-4" aria-busy={submitting}>
        <div className="space-y-2">
          <Label htmlFor="reset-email">Email</Label>
          <Input
            id="reset-email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> Sending…</> : 'Send reset link'}
        </Button>
        <div className="text-center">{backToSignIn}</div>
      </form>
    </AuthCard>
  );
}
