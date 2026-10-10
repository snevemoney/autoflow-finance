/**
 * Typed wrappers for the server API in the hardening contract (RPCs + edge functions).
 *
 * The generated `src/integrations/supabase/types.ts` doesn't know these names yet, so every call goes
 * through `callRpc`/`invokeFunction` here (one cast, in one place) and the result is normalised into a
 * plain typed object. Pages and hooks never call `supabase.rpc` for these directly.
 */
import { supabase } from '@/integrations/supabase/client';
import type { CreditCondition, DealStatus } from '@/types/deal';

type RpcResult = PromiseLike<{ data: unknown; error: { message: string; code?: string; details?: string; hint?: string } | null }>;
type RpcClient = { rpc: (fn: string, args?: Record<string, unknown>) => RpcResult };

export type AppRole = 'dealer' | 'credit_analyst' | 'income_verifier' | 'funding_manager' | 'admin';
export type CreditTier = 'prime' | 'near_prime' | 'subprime' | 'deep_subprime';
export type CreditBureau = 'experian' | 'equifax' | 'transunion';

/** Readable text for anything thrown by supabase-js, fetch or our own code. */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return String(e ?? 'Unknown error');
}

export class RpcError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = 'RpcError';
    this.code = code;
  }
}

/** Server validation errors come back as "field: message" (e.g. "vin: VIN must be 17 characters"). */
export function parseFieldError(message: string): { field: string; message: string } | null {
  const m = /^\s*([a-z_][a-z0-9_.]*)\s*:\s*(.+)$/i.exec(message ?? '');
  if (!m) return null;
  return { field: m[1].toLowerCase(), message: m[2].trim() };
}

export async function callRpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await (supabase as unknown as RpcClient).rpc(fn, args);
  if (error) throw new RpcError(error.message, error.code);
  return data as T;
}

const num = (v: unknown, d = 0): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : d;
};
const numOrNull = (v: unknown): number | null => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

// ------------------------------------------------------------------ deal moves and decisions
export function adminMoveDeal(dealId: string, status: DealStatus, note?: string | null): Promise<DealStatus> {
  return callRpc<DealStatus>('admin_move_deal', { _deal_id: dealId, _status: status, _note: note?.trim() || null });
}

export function declineDeal(dealId: string, reason: string, dealerMessage?: string | null): Promise<DealStatus> {
  return callRpc<DealStatus>('decline_deal', {
    _deal_id: dealId, _reason: reason.trim(), _dealer_message: dealerMessage?.trim() || null,
  });
}

export type CreditDecisionValue = 'approved' | 'conditional' | 'declined';

export interface CreditDecisionInput {
  dealId: string;
  decision: CreditDecisionValue;
  /** internal — staff history only */
  notes?: string | null;
  score?: number | null;
  tier?: CreditTier | null;
  bureau?: CreditBureau | null;
  /** required (1–10) for a conditional approval */
  conditions?: string[] | null;
  /** what the dealer sees */
  dealerMessage?: string | null;
}

export const MAX_CONDITIONS = 10;

export function recordCreditDecision(input: CreditDecisionInput): Promise<DealStatus> {
  const conditions = (input.conditions ?? []).map((c) => c.trim()).filter(Boolean);
  if (input.decision === 'conditional' && (conditions.length < 1 || conditions.length > MAX_CONDITIONS)) {
    return Promise.reject(new RpcError(`A conditional approval needs 1 to ${MAX_CONDITIONS} conditions`));
  }
  return callRpc<DealStatus>('record_credit_decision', {
    _deal_id: input.dealId,
    _decision: input.decision,
    _notes: input.notes?.trim() || null,
    _score: input.score ?? null,
    _tier: input.tier ?? null,
    _bureau: input.bureau ?? null,
    _conditions: input.decision === 'conditional' ? conditions.map((label) => ({ label })) : null,
    _dealer_message: input.dealerMessage?.trim() || null,
  });
}

export function normalizeConditions(raw: unknown): CreditCondition[] {
  return arr(raw).map((c, i) => {
    const o = obj(c);
    return {
      id: String(o.id ?? `c${i}`),
      label: String(o.label ?? ''),
      cleared_at: (o.cleared_at as string | null) ?? null,
      cleared_by: (o.cleared_by as string | null) ?? null,
    };
  }).filter((c) => c.label);
}

