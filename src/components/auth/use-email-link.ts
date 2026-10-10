import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

/** The link carried an error (expired, already used…) — supabase-js leaves it in the URL. */
export function linkErrorInUrl(loc: { hash: string; search: string }): boolean {
  const hash = new URLSearchParams(loc.hash.replace(/^#/, ''));
  const query = new URLSearchParams(loc.search);
  return ['error', 'error_code', 'error_description'].some((k) => hash.has(k) || query.has(k));
}

export type EmailLinkStatus = 'checking' | 'ready' | 'invalid';

/**
 * Session for a page opened from an emailed link (password reset or invitation).
 * - `#access_token=…` links: supabase-js signs the user in on load (PASSWORD_RECOVERY / SIGNED_IN).
 * - `?token_hash=…&type=…` links: verified here, then the token is removed from the address bar.
 * Without a session (or with an error in the link) the status is 'invalid'.
 */
export function useEmailLinkSession(type: 'recovery' | 'invite'): { status: EmailLinkStatus; session: Session | null } {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const [linkError] = useState(() => linkErrorInUrl(window.location));
  const [tokenHash] = useState(() => new URLSearchParams(window.location.search).get('token_hash'));
  const [verifying, setVerifying] = useState(() => !linkError && !!tokenHash);
  const [verifyFailed, setVerifyFailed] = useState(false);

  useEffect(() => {
    if (!tokenHash || linkError) return;
    let active = true;
    supabase.auth.verifyOtp({ token_hash: tokenHash, type })
      .then(({ error }) => { if (active && error) setVerifyFailed(true); })
      .catch(() => { if (active) setVerifyFailed(true); })
      .finally(() => {
        if (!active) return;
        setVerifying(false);
        navigate(window.location.pathname, { replace: true });
      });
    return () => { active = false; };
  }, [tokenHash, linkError, type, navigate]);

  if (linkError || verifyFailed) return { status: 'invalid', session: null };
  if (loading || verifying) return { status: 'checking', session: null };
  return { status: session ? 'ready' : 'invalid', session };
}
