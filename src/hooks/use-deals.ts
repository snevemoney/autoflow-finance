import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { CreditDecision, Deal, DealStatus, Document } from '@/types/deal';

/* eslint-disable @typescript-eslint/no-explicit-any -- rows come from a joined select */

function transformDeal(row: any): Deal {
  const c = row.customers ?? {};
  const v = row.vehicles ?? {};
  const d = row.dealers ?? {};

  return {
    id: row.id,
    dealNumber: row.deal_number,
    status: row.status as DealStatus,
    priority: row.priority as Deal['priority'],
    customer: {
      id: c.id,
      firstName: c.first_name ?? '',
      lastName: c.last_name ?? '',
      email: c.email ?? '',
      phone: c.phone ?? '',
      address: {
        street: c.street ?? '',
        city: c.city ?? '',
        state: c.state ?? '',
        zip: c.zip ?? '',
      },
      employmentInfo: c.employer ? {
        employer: c.employer,
        jobTitle: c.job_title ?? 'Unknown',
        monthlyIncome: Number(c.monthly_income ?? 0),
        yearsEmployed: Number(c.years_employed ?? 0),
      } : undefined,
    },
    vehicle: {
      year: v.year,
      make: v.make ?? '',
      model: v.model ?? '',
      trim: v.trim ?? undefined,
      vin: v.vin ?? '',
      mileage: v.mileage ?? 0,
      color: v.color ?? undefined,
      condition: (v.condition ?? 'used') as 'new' | 'used' | 'certified',
      invoicePrice: Number(v.invoice_price ?? 0),
      msrp: v.msrp ?? undefined,
    },
    tradeIn: row.trade_in_vin ? {
      year: row.trade_in_year,
      make: row.trade_in_make ?? '',
      model: row.trade_in_model ?? '',
      vin: row.trade_in_vin,
      mileage: row.trade_in_mileage ?? 0,
      payoffAmount: row.trade_in_payoff ?? undefined,
      estimatedValue: Number(row.trade_in_value ?? 0),
    } : undefined,
    financingTerms: {
      loanAmount: Number(row.loan_amount),
      downPayment: Number(row.down_payment),
      apr: Number(row.apr),
      termMonths: row.term_months,
      monthlyPayment: Number(row.monthly_payment),
      totalInterest: Number(row.total_interest),
      totalCost: Number(row.total_cost),
    },
    creditInfo: row.credit_score ? {
      score: row.credit_score,
      bureau: (row.credit_bureau ?? 'equifax') as 'experian' | 'equifax' | 'transunion',
      pulledAt: row.credit_pulled_at ?? row.created_at,
      tier: (row.credit_tier ?? 'subprime') as 'prime' | 'near_prime' | 'subprime' | 'deep_subprime',
    } : undefined,
    dealerId: d.id ?? row.dealer_id,
    dealerName: d.name ?? '',
    dealerContact: d.contact_name ?? '',
    assignedTo: row.assigned_to ?? undefined,
    assignedDepartment: row.assigned_department as Deal['assignedDepartment'],
    documents: [],
    notes: [],
    timeline: [],
    decisionNotes: row.decision_notes ?? undefined,
    decisionBy: row.decision_by ?? undefined,
    decisionAt: row.decision_at ?? undefined,
    fundedAt: row.funded_at ?? undefined,
    fundedAmount: row.funded_amount ?? undefined,
    creditDecision: (row.credit_decision ?? 'pending') as CreditDecision,
    creditDecisionAt: row.credit_decision_at ?? undefined,
    creditDecisionNotes: row.credit_decision_notes ?? undefined,
    incomeVerifiedAt: row.income_verified_at ?? undefined,
    fundingChecklist: (row.funding_checklist ?? {}) as Record<string, boolean>,
    fundingApprovedAt: row.funding_approved_at ?? undefined,
    submittedByDealer: row.submitted_by_dealer ?? false,
    statusChangedAt: row.status_changed_at ?? row.updated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    flags: row.flags ?? [],
    ltv: Number(row.ltv ?? 0),
  };
}

export function transformDocument(doc: any): Document {
  return {
    id: doc.id,
    dealId: doc.deal_id,
    name: doc.name,
    type: doc.type,
    fileUrl: doc.file_url,
    fileSize: doc.file_size,
    uploadedAt: doc.created_at,
    uploadedBy: doc.uploaded_by ?? '',
    status: doc.status,
    notes: doc.notes ?? undefined,
    storagePath: doc.storage_path,
    previewPath: doc.preview_path,
    mimeType: doc.mime_type,
    processingStatus: doc.processing_status,
    processingError: doc.processing_error,
    typeSource: doc.type_source,
    classificationConfidence: doc.classification_confidence,
    aiModel: doc.ai_model,
  };
}

const DEAL_SELECT = `
  *,
  customers (*),
  vehicles (*),
  dealers (*)
`;

