import { supabase } from '@/integrations/supabase/client';

/**
 * Asks the auth-email function to send a password-reset link. Resolves the same way whatever
 * happens (sent, unknown address, error, offline) so the page can't be used to find out which
 * email addresses have an account.
 */
export async function requestPasswordReset(email: string, origin = window.location.origin): Promise<void> {
  try {
    await supabase.functions.invoke('auth-email', {
      body: { type: 'recovery', email, redirectTo: `${origin}/reset-password` },
    });
  } catch {
    // network failure: same neutral answer
  }
}