export async function setCreditCondition(dealId: string, conditionId: string, cleared: boolean): Promise<CreditCondition[]> {
  const data = await callRpc<unknown>('set_credit_condition', { _deal_id: dealId, _condition_id: conditionId, _cleared: cleared });
  return normalizeConditions(data);
}

export function updateFundingChecklist(dealId: string, items: Record<string, boolean>) {
  return callRpc<unknown>('update_funding_checklist', { _deal_id: dealId, _items: items });
}

export function approveFunding(dealId: string, notes?: string | null): Promise<DealStatus> {
  return callRpc<DealStatus>('approve_funding', { _deal_id: dealId, _notes: notes?.trim() || null });
}

export function markFunded(dealId: string, amount?: number | null): Promise<DealStatus> {
  return callRpc<DealStatus>('mark_funded', { _deal_id: dealId, _amount: amount ?? null });
}

// ------------------------------------------------------------------ accounts (admin only)
export function setUserAccess(userId: string, role: AppRole | null, dealerId?: string | null): Promise<void> {
  if (role === 'dealer' && !dealerId) return Promise.reject(new RpcError('Choose a dealership for a dealer account'));
  return callRpc<void>('set_user_access', {
    _user_id: userId, _role: role, _dealer_id: role === 'dealer' ? dealerId ?? null : null,
  });
}

export function setUserActive(userId: string, active: boolean): Promise<void> {
  return callRpc<void>('set_user_active', { _user_id: userId, _active: active });
}

// ------------------------------------------------------------------ aggregates
export interface QueueCounts {
  new_submission: number;
  document_review: number;
  credit_review: number;
  income_verification: number;
  funding_review: number;
  approved: number;
  open_requests: number;
}

const QUEUE_KEYS: (keyof QueueCounts)[] = [
  'new_submission', 'document_review', 'credit_review', 'income_verification', 'funding_review', 'approved', 'open_requests',
];

export function normalizeQueueCounts(raw: unknown): QueueCounts {
  const o = obj(raw);
  return Object.fromEntries(QUEUE_KEYS.map((k) => [k, num(o[k])])) as unknown as QueueCounts;
}

export async function queueCounts(): Promise<QueueCounts> {
  return normalizeQueueCounts(await callRpc<unknown>('queue_counts'));
}

export interface TopDealer { dealer_id: string; name: string; funded: number; submitted: number; approval_rate: number | null }

export interface DashboardMetrics {
  active: number;
  funded_this_month_amount: number;
  funded_this_month_count: number;
  /** 0..1, null before any decision */
  approval_rate: number | null;
  in_review: number;
  stuck_over_3_days: number;
  waiting_on_dealer: number;
  by_status: Record<string, number>;
  automation_7d: { auto_sorted: number; auto_filled: number; requested: number; auto_routed: number };
  top_dealers: TopDealer[];
}

export function normalizeDashboard(raw: unknown): DashboardMetrics {
  const o = obj(raw);
  const a = obj(o.automation_7d);
  const byStatus = Object.fromEntries(Object.entries(obj(o.by_status)).map(([k, v]) => [k, num(v)]));
  return {
    active: num(o.active),
    funded_this_month_amount: num(o.funded_this_month_amount),
    funded_this_month_count: num(o.funded_this_month_count),
    approval_rate: numOrNull(o.approval_rate),
    in_review: num(o.in_review),
    stuck_over_3_days: num(o.stuck_over_3_days),
    waiting_on_dealer: num(o.waiting_on_dealer),
    by_status: byStatus,
    automation_7d: { auto_sorted: num(a.auto_sorted), auto_filled: num(a.auto_filled), requested: num(a.requested), auto_routed: num(a.auto_routed) },
    top_dealers: arr(o.top_dealers).map((d) => {
      const x = obj(d);
      return { dealer_id: String(x.dealer_id ?? ''), name: String(x.name ?? ''), funded: num(x.funded), submitted: num(x.submitted), approval_rate: numOrNull(x.approval_rate) };
    }),
  };
}

export async function dashboardMetrics(): Promise<DashboardMetrics> {
  return normalizeDashboard(await callRpc<unknown>('dashboard_metrics'));
}

