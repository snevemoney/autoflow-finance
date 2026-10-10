import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { qk } from '@/lib/query-keys';
import { dashboardMetrics, normalizeConditions, queueCounts, reportMetrics } from '@/lib/rpc';
import { useLiveUpdates } from './use-live';
import type { CreditDecision, Deal, DealStatus, Document } from '@/types/deal';
import { searchWords } from '@/lib/search';

export { searchWords };

type Row = Record<string, unknown>;
const r = (v: unknown): Row => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : {});
const s = (v: unknown, d = ''): string => (v == null ? d : String(v));
const n = (v: unknown, d = 0): number => (v == null || v === '' || !Number.isFinite(Number(v)) ? d : Number(v));
const opt = <T,>(v: unknown): T | undefined => (v == null ? undefined : (v as T));

/** Turn a deals row (with embedded customers / vehicles / dealers) into the app's Deal. */
export function transformDeal(raw: unknown): Deal {
  const row = r(raw);
  const c = r(row.customers);
  const v = r(row.vehicles);
  const d = r(row.dealers);
  const requests = Array.isArray(row.document_requests) ? (row.document_requests as Row[]) : null;

  return {
    id: s(row.id),
    dealNumber: s(row.deal_number),
    status: s(row.status) as DealStatus,
    priority: (s(row.priority, 'normal') as Deal['priority']),
    customer: {
      id: s(c.id),
      firstName: s(c.first_name),
      lastName: s(c.last_name),
      email: s(c.email),
      phone: s(c.phone),
      dateOfBirth: opt<string>(c.date_of_birth),
      address: { street: s(c.street), city: s(c.city), state: s(c.state), zip: s(c.zip) },
      employmentInfo: c.employer || c.monthly_income != null ? {
        employer: s(c.employer),
        jobTitle: s(c.job_title),
        monthlyIncome: n(c.monthly_income),
        yearsEmployed: n(c.years_employed),
      } : undefined,
    },
    vehicle: {
      year: n(v.year),
      make: s(v.make),
      model: s(v.model),
      trim: opt<string>(v.trim),
      vin: s(v.vin),
      mileage: n(v.mileage),
      color: opt<string>(v.color),
      condition: (s(v.condition, 'used') as Deal['vehicle']['condition']),
      invoicePrice: n(v.invoice_price),
      msrp: v.msrp == null ? undefined : n(v.msrp),
    },
    tradeIn: row.trade_in_vin || row.trade_in_make ? {
      year: n(row.trade_in_year),
      make: s(row.trade_in_make),
      model: s(row.trade_in_model),
      vin: s(row.trade_in_vin),
      mileage: n(row.trade_in_mileage),
      payoffAmount: row.trade_in_payoff == null ? undefined : n(row.trade_in_payoff),
      estimatedValue: n(row.trade_in_value),
    } : undefined,
    financingTerms: {
      loanAmount: n(row.loan_amount),
      downPayment: n(row.down_payment),
      apr: n(row.apr),
      termMonths: n(row.term_months),
      monthlyPayment: n(row.monthly_payment),
      totalInterest: n(row.total_interest),
      totalCost: n(row.total_cost),
    },
    creditInfo: row.credit_score ? {
      score: n(row.credit_score),
      bureau: (s(row.credit_bureau, 'equifax') as 'experian' | 'equifax' | 'transunion'),
      pulledAt: s(row.credit_pulled_at ?? row.created_at),
      tier: (s(row.credit_tier, 'subprime') as 'prime' | 'near_prime' | 'subprime' | 'deep_subprime'),
    } : undefined,
    dealerId: s(d.id ?? row.dealer_id),
    dealerName: s(d.name),
    dealerContact: s(d.contact_name),
    assignedTo: opt<string>(row.assigned_to),
    assignedDepartment: opt<Deal['assignedDepartment']>(row.assigned_department),
    documents: [],
    notes: [],
    timeline: [],
    decisionNotes: opt<string>(row.decision_notes),
    decisionBy: opt<string>(row.decision_by),
    decisionAt: opt<string>(row.decision_at),
    dealerMessage: opt<string>(row.dealer_message) || undefined,
    creditConditions: normalizeConditions(row.credit_conditions),
    fundedAt: opt<string>(row.funded_at),
    fundedAmount: row.funded_amount == null ? undefined : n(row.funded_amount),
    creditDecision: (s(row.credit_decision, 'pending') as CreditDecision),
    creditDecisionAt: opt<string>(row.credit_decision_at),
    creditDecisionNotes: opt<string>(row.credit_decision_notes),
    incomeVerifiedAt: opt<string>(row.income_verified_at),
    fundingChecklist: (r(row.funding_checklist) as Record<string, boolean>),
    fundingApprovedAt: opt<string>(row.funding_approved_at),
    submittedByDealer: !!row.submitted_by_dealer,
    statusChangedAt: s(row.status_changed_at ?? row.updated_at ?? row.created_at),
    createdAt: s(row.created_at),
    updatedAt: s(row.updated_at ?? row.created_at),
    flags: Array.isArray(row.flags) ? (row.flags as string[]) : [],
    ltv: n(row.ltv),
    openRequests: requests ? requests.filter((x) => !x.status || x.status === 'open').length : undefined,
    debts: Array.isArray(row.applicant_debts)
      ? (row.applicant_debts as Row[]).map((x) => ({ monthly_payment: n(x.monthly_payment), debt_type: s(x.debt_type), is_court_ordered: !!x.is_court_ordered }))
      : undefined,
    incomeSources: Array.isArray(row.income_sources)
      ? (row.income_sources as Row[]).map((x) => ({
        calculated_monthly_income: x.calculated_monthly_income == null ? null : n(x.calculated_monthly_income),
        stated_monthly_income: n(x.stated_monthly_income),
      }))
      : undefined,
  };
}

