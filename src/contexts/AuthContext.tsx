import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { createCacheOwnerGuard } from '@/lib/queryClient';
import type { UserRole } from '@/types/deal';

export interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  /** roles + dealer link are loading after sign-in */
  accessLoading: boolean;
  /**
   * Roles/profile couldn't be loaded (server error, offline). Not the same as "no role":
   * the user must not be sent to /pending, they get a "Can't reach AutoFlow — Retry" screen.
   */
  accessError: boolean;
  roles: UserRole[];
  dealerId: string | null;
  dealerName: string | null;
  profileName: string;
  isStaff: boolean;
  isDealer: boolean;
  isAdmin: boolean;
  /**
   * The session ended without the user signing out here: the refresh token was refused, or
   * they signed out in another tab. Cleared by the next sign-in.
   */
  sessionEnded: boolean;
  /** the user signed out in this tab (the next sign-in starts fresh, without returning to the old page) */
  signedOut: boolean;
  hasRole: (...roles: UserRole[]) => boolean;
  refreshAccess: () => Promise<void>;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  loading: true,
  accessLoading: false,
  accessError: false,
  roles: [],
  dealerId: null,
  dealerName: null,
  profileName: '',
  isStaff: false,
  isDealer: false,
  isAdmin: false,
  sessionEnded: false,
  signedOut: false,
  hasRole: () => false,
  refreshAccess: async () => {},
  signOut: async () => {},
});

interface Access {
  roles: UserRole[];
  dealerId: string | null;
  dealerName: string | null;
  profileName: string;
}

const NO_ACCESS: Access = { roles: [], dealerId: null, dealerName: null, profileName: '' };

/** Reads the user's roles, dealer link and name. Throws when any of the reads fails. */
async function fetchAccess(uid: string): Promise<Access> {
  const [rolesRes, linkRes, profileRes] = await Promise.all([
    supabase.from('user_roles').select('role').eq('user_id', uid),
    supabase.from('dealer_users').select('dealer_id, dealers(name)').eq('user_id', uid).maybeSingle(),
    supabase.from('profiles').select('name').eq('user_id', uid).maybeSingle(),
  ]);
  const failed = rolesRes.error ?? linkRes.error ?? profileRes.error;
  if (failed) throw failed;
  return {
    roles: ((rolesRes.data ?? []) as { role: UserRole }[]).map((r) => r.role),
    dealerId: linkRes.data?.dealer_id ?? null,
    dealerName: (linkRes.data?.dealers as { name: string } | null)?.name ?? null,
    profileName: profileRes.data?.name ?? '',
  };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionEnd, setSessionEnd] = useState<null | 'signed-out' | 'ended'>(null);
  const [access, setAccess] = useState<Access>(NO_ACCESS);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [accessError, setAccessError] = useState(false);
  /** the user id access is currently being loaded for — results for anyone else are dropped */
  const accessFor = useRef<string | null>(null);
  /** true while this tab is signing out on purpose (so it isn't reported as "session ended") */
  const signingOut = useRef(false);

  useEffect(() => {
    // The query cache belongs to one account: reset it whenever the user id changes, inside the
    // auth callback, i.e. before React renders anything (and runs any query) for the new user.
    const onUser = createCacheOwnerGuard(queryClient);
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      onUser(s?.user?.id ?? null);
      if (event === 'SIGNED_OUT') {
        setSessionEnd(signingOut.current ? 'signed-out' : 'ended');
        signingOut.current = false;
      } else if (s) {
        setSessionEnd(null);
      }
      setSession(s);
      setUser(s?.user ?? null);
      setLoading(false);
    });
    return () => subscription.unsubscribe();
  }, [queryClient]);

  const loadAccess = useCallback(async (uid: string) => {
    accessFor.current = uid;
    let result: Access | null = null;
    for (let attempt = 0; attempt < 2 && !result; attempt++) {
      try {
        result = await fetchAccess(uid);
      } catch (error) {
        if (accessFor.current !== uid) return;
        if (attempt === 0) {
          await wait(800); // one quiet retry for a blip
          if (accessFor.current !== uid) return;
        } else {
          console.error('[AutoFlow] could not load account access', error);
        }
      }
    }
    if (accessFor.current !== uid) return; // someone else signed in meanwhile
    if (result) {
      setAccess(result);
      setAccessError(false);
    } else {
      setAccessError(true);
    }
    setLoadedFor(uid);
  }, []);

  const uid = user?.id ?? null;
  useEffect(() => {
    // never show the previous account's roles while the new ones load
    setAccess(NO_ACCESS);
    setAccessError(false);
    setLoadedFor(null);
    if (!uid) {
      accessFor.current = null;
      return;
    }
    loadAccess(uid);
  }, [uid, loadAccess]);

  const refreshAccess = useCallback(async () => {
    if (!uid) return;
    if (accessError) {
      // from the error screen: show the spinner while retrying
      setAccessError(false);
      setLoadedFor(null);
    }
    await loadAccess(uid);
  }, [uid, accessError, loadAccess]);

  const signOut = useCallback(async () => {
    signingOut.current = true;
    try {
      const { error } = await supabase.auth.signOut();
      // offline or server error: still end the session on this device
      if (error) await supabase.auth.signOut({ scope: 'local' });
    } finally {
      signingOut.current = false;
    }
  }, []);

  const { roles, dealerId, dealerName, profileName } = access;
  const accessLoading = !!user && loadedFor !== user.id;
  const isStaff = roles.some((r) => r !== 'dealer');
  const isDealer = !isStaff && !!dealerId;
  const isAdmin = roles.includes('admin');
  const sessionEnded = sessionEnd === 'ended';
  const signedOut = sessionEnd === 'signed-out';
  const hasRole = useCallback((...want: UserRole[]) => roles.includes('admin') || want.some((r) => roles.includes(r)), [roles]);

  const value = useMemo<AuthContextType>(() => ({
    user,
    session,
    loading,
    accessLoading,
    accessError,
    roles,
    dealerId,
    dealerName,
    profileName,
    isStaff,
    isDealer,
    isAdmin,
    sessionEnded,
    signedOut,
    hasRole,
    refreshAccess,
    signOut,
  }), [user, session, loading, accessLoading, accessError, roles, dealerId, dealerName, profileName, isStaff, isDealer, isAdmin,
    sessionEnded, signedOut, hasRole, refreshAccess, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
