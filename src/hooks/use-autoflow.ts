import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database, Json } from '@/integrations/supabase/types';
import type { DocumentType } from '@/types/deal';
import { useAuth } from '@/contexts/AuthContext';
import { useRealtimeRefresh } from './use-deals';

type Tables = Database['public']['Tables'];
export type DocumentRequest = Tables['document_requests']['Row'];
export type NotificationRow = Tables['notifications']['Row'];
export type AppSettings = Tables['app_settings']['Row'];
export type DealerRow = Tables['dealers']['Row'];
export type DealerStats = Database['public']['Views']['dealer_stats']['Row'];

export interface ChecklistItem {
  item_key: string;
  label: string;
  doc_types: DocumentType[];
  satisfied: boolean;
  document_count: number;
  open_request_id: string | null;
}

export interface Automations {
  auto_sort: boolean;
  auto_fill_income: boolean;
  auto_request_docs: boolean;
  auto_route: boolean;
}

export interface FundingChecklistItem { key: string; label: string }

// ------------------------------------------------------------------ checklist + requests
export function useChecklist(dealId: string | undefined) {
  return useQuery({
    queryKey: ['checklist', dealId],
    enabled: !!dealId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('deal_checklist', { _deal_id: dealId! });
      if (error) throw error;
      return (data ?? []) as ChecklistItem[];
    },
  });
}

export function useDealRequests(dealId: string | undefined) {
  return useQuery({
    queryKey: ['requests', dealId],
    enabled: !!dealId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('document_requests').select('*').eq('deal_id', dealId!).order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Every open request across the signed-in dealer's deals (portal). */
export function useOpenDealerRequests(enabled = true) {
  useRealtimeRefresh(enabled ? 'dealer-requests' : null, ['document_requests'], [['dealer-requests']]);
  return useQuery({
    queryKey: ['dealer-requests'],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('document_requests').select('*').eq('status', 'open').order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Open requests for all deals (staff dashboard + deal cards). */
export function useOpenRequestCounts(enabled = true) {
  return useQuery({
    queryKey: ['open-request-counts'],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from('document_requests').select('deal_id').eq('status', 'open');
      if (error) throw error;
      const map = new Map<string, number>();
      for (const r of data ?? []) map.set(r.deal_id, (map.get(r.deal_id) ?? 0) + 1);
      return map;
    },
  });
}

function useInvalidateDeal(dealId: string | undefined) {
  const qc = useQueryClient();
  return () => {
    ['deal', 'checklist', 'requests', 'income-sources', 'income-sources-detail'].forEach((k) =>
      qc.invalidateQueries({ queryKey: [k, dealId] }));
    qc.invalidateQueries({ queryKey: ['deals'] });
  };
}

export function useRequestDocument(dealId: string | undefined) {
  const refresh = useInvalidateDeal(dealId);
  return useMutation({
    mutationFn: async ({ docType, message }: { docType: DocumentType; message?: string }) => {
      const { error } = await supabase.rpc('request_document', { _deal_id: dealId!, _doc_type: docType, _message: message });
      if (error) throw error;
    },
    onSuccess: refresh,
  });
}

export function useRequestMissing(dealId: string | undefined) {
  const refresh = useInvalidateDeal(dealId);
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('request_missing_documents', { _deal_id: dealId! });
      if (error) throw error;
      return data as number;
    },
    onSuccess: refresh,
  });
}

export function useCancelRequest(dealId: string | undefined) {
  const refresh = useInvalidateDeal(dealId);
  return useMutation({
    mutationFn: async (requestId: string) => {
      const { error } = await supabase.from('document_requests').update({ status: 'cancelled' }).eq('id', requestId);
      if (error) throw error;
    },
    onSuccess: refresh,
  });
}

// ------------------------------------------------------------------ decisions
export function useCreditDecision(dealId: string | undefined) {
  const refresh = useInvalidateDeal(dealId);
  return useMutation({
    mutationFn: async (input: {
      decision: 'approved' | 'conditional' | 'declined';
      notes?: string;
      score?: number | null;
      tier?: Database['public']['Enums']['credit_tier'] | null;
      bureau?: Database['public']['Enums']['credit_bureau'] | null;
    }) => {
      const { data, error } = await supabase.rpc('record_credit_decision', {
        _deal_id: dealId!, _decision: input.decision, _notes: input.notes,
        _score: input.score ?? undefined, _tier: input.tier ?? undefined, _bureau: input.bureau ?? undefined,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: refresh,
  });
}

export function useFundingChecklist(dealId: string | undefined) {
  const refresh = useInvalidateDeal(dealId);
  return useMutation({
    mutationFn: async (items: Record<string, boolean>) => {
      const { error } = await supabase.rpc('update_funding_checklist', { _deal_id: dealId!, _items: items as unknown as Json });
      if (error) throw error;
    },
    onSuccess: refresh,
  });
}

export function useApproveFunding(dealId: string | undefined) {
  const refresh = useInvalidateDeal(dealId);
  return useMutation({
    mutationFn: async (notes?: string) => {
      const { data, error } = await supabase.rpc('approve_funding', { _deal_id: dealId!, _notes: notes });
      if (error) throw error;
      return data;
    },
    onSuccess: refresh,
  });
}

export function useMarkFunded(dealId: string | undefined) {
  const refresh = useInvalidateDeal(dealId);
  return useMutation({
    mutationFn: async (amount?: number | null) => {
      const { data, error } = await supabase.rpc('mark_funded', { _deal_id: dealId!, _amount: amount ?? undefined });
      if (error) throw error;
      return data;
    },
    onSuccess: refresh,
  });
}

export function useSetDealStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ dealId, status, notes }: { dealId: string; status: Database['public']['Enums']['deal_status']; notes?: string }) => {
      const update: Tables['deals']['Update'] = { status };
      if (notes) update.decision_notes = notes;
      const { error } = await supabase.from('deals').update(update).eq('id', dealId);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['deals'] });
      qc.invalidateQueries({ queryKey: ['deal', v.dealId] });
    },
  });
}

