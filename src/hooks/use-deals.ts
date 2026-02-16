import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Deal, DealStatus } from '@/types/deal';

interface DbDeal {
  id: string;
  deal_number: string;
  status: string;
  priority: string;
  customer_id: string;
  vehicle_id: string;
  dealer_id: string;
  loan_amount: number;
  down_payment: number;
  apr: number;
  term_months: number;
  monthly_payment: number;
  total_interest: number;
  total_cost: number;
  credit_score: number | null;
  credit_bureau: string | null;
  credit_pulled_at: string | null;
  credit_tier: string | null;
  ltv: number | null;
  flags: string[] | null;
  assigned_to: string | null;
  assigned_department: string | null;
  decision_notes: string | null;
  decision_by: string | null;
  decision_at: string | null;
  funded_at: string | null;
  funded_amount: number | null;
  created_at: string;
  updated_at: string;
  customers: {
    id: string;
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
    street: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    employer: string | null;
    job_title: string | null;
    monthly_income: number | null;
    years_employed: number | null;
  };
  vehicles: {
    id: string;
    year: number;
    make: string;
    model: string;
    trim: string | null;
    vin: string;
    mileage: number;
    color: string | null;
    condition: string;
    invoice_price: number;
    msrp: number | null;
  };
  dealers: {
    id: string;
    name: string;
    contact_name: string;
    code: string;
    email: string;
    phone: string;
    street: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    status: string;
  };
}

function transformDeal(row: DbDeal): Deal {
  const c = row.customers;
  const v = row.vehicles;
  const d = row.dealers;

  return {
    id: row.id,
    dealNumber: row.deal_number,
    status: row.status as DealStatus,
    priority: row.priority as Deal['priority'],
    customer: {
      id: c.id,
      firstName: c.first_name,
      lastName: c.last_name,
      email: c.email,
      phone: c.phone,
      address: {
        street: c.street ?? '',
        city: c.city ?? '',
        state: c.state ?? '',
        zip: c.zip ?? '',
      },
      employmentInfo: c.employer ? {
        employer: c.employer,
        jobTitle: c.job_title ?? 'Unknown',
        monthlyIncome: c.monthly_income ?? 0,
        yearsEmployed: c.years_employed ?? 0,
      } : undefined,
    },
    vehicle: {
      year: v.year,
      make: v.make,
      model: v.model,
      trim: v.trim ?? undefined,
      vin: v.vin,
      mileage: v.mileage,
      color: v.color ?? undefined,
      condition: v.condition as 'new' | 'used' | 'certified',
      invoicePrice: v.invoice_price,
      msrp: v.msrp ?? undefined,
    },
    financingTerms: {
      loanAmount: row.loan_amount,
      downPayment: row.down_payment,
      apr: row.apr,
      termMonths: row.term_months,
      monthlyPayment: row.monthly_payment,
      totalInterest: row.total_interest,
      totalCost: row.total_cost,
    },
    creditInfo: row.credit_score ? {
      score: row.credit_score,
      bureau: (row.credit_bureau ?? 'experian') as 'experian' | 'equifax' | 'transunion',
      pulledAt: row.credit_pulled_at ?? row.created_at,
      tier: (row.credit_tier ?? 'subprime') as 'prime' | 'near_prime' | 'subprime' | 'deep_subprime',
    } : undefined,
    dealerId: d.id,
    dealerName: d.name,
    dealerContact: d.contact_name,
    assignedTo: row.assigned_to ?? undefined,
    assignedDepartment: row.assigned_department as Deal['assignedDepartment'],
    documents: [], // loaded separately
    notes: [],
    timeline: [],
    decisionNotes: row.decision_notes ?? undefined,
    decisionBy: row.decision_by ?? undefined,
    decisionAt: row.decision_at ?? undefined,
    fundedAt: row.funded_at ?? undefined,
    fundedAmount: row.funded_amount ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    flags: row.flags ?? [],
    ltv: row.ltv ?? 0,
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
  return (data ?? []).map((row: any) => transformDeal(row));
}

async function fetchDealById(id: string): Promise<Deal | null> {
  const { data, error } = await supabase
    .from('deals')
    .select(`${DEAL_SELECT}, documents (*), deal_notes (*), deal_timeline (*)`)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const deal = transformDeal(data as any);
  // Attach documents, notes, timeline
  deal.documents = (data.documents ?? []).map((doc: any) => ({
    id: doc.id,
    dealId: doc.deal_id,
    name: doc.name,
    type: doc.type,
    fileUrl: doc.file_url,
    fileSize: doc.file_size,
    uploadedAt: doc.created_at,
    uploadedBy: 'Dealer',
    status: doc.status,
    notes: doc.notes,
  }));
  deal.notes = (data.deal_notes ?? []).map((n: any) => ({
    id: n.id,
    dealId: n.deal_id,
    content: n.content,
    createdAt: n.created_at,
    createdBy: n.created_by,
    isInternal: n.is_internal,
  }));
  deal.timeline = (data.deal_timeline ?? []).map((t: any) => ({
    id: t.id,
    dealId: t.deal_id,
    type: t.type,
    description: t.description,
    createdAt: t.created_at,
    createdBy: t.created_by ?? 'System',
    metadata: t.metadata,
  }));
  return deal;
}

async function fetchDealers() {
  const { data, error } = await supabase
    .from('dealers')
    .select('*')
    .order('name');
  if (error) throw error;
  return data ?? [];
}

export function useDeals() {
  return useQuery({
    queryKey: ['deals'],
    queryFn: fetchDeals,
  });
}

export function useDeal(id: string | undefined) {
  return useQuery({
    queryKey: ['deal', id],
    queryFn: () => fetchDealById(id!),
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

export function useDealsByDepartment(department: 'credit' | 'income' | 'funding') {
  const statusMap = { credit: 'credit_review', income: 'income_verification', funding: 'funding_review' };
  const { data: deals, ...rest } = useDeals();
  return {
    data: deals?.filter(d => d.status === statusMap[department]),
    ...rest,
  };
}

export function useDealers() {
  return useQuery({
    queryKey: ['dealers'],
    queryFn: fetchDealers,
  });
}