async function fetchDeals(): Promise<Deal[]> {
  const { data, error } = await supabase
    .from('deals')
    .select(DEAL_SELECT)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => transformDeal(row));
}

async function namesFor(ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (!unique.length) return new Map();
  const { data } = await supabase.from('profiles').select('user_id, name').in('user_id', unique);
  return new Map((data ?? []).map((p) => [p.user_id, p.name]));
}

async function fetchDealById(id: string, staff: boolean): Promise<Deal | null> {
  const extra = staff ? ', documents (*), deal_notes (*), deal_timeline (*)' : ', documents (*), deal_notes (*)';
  const { data, error } = await supabase
    .from('deals')
    .select(`${DEAL_SELECT}${extra}`)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as any;
  const deal = transformDeal(row);
  const names = await namesFor([
    ...(row.deal_notes ?? []).map((n: any) => n.created_by),
    ...(row.deal_timeline ?? []).map((t: any) => t.created_by),
    ...(row.documents ?? []).map((d: any) => d.uploaded_by),
  ]);
  const who = (uid: string | null, fallback: string) => (uid ? names.get(uid) ?? fallback : 'AutoFlow');

  deal.documents = (row.documents ?? [])
    .map((doc: any) => ({ ...transformDocument(doc), uploadedBy: doc.uploaded_by ? names.get(doc.uploaded_by) ?? deal.dealerName : 'AutoFlow' }))
    .sort((a: Document, b: Document) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
  const me = (await supabase.auth.getSession()).data.session?.user.id;
  deal.notes = (row.deal_notes ?? []).map((n: any) => ({
    id: n.id,
    dealId: n.deal_id,
    content: n.content,
    createdAt: n.created_at,
    createdBy: n.created_by === me ? 'You' : names.get(n.created_by) ?? (staff ? 'Dealer' : 'Lender'),
    isInternal: n.is_internal,
  })).sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  deal.timeline = (row.deal_timeline ?? []).map((t: any) => ({
    id: t.id,
    dealId: t.deal_id,
    type: t.type,
    description: t.description,
    createdAt: t.created_at,
    createdBy: who(t.created_by, 'Staff'),
    metadata: t.metadata,
  }));
  return deal;
}

type Watch = string | { table: string; filter?: string };

/** Keep react-query caches fresh from Supabase realtime (deals, documents, requests…). */
export function useRealtimeRefresh(channel: string | null, watches: Watch[], keys: unknown[][]) {
  const qc = useQueryClient();
  const signature = JSON.stringify(watches);
  useEffect(() => {
    if (!channel) return;
    let ch = supabase.channel(`rt-${channel}-${Math.random().toString(36).slice(2, 8)}`);
    for (const w of watches) {
      const { table, filter } = typeof w === 'string' ? { table: w, filter: undefined } : w;
      ch = ch.on('postgres_changes' as any, { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) }, () => {
        keys.forEach((k) => qc.invalidateQueries({ queryKey: k }));
      });
    }
    ch.subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, signature]);
}

export function useDeals() {
  useRealtimeRefresh('deals-list', ['deals'], [['deals']]);
  return useQuery({
    queryKey: ['deals'],
    queryFn: fetchDeals,
  });
}

export function useDeal(id: string | undefined, opts: { staff?: boolean } = {}) {
  const staff = opts.staff ?? true;
  useRealtimeRefresh(id ? `deal-${id}` : null, [
    { table: 'deals', filter: `id=eq.${id}` },
    { table: 'documents', filter: `deal_id=eq.${id}` },
    { table: 'document_requests', filter: `deal_id=eq.${id}` },
    ...(staff ? [{ table: 'deal_timeline', filter: `deal_id=eq.${id}` }, { table: 'income_sources', filter: `deal_id=eq.${id}` }] : []),
  ], [['deal', id], ['checklist', id], ['requests', id], ['income-sources', id], ['income-sources-detail', id]]);
  return useQuery({
    queryKey: ['deal', id],
    queryFn: () => fetchDealById(id!, staff),
    enabled: !!id,
  });
}

export function useDealsByStatus(status: DealStatus) {
  const { data: deals, ...rest } = useDeals();
  return {
    data: deals?.filter(d => d.status === status),
    ...rest,
  };
}

const DEPARTMENT_STATUSES: Record<'credit' | 'income' | 'funding', DealStatus[]> = {
  credit: ['credit_review'],
  income: ['income_verification'],
  funding: ['funding_review', 'approved'],
};

export function useDealsByDepartment(department: 'credit' | 'income' | 'funding') {
  const { data: deals, ...rest } = useDeals();
  return {
    data: deals?.filter(d => DEPARTMENT_STATUSES[department].includes(d.status)),
    ...rest,
  };
}

export function useDealers() {
  return useQuery({
    queryKey: ['dealers'],
    queryFn: async () => {
      const { data, error } = await supabase.from('dealers').select('*').order('name');
      if (error) throw error;
      return data ?? [];
    },
  });
}