export function transformDocument(raw: unknown): Document {
  const doc = r(raw);
  return {
    id: s(doc.id),
    dealId: s(doc.deal_id),
    name: s(doc.name, 'Document'),
    type: s(doc.type, 'other') as Document['type'],
    fileUrl: s(doc.file_url),
    fileSize: n(doc.file_size),
    uploadedAt: s(doc.created_at),
    uploadedBy: s(doc.uploaded_by),
    uploadedById: (doc.uploaded_by as string | null) ?? null,
    status: s(doc.status, 'pending') as Document['status'],
    notes: opt<string>(doc.notes),
    storagePath: (doc.storage_path as string | null) ?? null,
    previewPath: (doc.preview_path as string | null) ?? null,
    mimeType: (doc.mime_type as string | null) ?? null,
    processingStatus: s(doc.processing_status, 'pending') as Document['processingStatus'],
    processingError: (doc.processing_error as string | null) ?? null,
    processingStartedAt: (doc.processing_started_at as string | null) ?? null,
    attemptCount: n(doc.attempt_count),
    typeSource: s(doc.type_source, 'manual') as Document['typeSource'],
    classificationConfidence: (doc.classification_confidence as string | null) ?? null,
    aiModel: (doc.ai_model as string | null) ?? null,
  };
}

// ------------------------------------------------------------------ selects
const CUSTOMER_LIST = 'customers (id, first_name, last_name, email, phone, city, state, employer, job_title, monthly_income, years_employed)';
/** never `customers(*)`: the table still carries an ssn column the browser must not load */
const CUSTOMER_DETAIL = 'customers (id, first_name, last_name, email, phone, street, city, state, zip, employer, job_title, monthly_income, years_employed, date_of_birth)';
const VEHICLE = 'vehicles (id, year, make, model, trim, vin, mileage, color, condition, invoice_price, msrp)';
const DEALER = 'dealers (id, name, contact_name)';

