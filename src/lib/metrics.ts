import type { Deal, DealStatus } from '@/types/deal';

const ACTIVE_EXCLUDED: DealStatus[] = ['funded', 'declined', 'incomplete'];
const REVIEW: DealStatus[] = ['credit_review', 'income_verification', 'funding_review'];

export interface DashboardMetrics {
  active: number;
  pendingReview: number;
  fundedThisMonth: number;
  fundedThisMonthCount: number;
  fundedLastMonth: number;
  approvalRate: number | null;
  stuck: Deal[];
}

const sameMonth = (iso: string | undefined, ref: Date, offset = 0) => {
  if (!iso) return false;
  const d = new Date(iso);
  const m = new Date(ref.getFullYear(), ref.getMonth() + offset, 1);
  return d.getFullYear() === m.getFullYear() && d.getMonth() === m.getMonth();
};

/** Deals waiting longer than `staleDays` in a working stage. */
export function stuckDeals(deals: Deal[], now = new Date(), staleDays = 3): Deal[] {
  return deals.filter((d) => !ACTIVE_EXCLUDED.includes(d.status) && d.status !== 'approved'
    && (now.getTime() - new Date(d.statusChangedAt ?? d.updatedAt).getTime()) / 86_400_000 > staleDays);
}

export function dashboardMetrics(deals: Deal[], now = new Date(), staleDays = 3): DashboardMetrics {
  const funded = deals.filter((d) => d.status === 'funded');
  const decided = deals.filter((d) => d.status === 'funded' || d.status === 'approved' || d.status === 'declined');
  const amount = (d: Deal) => d.fundedAmount ?? d.financingTerms.loanAmount;
  return {
    active: deals.filter((d) => !ACTIVE_EXCLUDED.includes(d.status)).length,
    pendingReview: deals.filter((d) => REVIEW.includes(d.status)).length,
    fundedThisMonth: funded.filter((d) => sameMonth(d.fundedAt, now)).reduce((s, d) => s + amount(d), 0),
    fundedThisMonthCount: funded.filter((d) => sameMonth(d.fundedAt, now)).length,
    fundedLastMonth: funded.filter((d) => sameMonth(d.fundedAt, now, -1)).reduce((s, d) => s + amount(d), 0),
    approvalRate: decided.length ? Math.round((decided.filter((d) => d.status !== 'declined').length / decided.length) * 100) : null,
    stuck: stuckDeals(deals, now, staleDays),
  };
}

export interface MonthPoint { month: string; deals: number; funded: number; fundedAmount: number }

/** Submissions and fundings per calendar month, oldest first. */
export function monthlyTrend(deals: Deal[], months = 6, now = new Date()): MonthPoint[] {
  const out: MonthPoint[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const label = new Date(now.getFullYear(), now.getMonth() - i, 1).toLocaleString('en-CA', { month: 'short' });
    const inMonth = (iso?: string) => sameMonth(iso, now, -i);
    const fundedDeals = deals.filter((d) => d.status === 'funded' && inMonth(d.fundedAt));
    out.push({
      month: label,
      deals: deals.filter((d) => inMonth(d.createdAt)).length,
      funded: fundedDeals.length,
      fundedAmount: fundedDeals.reduce((s, d) => s + (d.fundedAmount ?? d.financingTerms.loanAmount), 0),
    });
  }
  return out;
}

export function withinDays(deals: Deal[], days: number, now = new Date()): Deal[] {
  const since = now.getTime() - days * 86_400_000;
  return deals.filter((d) => new Date(d.createdAt).getTime() >= since);
}

export function formatMoneyShort(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `$${Math.round(n / 1000)}K`;
  return `$${Math.round(n).toLocaleString('en-CA')}`;
}

export function toCsv(rows: Record<string, string | number | null | undefined>[]): string {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}
