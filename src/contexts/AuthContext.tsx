import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import type { UserRole } from '@/types/deal';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  /** roles + dealer link are loading after sign-in */
  accessLoading: boolean;
  roles: UserRole[];
  dealerId: string | null;
  dealerName: string | null;
  profileName: string;
  isStaff: boolean;
  isDealer: boolean;
  isAdmin: boolean;
  hasRole: (...roles: UserRole[]) => boolean;
  refreshAccess: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  loading: true,
  accessLoading: false,
  roles: [],
  dealerId: null,
  dealerName: null,
  profileName: '',
  isStaff: false,
  isDealer: false,
  isAdmin: false,
  hasRole: () => false,
  refreshAccess: async () => {},
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [roles, setRoles] = useState<UserRole[]>([]);
  const [dealerId, setDealerId] = useState<string | null>(null);
  const [dealerName, setDealerName] = useState<string | null>(null);
  const [profileName, setProfileName] = useState('');

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      setLoading(false);
    });
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      setLoading(false);
    });
    return () => subscription.unsubscribe();
  }, []);

  const loadAccess = useCallback(async (uid: string) => {
    const [rolesRes, linkRes, profileRes] = await Promise.all([
      supabase.from('user_roles').select('role').eq('user_id', uid),
      supabase.from('dealer_users').select('dealer_id, dealers(name)').eq('user_id', uid).maybeSingle(),
      supabase.from('profiles').select('name').eq('user_id', uid).maybeSingle(),
    ]);
    setRoles(((rolesRes.data ?? []) as { role: UserRole }[]).map((r) => r.role));
    setDealerId(linkRes.data?.dealer_id ?? null);
    setDealerName((linkRes.data?.dealers as { name: string } | null)?.name ?? null);
    setProfileName(profileRes.data?.name ?? '');
    setLoadedFor(uid);
  }, []);

  const uid = user?.id ?? null;
  useEffect(() => {
    if (!uid) {
      setRoles([]);
      setDealerId(null);
      setDealerName(null);
      setProfileName('');
      setLoadedFor(null);
      return;
    }
    loadAccess(uid);
  }, [uid, loadAccess]);

  const accessLoading = !!user && loadedFor !== user.id;
  const isStaff = roles.some((r) => r !== 'dealer');
  const isDealer = !isStaff && !!dealerId;
  const hasRole = useCallback((...want: UserRole[]) => roles.includes('admin') || want.some((r) => roles.includes(r)), [roles]);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
        accessLoading,
        roles,
        dealerId,
        dealerName,
        profileName,
        isStaff,
        isDealer,
        isAdmin: roles.includes('admin'),
        hasRole,
        refreshAccess: async () => { if (user) await loadAccess(user.id); },
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