const LIST_COLUMNS = `id, deal_number, status, priority, dealer_id, loan_amount, down_payment, apr, term_months, monthly_payment,
  total_interest, total_cost, credit_score, credit_tier, credit_bureau, credit_pulled_at, ltv, flags, status_changed_at,
  created_at, updated_at, funded_at, funded_amount, submitted_by_dealer, credit_decision`;

/** Columns a dealer may load: no internal decision notes. */
const DEALER_DEAL_COLUMNS = `id, deal_number, status, priority, dealer_id, loan_amount, down_payment, apr, term_months, monthly_payment,
  total_interest, total_cost, ltv, status_changed_at, created_at, updated_at, funded_at, funded_amount, submitted_by_dealer,
  dealer_message, trade_in_year, trade_in_make, trade_in_model, trade_in_vin, trade_in_mileage, trade_in_payoff, trade_in_value`;

export type DealExtra = 'requests' | 'debts' | 'income';

export function dealListSelect(extras: DealExtra[] = []): string {
  const parts = [LIST_COLUMNS, CUSTOMER_LIST, VEHICLE, DEALER];
  if (extras.includes('requests')) parts.push('document_requests (id, status)');
  if (extras.includes('debts')) parts.push('applicant_debts (monthly_payment, debt_type, is_court_ordered)');
  if (extras.includes('income')) parts.push('income_sources (calculated_monthly_income, stated_monthly_income)');
  return parts.join(', ');
}

// ------------------------------------------------------------------ list queries
export type DealSortKey = 'created_at' | 'updated_at' | 'deal_number' | 'loan_amount' | 'credit_score' | 'ltv' | 'status' | 'status_changed_at' | 'funded_at';

export const OPEN_STATUSES: DealStatus[] = ['new_submission', 'document_review', 'credit_review', 'income_verification', 'funding_review', 'approved'];
/** working stages where a deal can be "stuck" (approved is waiting on funding, not on us) */
export const WORKING_STATUSES: DealStatus[] = ['new_submission', 'document_review', 'credit_review', 'income_verification', 'funding_review'];

export interface DealQuery {
  statuses?: DealStatus[];
  dealerId?: string | null;
  search?: string;
  sort?: DealSortKey;
  ascending?: boolean;
  page?: number;
  pageSize?: number;
  /** only deals sitting longer than this many days in a working stage */
  stuckDays?: number | null;
  /** created on or after / before (ISO) */
  createdFrom?: string;
  createdTo?: string;
  /** only deals with an open document request */
  waitingOnDealer?: boolean;
  /** only deals above this loan amount */
  loanAbove?: number | null;
  creditTiers?: string[];
  extras?: DealExtra[];
}

// The query builder's generic types are too deep to name here; keep it structural.
interface Filterable {
  in(col: string, values: unknown[]): this;
  eq(col: string, value: unknown): this;
  lt(col: string, value: unknown): this;
  gt(col: string, value: unknown): this;
  gte(col: string, value: unknown): this;
  ilike(col: string, pattern: string): this;
}

export function applyDealFilters<Q extends Filterable>(query: Q, q: DealQuery, now = new Date()): Q {
  let x = query;
  if (q.stuckDays != null && q.stuckDays > 0) {
    const statuses = (q.statuses?.length ? q.statuses : WORKING_STATUSES).filter((st) => WORKING_STATUSES.includes(st));
    x = x.in('status', statuses.length ? statuses : WORKING_STATUSES)
      .lt('status_changed_at', new Date(now.getTime() - q.stuckDays * 86_400_000).toISOString());
  } else if (q.statuses?.length === 1) {
    x = x.eq('status', q.statuses[0]);
  } else if (q.statuses?.length) {
    x = x.in('status', q.statuses);
  }
  if (q.dealerId) x = x.eq('dealer_id', q.dealerId);
  if (q.createdFrom) x = x.gte('created_at', q.createdFrom);
  if (q.createdTo) x = x.lt('created_at', q.createdTo);
  if (q.loanAbove != null) x = x.gt('loan_amount', q.loanAbove);
  if (q.creditTiers?.length) x = x.in('credit_tier', q.creditTiers);
  if (q.waitingOnDealer) x = x.eq('document_requests.status', 'open');
  for (const w of searchWords(q.search)) x = x.ilike('search_text', `%${w}%`);
  return x;
}

