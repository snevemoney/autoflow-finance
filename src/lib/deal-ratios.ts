/** Debt and income ratios for a deal list row (pure). */
import type { Deal } from '@/types/deal';

export interface DebtSummary {
  totalMonthlyDebts: number;
  hasGarnishments: boolean;
  /** (payment + debts) / income, in % — null when income is unknown */
  dti: number | null;
  /** payment / income, in % */
  pti: number | null;
  monthlyIncome: number;
  rentPayment: number;
  debtCount: number;
  debtTypes: string[];
}

/** Monthly income for ratios: verified/calculated sources first, then the stated figure. */
export function monthlyIncomeOf(deal: Deal): number {
  if (deal.incomeSources?.length) {
    return deal.incomeSources.reduce((sum, src) => sum + (src.calculated_monthly_income ?? src.stated_monthly_income ?? 0), 0);
  }
  return deal.customer.employmentInfo?.monthlyIncome ?? 0;
}

export function summarizeDebts(deal: Deal): DebtSummary | undefined {
  if (!deal.debts) return undefined;
  const income = monthlyIncomeOf(deal);
  const payment = deal.financingTerms.monthlyPayment;
  const total = deal.debts.reduce((s, d) => s + d.monthly_payment, 0);
  return {
    totalMonthlyDebts: total,
    hasGarnishments: deal.debts.some((d) => d.debt_type === 'garnishment' || d.debt_type === 'child_support' || d.is_court_ordered),
    dti: income > 0 ? ((payment + total) / income) * 100 : null,
    pti: income > 0 ? (payment / income) * 100 : null,
    monthlyIncome: income,
    rentPayment: deal.debts.filter((d) => d.debt_type === 'rent').reduce((s, d) => s + d.monthly_payment, 0),
    debtCount: deal.debts.length,
    debtTypes: [...new Set(deal.debts.map((d) => d.debt_type))],
  };
}
