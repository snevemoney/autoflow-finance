/** Turns a Supabase auth error into a sentence a user can act on. */
export type SignInErrorKind = 'credentials' | 'rate_limit' | 'network' | 'unconfirmed' | 'deactivated' | 'unknown';

interface AuthErrorLike {
  name?: string;
  message?: string;
  status?: number;
  code?: string;
}

export function signInErrorKind(error: unknown): SignInErrorKind {
  const e = (error ?? {}) as AuthErrorLike;
  const code = e.code ?? '';
  const message = (e.message ?? '').toLowerCase();
  if (
    e.name === 'AuthRetryableFetchError' || e.status === 0 || error instanceof TypeError
    || /failed to fetch|network|load failed|fetch failed/.test(message)
  ) return 'network';
  if (e.status === 429 || code.startsWith('over_') || /rate limit|too many/.test(message)) return 'rate_limit';
  if (code === 'invalid_credentials' || message.includes('invalid login credentials')) return 'credentials';
  if (code === 'email_not_confirmed' || message.includes('email not confirmed')) return 'unconfirmed';
  if (code === 'user_banned' || message.includes('banned')) return 'deactivated';
  return 'unknown';
}

export function signInErrorMessage(error: unknown): string {
  switch (signInErrorKind(error)) {
    case 'credentials': return 'Wrong email or password.';
    case 'rate_limit': return 'Too many attempts. Wait a few minutes, then try again.';
    case 'network': return 'Can’t reach AutoFlow. Check your internet connection and try again.';
    case 'unconfirmed': return 'Your email address isn’t confirmed yet — open the link we emailed you.';
    case 'deactivated': return 'This account has been deactivated. Contact your AutoFlow administrator.';
    default: return 'Sign-in didn’t work. Please try again.';
  }
}

/** For supabase.auth.updateUser({ password }) on the reset and invitation pages. */
export function passwordUpdateErrorMessage(error: unknown): string {
  const e = (error ?? {}) as AuthErrorLike;
  const code = e.code ?? '';
  const message = (e.message ?? '').toLowerCase();
  if (signInErrorKind(error) === 'network') return 'Can’t reach AutoFlow. Check your internet connection and try again.';
  if (signInErrorKind(error) === 'rate_limit') return 'Too many attempts. Wait a few minutes, then try again.';
  if (code === 'same_password' || message.includes('different from the old')) return 'Choose a password you haven’t used for this account before.';
  if (code === 'weak_password' || message.includes('weak') || message.includes('password should')) {
    return 'That password is too easy to guess. Try a longer one.';
  }
  if (e.status === 401 || code === 'session_not_found' || code === 'session_expired' || message.includes('session')) {
    return 'This link has expired. Request a new one.';
  }
  return 'Your password couldn’t be saved. Please try again.';
}

/**
 * Internal path to return to after sign-in. Only same-site paths are accepted (never
 * "//evil.example" or "https://…"), and never one of the public auth pages.
 */
export function safeReturnPath(from: unknown, fallback = '/'): string {
  if (typeof from !== 'string' || !from.startsWith('/') || from.startsWith('//') || from.startsWith('/\\')) return fallback;
  const path = from.split(/[?#]/)[0];
  if (['/auth', '/forgot-password', '/reset-password', '/accept-invite'].includes(path)) return fallback;
  return from;
}