export interface DealPage { rows: Deal[]; total: number }

export async function fetchDealRange(q: DealQuery, from: number, to: number, count: 'exact' | 'planned' | null = 'exact'): Promise<{ rows: Deal[]; total: number | null }> {
  let select = dealListSelect(q.extras);
  if (q.waitingOnDealer) select = select.replace('document_requests (id, status)', '') + ', document_requests!inner (id, status)';
  let query = supabase.from('deals').select(select, count ? { count } : undefined);
  query = applyDealFilters(query as unknown as Filterable, q) as unknown as typeof query;
  if (q.extras?.includes('requests') && !q.waitingOnDealer) query = query.eq('document_requests.status', 'open');
  const sort = q.sort ?? 'created_at';
  query = query.order(sort, { ascending: q.ascending ?? false, nullsFirst: false }).order('id', { ascending: true });
  const { data, error, count: total } = await query.range(from, to);
  if (error) throw error;
  return { rows: ((data ?? []) as unknown[]).map(transformDeal), total: total ?? null };
}

export async function fetchDealPage(q: DealQuery): Promise<DealPage> {
  const size = q.pageSize ?? 25;
  const page = Math.max(0, q.page ?? 0);
  const { rows, total } = await fetchDealRange(q, page * size, page * size + size - 1);
  return { rows, total: total ?? rows.length };
}

export async function countDeals(q: DealQuery): Promise<number> {
  const select = q.waitingOnDealer ? 'id, document_requests!inner (id)' : 'id';
  let query = supabase.from('deals').select(select, { count: 'exact', head: true });
  query = applyDealFilters(query as unknown as Filterable, q) as unknown as typeof query;
  const { error, count } = await query;
  if (error) throw error;
  return count ?? 0;
}

function useUid() {
  const { user } = useAuth();
  return user?.id ?? null;
}

/** One page of deals, filtered / searched / sorted on the server. */
export function useDealPage(q: DealQuery, opts: { enabled?: boolean; live?: boolean } = {}) {
  const uid = useUid();
  useLiveUpdates(['deals', 'document_requests'], opts.live !== false);
  return useQuery({
    queryKey: qk.dealPage(uid, q),
    queryFn: () => fetchDealPage(q),
    enabled: !!uid && opts.enabled !== false,
    placeholderData: keepPreviousData,
  });
}

/** A head-only count (no rows) for a filter. */
export function useDealCount(q: DealQuery, opts: { enabled?: boolean } = {}) {
  const uid = useUid();
  return useQuery({
    queryKey: qk.dealCount(uid, q),
    queryFn: () => countDeals(q),
    enabled: !!uid && opts.enabled !== false,
  });
}

/** Sidebar / queue badges: counts per stage + open requests, from `queue_counts()`. */
export function useQueueCounts(opts: { enabled?: boolean } = {}) {
  const uid = useUid();
  useLiveUpdates(['deals', 'document_requests'], opts.enabled !== false);
  return useQuery({
    queryKey: qk.queueCounts(uid),
    queryFn: queueCounts,
    enabled: !!uid && opts.enabled !== false,
    staleTime: 30_000,
  });
}

export function useDashboardMetrics() {
  const uid = useUid();
  useLiveUpdates(['deals']);
  return useQuery({ queryKey: qk.dashboard(uid), queryFn: dashboardMetrics, enabled: !!uid, staleTime: 30_000 });
}

export function useReportMetrics(from: string, to: string) {
  const uid = useUid();
  return useQuery({
    queryKey: qk.report(uid, from, to),
    queryFn: () => reportMetrics(from, to),
    enabled: !!uid,
    placeholderData: keepPreviousData,
  });
}

