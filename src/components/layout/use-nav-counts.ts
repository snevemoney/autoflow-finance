import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

/** Sidebar badge numbers, from the queue_counts() RPC (dealers get their own counts). */
export interface NavCounts {
  credit_review: number;
  income_verification: number;
  funding_review: number;
  approved: number;
  open_requests: number;
}

const KEYS: (keyof NavCounts)[] = ['credit_review', 'income_verification', 'funding_review', 'approved', 'open_requests'];

export function normalizeNavCounts(raw: unknown): NavCounts {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return Object.fromEntries(KEYS.map((k) => {
    const n = Number(o[k]);
    return [k, Number.isFinite(n) && n > 0 ? Math.floor(n) : 0];
  })) as unknown as NavCounts;
}

/**
 * Counts for the sidebar badges. A failed call just hides the badges.
 * (Same RPC as the data pages' useQueueCounts(); this one lives with the shell so the layout
 * doesn't load every deal just to count them.)
 */
export function useNavCounts() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['nav-counts', user?.id],
    enabled: !!user,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
    queryFn: async () => {
      // queue_counts() comes with the production-hardening migration (not yet in the generated types)
      const rpc = supabase.rpc as unknown as (fn: string) => PromiseLike<{ data: unknown; error: unknown }>;
      const { data, error } = await rpc.call(supabase, 'queue_counts');
      if (error) throw error;
      return normalizeNavCounts(data);
    },
  });
}
