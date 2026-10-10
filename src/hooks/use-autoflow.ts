import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database, Json } from '@/integrations/supabase/types';
import type { DealStatus, DocumentType } from '@/types/deal';
import { useAuth } from '@/contexts/AuthContext';
import { qk } from '@/lib/query-keys';
import { DEFAULT_PREFERENCES, readPreferences, type AppPreferences } from '@/lib/preferences';
import {
  adminMoveDeal, approveFunding, callRpc, declineDeal, markFunded, recordCreditDecision, setCreditCondition,
  setUserAccess, setUserActive, updateFundingChecklist, type AppRole, type CreditDecisionInput,
} from '@/lib/rpc';
import { useLiveUpdates } from './use-live';

export { useQueueCounts } from './use-deals';

type Tables = Database['public']['Tables'];
export type DocumentRequest = Tables['document_requests']['Row'];
export type NotificationRow = Tables['notifications']['Row'];
export type AppSettings = Tables['app_settings']['Row'];
export type DealerRow = Tables['dealers']['Row'];
export type DealerStats = Database['public']['Views']['dealer_stats']['Row'];
export type DealerRequest = DocumentRequest & {
  deals?: { deal_number: string; customers?: { first_name: string; last_name: string } | null } | null;
};

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

function useUid() {
  const { user } = useAuth();
  return user?.id ?? null;
}

// ------------------------------------------------------------------ checklist + requests
export function useChecklist(dealId: string | undefined) {
  const uid = useUid();
  return useQuery({
    queryKey: qk.checklist(uid, dealId),
    enabled: !!dealId && !!uid,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('deal_checklist', { _deal_id: dealId! });
      if (error) throw error;
      return (data ?? []) as ChecklistItem[];
    },
  });
}

export function useDealRequests(dealId: string | undefined) {
  const uid = useUid();
  return useQuery({
    queryKey: qk.requests(uid, dealId),
    enabled: !!dealId && !!uid,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('document_requests').select('*').eq('deal_id', dealId!).order('created_at', { ascending: false }).limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Open requests across the signed-in dealer's deals (RLS scopes them), with the deal they belong to. */
export function useOpenDealerRequests(enabled = true) {
  const uid = useUid();
  useLiveUpdates(['document_requests'], enabled);
  return useQuery({
    queryKey: qk.dealerRequests(uid),
    enabled: enabled && !!uid,
    queryFn: async (): Promise<DealerRequest[]> => {
      const { data, error } = await supabase
        .from('document_requests')
        .select('*, deals (deal_number, customers (first_name, last_name))')
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as unknown as DealerRequest[];
    },
  });
}

function useInvalidateDeal(dealId: string | undefined) {
  const qc = useQueryClient();
  const uid = useUid();
  return () => {
    [qk.deal(uid, dealId), qk.checklist(uid, dealId), qk.requests(uid, dealId), qk.incomeSources(uid, dealId)]
      .forEach((queryKey) => qc.invalidateQueries({ queryKey }));
    qc.invalidateQueries({ queryKey: qk.deals(uid) });
    qc.invalidateQueries({ queryKey: qk.queueCounts(uid) });
    qc.invalidateQueries({ queryKey: qk.dashboard(uid) });
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

// ------------------------------------------------------------------ decisions (all through RPCs — deals are never updated directly)
export function useCreditDecision(dealId: string | undefined) {
  const refresh = useInvalidateDeal(dealId);
  return useMutation({
    mutationFn: (input: Omit<CreditDecisionInput, 'dealId'>) => recordCreditDecision({ ...input, dealId: dealId! }),
    onSuccess: refresh,
  });
}

export function useSetCreditCondition(dealId: string | undefined) {
  const refresh = useInvalidateDeal(dealId);
  return useMutation({
    mutationFn: ({ conditionId, cleared }: { conditionId: string; cleared: boolean }) => setCreditCondition(dealId!, conditionId, cleared),
    onSuccess: refresh,
  });
}

export function useFundingChecklist(dealId: string | undefined) {
  const refresh = useInvalidateDeal(dealId);
  return useMutation({
    mutationFn: (items: Record<string, boolean>) => updateFundingChecklist(dealId!, items),
    onSuccess: refresh,
  });
}

export function useApproveFunding(dealId: string | undefined) {
  const refresh = useInvalidateDeal(dealId);
  return useMutation({ mutationFn: (notes?: string) => approveFunding(dealId!, notes), onSuccess: refresh });
}

export function useMarkFunded(dealId: string | undefined) {
  const refresh = useInvalidateDeal(dealId);
  return useMutation({ mutationFn: (amount?: number | null) => markFunded(dealId!, amount), onSuccess: refresh });
}

/** Admin manual move (pipeline drag, "Move to…"). */
export function useAdminMoveDeal() {
  const qc = useQueryClient();
  const uid = useUid();
  return useMutation({
    mutationFn: ({ dealId, status, note }: { dealId: string; status: DealStatus; note?: string | null }) => adminMoveDeal(dealId, status, note),
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: qk.deals(uid) });
      qc.invalidateQueries({ queryKey: qk.deal(uid, v.dealId) });
      qc.invalidateQueries({ queryKey: qk.queueCounts(uid) });
      qc.invalidateQueries({ queryKey: qk.dashboard(uid) });
    },
  });
}

export function useDeclineDeal() {
  const qc = useQueryClient();
  const uid = useUid();
  return useMutation({
    mutationFn: ({ dealId, reason, dealerMessage }: { dealId: string; reason: string; dealerMessage?: string | null }) =>
      declineDeal(dealId, reason, dealerMessage),
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: qk.deals(uid) });
      qc.invalidateQueries({ queryKey: qk.deal(uid, v.dealId) });
      qc.invalidateQueries({ queryKey: qk.queueCounts(uid) });
      qc.invalidateQueries({ queryKey: qk.dashboard(uid) });
      qc.invalidateQueries({ queryKey: qk.requests(uid, v.dealId) });
    },
  });
}

