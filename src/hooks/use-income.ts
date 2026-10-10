import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { qk } from '@/lib/query-keys';
import type { IncomeSource } from '@/components/deals/IncomeSourceCard';
import type { ApplicantDebt } from '@/components/deals/ApplicantDebtsCard';
import type { ExtractedData } from '@/components/deals/ExtractedDataBadge';

export interface ExtractedIncome extends ExtractedData {
  deal_id?: string;
  income_source_id: string | null;
}

function useUid() {
  const { user } = useAuth();
  return user?.id ?? null;
}

/** Income sources of a deal (read-only — the server creates the primary one at submission). */
export function useIncomeSources(dealId: string | undefined) {
  const uid = useUid();
  return useQuery({
    queryKey: qk.incomeSources(uid, dealId),
    enabled: !!dealId && !!uid,
    queryFn: async () => {
      const { data, error } = await supabase.from('income_sources').select('*').eq('deal_id', dealId!)
        .order('is_primary', { ascending: false }).order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []).map((s) => ({ ...s, flag_reasons: s.flag_reasons ?? [] })) as unknown as IncomeSource[];
    },
  });
}

export function useExtractions(dealId: string | undefined) {
  const uid = useUid();
  return useQuery({
    queryKey: qk.extractions(uid, dealId),
    enabled: !!dealId && !!uid,
    queryFn: async () => {
      const { data, error } = await supabase.from('extracted_income_data').select('*').eq('deal_id', dealId!);
      if (error) throw error;
      return (data ?? []) as unknown as ExtractedIncome[];
    },
  });
}

export function useApplicantDebts(dealId: string | undefined) {
  const uid = useUid();
  return useQuery({
    queryKey: qk.debts(uid, dealId),
    enabled: !!dealId && !!uid,
    queryFn: async () => {
      const { data, error } = await supabase.from('applicant_debts').select('*').eq('deal_id', dealId!).order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as ApplicantDebt[];
    },
  });
}

/** Update an income source (contract columns such as calc_locked aren't in the generated types yet). */
export async function updateIncomeSource(id: string, patch: Record<string, unknown>) {
  const { error } = await supabase.from('income_sources').update({ ...patch, updated_at: new Date().toISOString() } as never).eq('id', id);
  if (error) throw error;
}

export async function addTimelineNote(dealId: string, description: string, metadata: Record<string, unknown>) {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from('deal_timeline').insert({
    deal_id: dealId, type: 'note_added', description, created_by: user?.id ?? null, metadata: metadata as never,
  });
  if (error) console.warn('timeline note not saved', error.message);
}

/** Refresh everything income-related for a deal after an analyst action. */
export function useRefreshIncome(dealId: string | undefined) {
  const qc = useQueryClient();
  const uid = useUid();
  return () => {
    qc.invalidateQueries({ queryKey: qk.incomeSources(uid, dealId) });
    qc.invalidateQueries({ queryKey: qk.extractions(uid, dealId) });
    qc.invalidateQueries({ queryKey: qk.incomeDocs(uid, dealId) });
    qc.invalidateQueries({ queryKey: qk.deal(uid, dealId) });
  };
}
