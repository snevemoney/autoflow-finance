import { useEffect } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { qk } from '@/lib/query-keys';
import { dealIdOf, subscribeTable, type ChangePayload } from '@/lib/realtime';
import { KeyBatcher } from '@/lib/batcher';

export type LiveTable =
  | 'deals' | 'documents' | 'document_requests' | 'deal_timeline' | 'deal_notes'
  | 'income_sources' | 'extracted_income_data' | 'notifications' | 'applicant_debts';

/** Which cached queries a change to `table` makes stale. */
export function keysForChange(uid: string, p: ChangePayload): unknown[][] {
  const dealId = dealIdOf(p) ?? undefined;
  const deal = dealId ? [[...qk.deal(uid, dealId)]] : [];
  switch (p.table) {
    case 'deals':
      return [[...qk.deals(uid)], [...qk.queueCounts(uid)], [...qk.dashboard(uid)], ...deal];
    case 'documents':
      return [...deal, [...qk.checklist(uid, dealId)], [...qk.incomeDocs(uid, dealId)]];
    case 'document_requests':
      return [[...qk.requests(uid, dealId)], [...qk.checklist(uid, dealId)], [...qk.dealerRequests(uid)], [...qk.queueCounts(uid)], [...qk.deals(uid)]];
    case 'deal_timeline':
    case 'deal_notes':
      return deal;
    case 'income_sources':
      return [[...qk.incomeSources(uid, dealId)]];
    case 'extracted_income_data':
      return [[...qk.extractions(uid, dealId)], [...qk.incomeDocs(uid, dealId)]];
    case 'applicant_debts':
      return [[...qk.debts(uid, dealId)]];
    case 'notifications':
      return [[...qk.notifications(uid)]];
    default:
      return [];
  }
}

const batchers = new WeakMap<QueryClient, KeyBatcher>();
function batcherFor(qc: QueryClient) {
  let b = batchers.get(qc);
  if (!b) {
    b = new KeyBatcher((keys) => keys.forEach((queryKey) => qc.invalidateQueries({ queryKey })), 400);
    batchers.set(qc, b);
  }
  return b;
}

/**
 * Keep the listed tables live. Each table has one shared channel for the whole app; changes are
 * turned into the specific query keys they affect and invalidated after a short debounce.
 */
export function useLiveUpdates(tables: LiveTable[], enabled = true) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const signature = tables.join(',');
  useEffect(() => {
    if (!enabled || !uid) return;
    const batcher = batcherFor(qc);
    const offs = signature.split(',').filter(Boolean).map((table) =>
      subscribeTable(table, (p) => batcher.add(...keysForChange(uid, p))));
    return () => offs.forEach((off) => off());
  }, [qc, uid, signature, enabled]);
}