// ------------------------------------------------------------------ notifications
export function useNotifications() {
  const { user } = useAuth();
  useRealtimeRefresh(user ? `notifications-${user.id}` : null, [{ table: 'notifications', filter: `user_id=eq.${user?.id}` }], [['notifications']]);
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['notifications'],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notifications').select('*').eq('user_id', user!.id).order('created_at', { ascending: false }).limit(40);
      if (error) throw error;
      return data ?? [];
    },
  });
  const markRead = async (ids?: string[]) => {
    if (!user) return;
    let q = supabase.from('notifications').update({ read: true }).eq('user_id', user.id).eq('read', false);
    if (ids?.length) q = q.in('id', ids);
    await q;
    qc.invalidateQueries({ queryKey: ['notifications'] });
  };
  return { ...query, markRead };
}

// ------------------------------------------------------------------ settings
export const DEFAULT_AUTOMATIONS: Automations = {
  auto_sort: true, auto_fill_income: true, auto_request_docs: true, auto_route: true,
};

export function useAppSettings(enabled = true) {
  return useQuery({
    queryKey: ['app-settings'],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from('app_settings').select('*').maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useSaveSettings() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (patch: Tables['app_settings']['Update']) => {
      const { error } = await supabase.from('app_settings')
        .update({ ...patch, updated_at: new Date().toISOString(), updated_by: user?.id ?? null }).eq('id', true);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['app-settings'] }),
  });
}

export function fundingItemsOf(settings: AppSettings | null | undefined): FundingChecklistItem[] {
  const raw = settings?.funding_checklist_items;
  return Array.isArray(raw) ? (raw as unknown as FundingChecklistItem[]) : [];
}

// ------------------------------------------------------------------ dealers + people
export function useDealerStats(enabled = true) {
  return useQuery({
    queryKey: ['dealer-stats'],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from('dealer_stats').select('*');
      if (error) throw error;
      return new Map((data ?? []).map((r) => [r.dealer_id!, r]));
    },
  });
}

export interface StaffUser {
  userId: string;
  name: string;
  email: string;
  department: string | null;
  isActive: boolean;
  lastLogin: string | null;
  createdAt: string;
  roles: Database['public']['Enums']['app_role'][];
  dealerId: string | null;
}

export function useUsers(enabled = true) {
  return useQuery({
    queryKey: ['users'],
    enabled,
    queryFn: async (): Promise<StaffUser[]> => {
      const [profiles, roles, links] = await Promise.all([
        supabase.from('profiles').select('*').order('name'),
        supabase.from('user_roles').select('user_id, role'),
        supabase.from('dealer_users').select('user_id, dealer_id'),
      ]);
      if (profiles.error) throw profiles.error;
      const roleMap = new Map<string, StaffUser['roles']>();
      for (const r of roles.data ?? []) roleMap.set(r.user_id, [...(roleMap.get(r.user_id) ?? []), r.role]);
      const linkMap = new Map((links.data ?? []).map((l) => [l.user_id, l.dealer_id]));
      return (profiles.data ?? []).map((p) => ({
        userId: p.user_id, name: p.name, email: p.email, department: p.department, isActive: p.is_active,
        lastLogin: p.last_login, createdAt: p.created_at, roles: roleMap.get(p.user_id) ?? [], dealerId: linkMap.get(p.user_id) ?? null,
      }));
    },
  });
}

// ------------------------------------------------------------------ automation activity
export interface AutomationActivity {
  autoSorted: number;
  incomeFilled: number;
  requestsSent: number;
  autoRouted: number;
}

export function useAutomationActivity(days = 7, enabled = true) {
  return useQuery({
    queryKey: ['automation-activity', days],
    enabled,
    queryFn: async (): Promise<AutomationActivity> => {
      const since = new Date(Date.now() - days * 86_400_000).toISOString();
      const { data, error } = await supabase
        .from('deal_timeline').select('type, metadata').gte('created_at', since)
        .in('type', ['automation', 'document_request', 'status_change']);
      if (error) throw error;
      const out = { autoSorted: 0, incomeFilled: 0, requestsSent: 0, autoRouted: 0 };
      for (const row of data ?? []) {
        const m = (row.metadata ?? {}) as Record<string, unknown>;
        if (m.automation === 'auto_sort') out.autoSorted++;
        else if (m.automation === 'auto_fill_income') out.incomeFilled++;
        else if (m.automation === 'auto_route') out.autoRouted++;
        else if (row.type === 'document_request' && m.source === 'automation' && !m.fulfilled) out.requestsSent++;
      }
      return out;
    },
  });
}