export interface ReportDealerRow { dealer_id: string; name: string; submitted: number; funded_count: number; funded_amount: number }
export interface ReportMonth { month: string; submitted: number; funded_count: number; funded_amount: number }
export interface ReportMetrics {
  submitted: number;
  funded_count: number;
  funded_amount: number;
  declined: number;
  approval_rate: number | null;
  avg_days_to_fund: number | null;
  by_dealer: ReportDealerRow[];
  by_month: ReportMonth[];
}

export function normalizeReport(raw: unknown): ReportMetrics {
  const o = obj(raw);
  return {
    submitted: num(o.submitted),
    funded_count: num(o.funded_count),
    funded_amount: num(o.funded_amount),
    declined: num(o.declined),
    approval_rate: numOrNull(o.approval_rate),
    avg_days_to_fund: numOrNull(o.avg_days_to_fund),
    by_dealer: arr(o.by_dealer).map((d) => {
      const x = obj(d);
      return {
        dealer_id: String(x.dealer_id ?? ''), name: String(x.name ?? x.dealer_name ?? ''),
        submitted: num(x.submitted), funded_count: num(x.funded_count ?? x.funded), funded_amount: num(x.funded_amount),
      };
    }),
    by_month: arr(o.by_month).map((m) => {
      const x = obj(m);
      return { month: String(x.month ?? ''), submitted: num(x.submitted), funded_count: num(x.funded_count), funded_amount: num(x.funded_amount) };
    }),
  };
}

/** `from`/`to` are calendar dates (YYYY-MM-DD), inclusive. */
export async function reportMetrics(from: string, to: string): Promise<ReportMetrics> {
  return normalizeReport(await callRpc<unknown>('report_metrics', { _from: from, _to: to }));
}

/** Approval rate from the server is 0..1; some callers stored percentages — accept both. */
export function percent(rate: number | null | undefined): string {
  if (rate == null || !Number.isFinite(rate)) return '—';
  const pct = rate <= 1 ? rate * 100 : rate;
  return `${Math.round(pct)}%`;
}

// ------------------------------------------------------------------ documents
/** process-document accepts at most this many ids per call. */
export const PROCESS_BATCH = 5;

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface ProcessResult { started: string[]; failed: string[] }

/** Ask the server to (re)read documents, in batches of five. Never throws — failures are returned. */
export async function processDocuments(documentIds: string[], opts: { force?: boolean } = {}): Promise<ProcessResult> {
  const result: ProcessResult = { started: [], failed: [] };
  for (const batch of chunk([...new Set(documentIds)], PROCESS_BATCH)) {
    try {
      const { error } = await supabase.functions.invoke('process-document', {
        body: { documentIds: batch, force: !!opts.force, background: true },
      });
      if (error) throw error;
      result.started.push(...batch);
    } catch (e) {
      console.warn('process-document could not be started', errorMessage(e));
      result.failed.push(...batch);
    }
  }
  return result;
}

/** Owner dealer or staff: put a failed document back in the queue, then start reading it. */
export async function retryDocument(documentId: string): Promise<{ queued: boolean; started: boolean }> {
  const queued = await callRpc<boolean>('retry_document', { _document_id: documentId });
  const { started } = await processDocuments([documentId]);
  return { queued: queued !== false, started: started.length > 0 };
}

/**
 * "Retry" after uploads whose reading didn't start (still pending) or failed: re-queue each one
 * (a no-op for documents that aren't failed), then start reading them in batches of five.
 */
export async function retryDocuments(documentIds: string[]): Promise<ProcessResult> {
  for (const id of documentIds) {
    try {
      await callRpc<boolean>('retry_document', { _document_id: id });
    } catch (e) {
      console.warn('retry_document failed', id, errorMessage(e));
    }
  }
  return processDocuments(documentIds);
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Only https links (http only for a local dev server) may reach an <iframe>/<img>/<a>. */
export function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    const u = new URL(value);
    if (u.protocol === 'https:') return u.toString();
    if (u.protocol === 'http:' && LOCAL_HOSTS.has(u.hostname)) return u.toString();
  } catch {
    /* not a URL */
  }
  return null;
}

/** A short-lived link to a document's file or preview, from the `document-url` edge function. */
export async function documentUrl(documentId: string, kind: 'file' | 'preview' = 'file'): Promise<string> {
  const { data, error } = await supabase.functions.invoke('document-url', { body: { documentId, kind } });
  if (error) throw error;
  const url = safeHttpUrl((data as { url?: unknown } | null)?.url);
  if (!url) throw new RpcError('The file link could not be created');
  return url;
}