// ------------------------------------------------------------------ notifications
export function useNotifications() {
  const uid = useUid();
  useLiveUpdates(['notifications'], !!uid);
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: qk.notifications(uid),
    enabled: !!uid,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notifications').select('*').eq('user_id', uid!).order('created_at', { ascending: false }).limit(40);
      if (error) throw error;
      return data ?? [];
    },
  });
  const markRead = async (ids?: string[]) => {
    if (!uid) return;
    let q = supabase.from('notifications').update({ read: true }).eq('user_id', uid).eq('read', false);
    if (ids?.length) q = q.in('id', ids.slice(0, 50));
    await q;
    qc.invalidateQueries({ queryKey: qk.notifications(uid) });
  };
  return { ...query, markRead };
}

// ------------------------------------------------------------------ settings
export const DEFAULT_AUTOMATIONS: Automations = {
  auto_sort: true, auto_fill_income: true, auto_request_docs: true, auto_route: true,
};

export function useAppSettings(enabled = true) {
  const uid = useUid();
  return useQuery({
    queryKey: qk.settings(uid),
    enabled: enabled && !!uid,
    queryFn: async () => {
      const { data, error } = await supabase.from('app_settings').select('*').maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

/**
 * The preferences every screen uses (APR range, terms, limits, company name…).
 * Staff read app_settings; dealers can't, so they ask `public_settings()` and fall back to the defaults.
 */
export function usePreferences(): { prefs: AppPreferences; isLoading: boolean } {
  const { isStaff } = useAuth();
  const uid = useUid();
  const settings = useAppSettings(isStaff);
  const pub = useQuery({
    queryKey: qk.preferences(uid),
    enabled: !isStaff && !!uid,
    retry: false,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      try {
        return await callRpc<unknown>('public_settings');
      } catch {
        return null;
      }
    },
  });
  if (isStaff) return { prefs: settings.data ? readPreferences(settings.data.preferences) : DEFAULT_PREFERENCES, isLoading: settings.isLoading };
  return { prefs: readPreferences(pub.data), isLoading: pub.isLoading };
}

export function useSaveSettings() {
  const qc = useQueryClient();
  const uid = useUid();
  return useMutation({
    mutationFn: async (patch: Tables['app_settings']['Update']) => {
      const { error } = await supabase.from('app_settings')
        .update({ ...patch, updated_at: new Date().toISOString(), updated_by: uid }).eq('id', true);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.settings(uid) });
      qc.invalidateQueries({ queryKey: qk.preferences(uid) });
    },
  });
}

export function fundingItemsOf(settings: AppSettings | null | undefined): FundingChecklistItem[] {
  const raw = settings?.funding_checklist_items;
  return Array.isArray(raw) ? (raw as unknown as FundingChecklistItem[]) : [];
}

// ------------------------------------------------------------------ dealers + people
export function useDealerStats(enabled = true) {
  const uid = useUid();
  return useQuery({
    queryKey: qk.dealerStats(uid),
    enabled: enabled && !!uid,
    queryFn: async () => {
      const { data, error } = await supabase.from('dealer_stats').select('*');
      if (error) throw error;
      return new Map((data ?? []).map((row) => [row.dealer_id!, row]));
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
  roles: AppRole[];
  dealerId: string | null;
}

export function useUsers(enabled = true) {
  const uid = useUid();
  return useQuery({
    queryKey: qk.users(uid),
    enabled: enabled && !!uid,
    queryFn: async (): Promise<StaffUser[]> => {
      const [profiles, roles, links] = await Promise.all([
        supabase.from('profiles').select('*').order('name'),
        supabase.from('user_roles').select('user_id, role'),
        supabase.from('dealer_users').select('user_id, dealer_id'),
      ]);
      if (profiles.error) throw profiles.error;
      if (roles.error) throw roles.error;
      if (links.error) throw links.error;
      const roleMap = new Map<string, AppRole[]>();
      for (const x of roles.data ?? []) roleMap.set(x.user_id, [...(roleMap.get(x.user_id) ?? []), x.role]);
      const linkMap = new Map((links.data ?? []).map((l) => [l.user_id, l.dealer_id]));
      return (profiles.data ?? []).map((p) => ({
        userId: p.user_id, name: p.name, email: p.email, department: p.department, isActive: p.is_active,
        lastLogin: p.last_login, createdAt: p.created_at, roles: roleMap.get(p.user_id) ?? [], dealerId: linkMap.get(p.user_id) ?? null,
      }));
    },
  });
}

export function useSetUserAccess() {
  const qc = useQueryClient();
  const uid = useUid();
  return useMutation({
    mutationFn: ({ userId, role, dealerId }: { userId: string; role: AppRole | null; dealerId?: string | null }) => setUserAccess(userId, role, dealerId),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.users(uid) }),
  });
}

export function useSetUserActive() {
  const qc = useQueryClient();
  const uid = useUid();
  return useMutation({
    mutationFn: ({ userId, active }: { userId: string; active: boolean }) => setUserActive(userId, active),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.users(uid) }),
  });
}

export type { Json };
