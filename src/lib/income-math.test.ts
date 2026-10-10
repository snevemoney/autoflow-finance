import { describe, expect, it } from 'vitest';
import {
  computeMonthlyIncome, FREQUENCY_MULTIPLIERS, lowerOf, miYtdGapPercent, monthlyFromHourly, monthlyFromPeriod, monthlyFromYtd, parseAmount,
} from './income-math';

describe('pay frequency multipliers', () => {
  it('uses the exact number of pay periods in a year', () => {
    expect(FREQUENCY_MULTIPLIERS.weekly).toBe(52 / 12);
    expect(FREQUENCY_MULTIPLIERS.biweekly).toBe(26 / 12);
    expect(FREQUENCY_MULTIPLIERS.semimonthly).toBe(2);
    expect(FREQUENCY_MULTIPLIERS.monthly).toBe(1);
  });

  it('weekly $1000 → $4,333.33/mo', () => {
    expect(monthlyFromPeriod(1000, 'weekly')).toBe(4333.33);
  });

  it('bi-weekly $2,536.50 → $5,495.75/mo', () => {
    expect(monthlyFromPeriod(2536.5, 'biweekly')).toBe(5495.75);
    expect(monthlyFromPeriod(parseAmount('$2,536.50'), 'biweekly')).toBe(5495.75);
  });

  it('semi-monthly $2500 → $5,000/mo; monthly is unchanged', () => {
    expect(monthlyFromPeriod(2500, 'semimonthly')).toBe(5000);
    expect(monthlyFromPeriod(4100.1, 'monthly')).toBe(4100.1);
  });

  it('hourly = rate × hours × 52 / 12', () => {
    expect(monthlyFromHourly(20, 40)).toBe(3466.67);
    expect(monthlyFromHourly(0, 40)).toBeNull();
  });

  it('rejects missing or negative pay', () => {
    expect(monthlyFromPeriod(0, 'weekly')).toBeNull();
    expect(monthlyFromPeriod(NaN, 'weekly')).toBeNull();
    expect(monthlyFromPeriod(-5, 'weekly')).toBeNull();
  });
});

describe('YTD', () => {
  it('divides by fractional months: $46,104.25 over 8.8 months', () => {
    expect(monthlyFromYtd(parseAmount('46,104.25'), parseFloat('8.8'))).toBe(5239.12);
  });

  it('needs a positive number of months', () => {
    expect(monthlyFromYtd(46104.25, 0)).toBeNull();
    expect(monthlyFromYtd(46104.25, NaN)).toBeNull();
  });
});

describe('computeMonthlyIncome', () => {
  const stub = { grossPerPeriod: 2536.5, payFrequency: 'biweekly' as const, ytdGross: 46104.25, ytdMonths: 8.8 };

  it('MI, YTD and lower of', () => {
    expect(computeMonthlyIncome({ method: 'mi', ...stub })).toBe(5495.75);
    expect(computeMonthlyIncome({ method: 'ytd', ...stub })).toBe(5239.12);
    expect(computeMonthlyIncome({ method: 'lower_of', ...stub })).toBe(5239.12);
    expect(lowerOf(null, 10)).toBe(10);
    expect(lowerOf(null, null)).toBeNull();
  });

  it('tips add 10% / 20% to MI', () => {
    expect(computeMonthlyIncome({ method: 'mi_plus_10', grossPerPeriod: 1000, payFrequency: 'weekly' })).toBe(4766.66);
    expect(computeMonthlyIncome({ method: 'mi_plus_20', grossPerPeriod: 2500, payFrequency: 'semimonthly' })).toBe(6000);
  });

  it('hourly mode', () => {
    expect(computeMonthlyIncome({ method: 'mi', miMode: 'hourly', hourlyRate: 20, hoursPerWeek: 40 })).toBe(3466.67);
  });

  it('manual override is taken as typed', () => {
    expect(computeMonthlyIncome({ method: 'manual', manualAmount: 4200.5 })).toBe(4200.5);
    expect(computeMonthlyIncome({ method: 'manual', manualAmount: 0 })).toBeNull();
  });

  it('benefit income: lower of MI and YTD × benefit percent (50%)', () => {
    const benefit = { sourceType: 'government_assistance', benefitPercent: 50, ...stub };
    expect(computeMonthlyIncome({ method: 'lower_of', ...benefit })).toBe(2619.56);
    expect(computeMonthlyIncome({ method: 'mi', ...benefit })).toBe(2747.88);
    expect(computeMonthlyIncome({ method: 'ytd', ...benefit })).toBe(2619.56);
    // default share is 50%
    expect(computeMonthlyIncome({ method: 'mi', sourceType: 'unemployed', grossPerPeriod: 2500, payFrequency: 'semimonthly' })).toBe(2500);
    // manual is never reduced
    expect(computeMonthlyIncome({ method: 'manual', sourceType: 'unemployed', manualAmount: 1800 })).toBe(1800);
  });

  it('applying twice never compounds (only raw inputs are used)', () => {
    const inputs = { method: 'lower_of' as const, sourceType: 'government_assistance', benefitPercent: 50, ...stub };
    const first = computeMonthlyIncome(inputs);
    const second = computeMonthlyIncome({ ...inputs });
    expect(second).toBe(first);
  });
});

describe('MI vs YTD gap', () => {
  it('is the difference over the average', () => {
    expect(miYtdGapPercent(5495.75, 5239.12)).toBe(5);
    expect(miYtdGapPercent(6000, 4000)).toBe(40);
    expect(miYtdGapPercent(0, 0)).toBe(0);
  });
});