/**
 * @deprecated Loads up to 200 open deals. Kept only so the current sidebar keeps compiling until it
 * switches to `useQueueCounts()` — don't use it in new code.
 */
export function useDeals() {
  const uid = useUid();
  const q: DealQuery = { statuses: OPEN_STATUSES, pageSize: 200 };
  return useQuery({
    queryKey: qk.dealPage(uid, { legacy: true }),
    queryFn: async () => (await fetchDealPage(q)).rows,
    enabled: !!uid,
  });
}

// ------------------------------------------------------------------ one deal
async function namesFor(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  // a handful of authors per deal, not a list of deals
  const unique = [...new Set(ids.filter((x): x is string => !!x))].slice(0, 100);
  if (!unique.length) return new Map();
  const { data } = await supabase.from('profiles').select('user_id, name').in('user_id', unique);
  return new Map((data ?? []).map((p) => [p.user_id, p.name]));
}

export async function fetchDealById(id: string, staff: boolean, me: string | null): Promise<Deal | null> {
  const select = staff
    ? `*, ${CUSTOMER_DETAIL}, ${VEHICLE}, ${DEALER}, documents (*), deal_notes (*), deal_timeline (*)`
    : `${DEALER_DEAL_COLUMNS}, ${CUSTOMER_DETAIL}, ${VEHICLE}, ${DEALER}, documents (*), deal_notes (*)`;
  const { data, error } = await supabase.from('deals').select(select).eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as unknown as Row;
  const deal = transformDeal(row);
  const docs = (row.documents as Row[] | undefined) ?? [];
  const notes = (row.deal_notes as Row[] | undefined) ?? [];
  const timeline = (row.deal_timeline as Row[] | undefined) ?? [];
  const names = await namesFor([
    ...notes.map((x) => x.created_by as string),
    ...timeline.map((t) => t.created_by as string),
    ...docs.map((x) => x.uploaded_by as string),
  ]);

  deal.documents = docs
    .map((doc) => {
      const d = transformDocument(doc);
      const uploader = doc.uploaded_by as string | null;
      return { ...d, uploadedBy: uploader ? (uploader === me ? 'You' : names.get(uploader) ?? deal.dealerName) : 'AutoFlow' };
    })
    .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
  deal.notes = notes.map((x) => ({
    id: s(x.id),
    dealId: s(x.deal_id),
    content: s(x.content),
    createdAt: s(x.created_at),
    createdBy: x.created_by === me ? 'You' : names.get(s(x.created_by)) ?? (staff ? 'Dealer' : 'Lender'),
    isInternal: !!x.is_internal,
  })).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  deal.timeline = timeline.map((t) => ({
    id: s(t.id),
    dealId: s(t.deal_id),
    type: s(t.type) as Deal['timeline'][number]['type'],
    description: s(t.description),
    createdAt: s(t.created_at),
    createdBy: t.created_by ? (t.created_by === me ? 'You' : names.get(s(t.created_by)) ?? 'Staff') : 'AutoFlow',
    metadata: r(t.metadata),
  }));
  return deal;
}

export function useDeal(id: string | undefined, opts: { staff?: boolean } = {}) {
  const staff = opts.staff ?? true;
  const uid = useUid();
  useLiveUpdates(staff
    ? ['deals', 'documents', 'document_requests', 'deal_timeline', 'deal_notes', 'income_sources', 'extracted_income_data']
    : ['deals', 'documents', 'document_requests', 'deal_notes'], !!id);
  return useQuery({
    queryKey: qk.deal(uid, id),
    queryFn: () => fetchDealById(id!, staff, uid),
    enabled: !!id && !!uid,
  });
}

export function useDealers() {
  const uid = useUid();
  return useQuery({
    queryKey: qk.dealers(uid),
    enabled: !!uid,
    queryFn: async () => {
      const { data, error } = await supabase.from('dealers').select('*').order('name');
      if (error) throw error;
      return data ?? [];
    },
  });
}
