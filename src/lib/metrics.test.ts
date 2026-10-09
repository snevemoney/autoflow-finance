import { describe, expect, it } from 'vitest';
import { dashboardMetrics, monthlyTrend, stuckDeals, toCsv, formatMoneyShort } from './metrics';
import type { Deal, DealStatus } from '@/types/deal';

const now = new Date('2026-10-15T12:00:00Z');
let n = 0;
function deal(status: DealStatus, extra: Partial<Deal> = {}): Deal {
  n += 1;
  return {
    id: `d${n}`, dealNumber: `AF-${n}`, status, priority: 'normal',
    customer: { id: 'c', firstName: 'A', lastName: 'B', email: '', phone: '', address: { street: '', city: '', state: '', zip: '' } },
    vehicle: { year: 2024, make: 'Toyota', model: 'RAV4', vin: '', mileage: 0, condition: 'used', invoicePrice: 30000 },
    financingTerms: { loanAmount: 20000, downPayment: 0, apr: 8, termMonths: 60, monthlyPayment: 400, totalInterest: 0, totalCost: 0 },
    dealerId: 'x', dealerName: 'Dealer', dealerContact: '', documents: [], notes: [], timeline: [],
    createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-14T00:00:00Z', statusChangedAt: '2026-10-14T00:00:00Z',
    flags: [], ltv: 66, ...extra,
  };
}

describe('dashboardMetrics', () => {
  it('counts active, in-review and funded-this-month from real deal states', () => {
    const deals = [
      deal('document_review'),
      deal('credit_review'),
      deal('income_verification'),
      deal('funded', { fundedAt: '2026-10-03T00:00:00Z', fundedAmount: 25000 }),
      deal('funded', { fundedAt: '2026-09-20T00:00:00Z' }),
      deal('declined'),
      deal('approved'),
    ];
    const m = dashboardMetrics(deals, now);
    expect(m.active).toBe(4); // document_review, credit, income, approved
    expect(m.pendingReview).toBe(2);
    expect(m.fundedThisMonth).toBe(25000);
    expect(m.fundedThisMonthCount).toBe(1);
    expect(m.fundedLastMonth).toBe(20000);
    expect(m.approvalRate).toBe(75); // 2 funded + 1 approved of 4 decided
  });

  it('has no approval rate before any decision', () => {
    expect(dashboardMetrics([deal('credit_review')], now).approvalRate).toBeNull();
  });
});

describe('stuckDeals', () => {
  it('flags working-stage deals older than the threshold, never finished ones', () => {
    const old = '2026-10-05T00:00:00Z';
    const deals = [deal('credit_review', { statusChangedAt: old }), deal('funded', { statusChangedAt: old }), deal('credit_review')];
    expect(stuckDeals(deals, now, 3).map((d) => d.status)).toEqual(['credit_review']);
    expect(stuckDeals(deals, now, 30)).toHaveLength(0);
  });
});

describe('monthlyTrend', () => {
  it('buckets submissions and fundings by calendar month, oldest first', () => {
    const deals = [
      deal('funded', { createdAt: '2026-09-02T00:00:00Z', fundedAt: '2026-10-02T00:00:00Z' }),
      deal('credit_review', { createdAt: '2026-10-09T00:00:00Z' }),
    ];
    const t = monthlyTrend(deals, 3, now);
    expect(t).toHaveLength(3);
    expect(t[1]).toMatchObject({ deals: 1, funded: 0 });
    expect(t[2]).toMatchObject({ deals: 1, funded: 1, fundedAmount: 20000 });
  });
});

describe('formatting', () => {
  it('escapes CSV values', () => {
    expect(toCsv([{ a: 'x,y', b: 'say "hi"', c: null }])).toBe('a,b,c\n"x,y","say ""hi""",');
  });
  it('shortens money', () => {
    expect(formatMoneyShort(2_450_000)).toBe('$2.45M');
    expect(formatMoneyShort(84_000)).toBe('$84K');
    expect(formatMoneyShort(950)).toBe('$950');
  });
});
