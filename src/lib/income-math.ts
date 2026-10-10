/**
 * Income calculator maths (pure — no React, no I/O), shared by the calculator UI and its tests.
 *
 * Monthly income from a pay period uses the exact number of pay periods in a year:
 * weekly × 52/12, bi-weekly × 26/12, semi-monthly × 24/12, monthly × 1, hourly = rate × hours × 52/12.
 * Results are rounded to the cent. The calculation only ever starts from the raw inputs (pay per period,
 * YTD, rate…) — never from a previously saved monthly figure — so applying it twice gives the same number.
 */

export type PayFrequency = 'weekly' | 'biweekly' | 'semimonthly' | 'monthly';
export type CalcMethod = 'mi' | 'ytd' | 'mi_plus_10' | 'mi_plus_20' | 'manual' | 'lower_of';
export type MiInputMode = 'salary' | 'hourly';

export const PAY_FREQUENCIES: PayFrequency[] = ['weekly', 'biweekly', 'semimonthly', 'monthly'];

export const FREQUENCY_MULTIPLIERS: Record<PayFrequency, number> = {
  weekly: 52 / 12,
  biweekly: 26 / 12,
  semimonthly: 24 / 12,
  monthly: 1,
};

/** How the multiplier is shown to the analyst. */
export const FREQUENCY_FORMULA: Record<PayFrequency, string> = {
  weekly: '× 52 ÷ 12',
  biweekly: '× 26 ÷ 12',
  semimonthly: '× 24 ÷ 12',
  monthly: '× 1',
};

export const FREQUENCY_LABELS: Record<PayFrequency, string> = {
  weekly: 'Weekly',
  biweekly: 'Bi-weekly',
  semimonthly: 'Semi-monthly',
  monthly: 'Monthly',
};

export const BENEFIT_SOURCE_TYPES = ['government_assistance', 'unemployed'];
export const DEFAULT_BENEFIT_PERCENT = 50;

export function isPayFrequency(v: unknown): v is PayFrequency {
  return typeof v === 'string' && (PAY_FREQUENCIES as string[]).includes(v);
}

export function isBenefitType(sourceType: string | null | undefined): boolean {
  return BENEFIT_SOURCE_TYPES.includes(String(sourceType));
}

export const roundCents = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** "46,104.25", " $2 536.50 " → number; blank or junk → NaN. */
export function parseAmount(value: string | number | null | undefined): number {
  if (typeof value === 'number') return value;
  if (value == null) return NaN;
  const cleaned = String(value).replace(/[\s$, ]/g, '');
  // Number() (not parseFloat) so "1.2.3" or "12abc" are rejected instead of read as 1.2 / 12
  return /^-?(\d+\.?\d*|\.\d+)$/.test(cleaned) ? Number(cleaned) : NaN;
}

const positive = (n: number) => Number.isFinite(n) && n > 0;

export function monthlyFromPeriod(grossPerPeriod: number, frequency: PayFrequency): number | null {
  return positive(grossPerPeriod) ? roundCents(grossPerPeriod * FREQUENCY_MULTIPLIERS[frequency]) : null;
}

export function monthlyFromHourly(rate: number, hoursPerWeek: number): number | null {
  return positive(rate) && positive(hoursPerWeek) ? roundCents((rate * hoursPerWeek * 52) / 12) : null;
}

/** YTD gross over the (possibly fractional) number of months it covers. */
export function monthlyFromYtd(ytdGross: number, months: number): number | null {
  return positive(ytdGross) && positive(months) ? roundCents(ytdGross / months) : null;
}

export function clampPercent(p: number | null | undefined, fallback = DEFAULT_BENEFIT_PERCENT): number {
  const n = typeof p === 'number' && Number.isFinite(p) ? p : fallback;
  return Math.max(0, Math.min(100, n));
}

export interface IncomeInputs {
  method: CalcMethod;
  sourceType?: string | null;
  miMode?: MiInputMode;
  grossPerPeriod?: number;
  payFrequency?: PayFrequency;
  hourlyRate?: number;
  hoursPerWeek?: number;
  ytdGross?: number;
  /** fractional months allowed (8.8) */
  ytdMonths?: number;
  manualAmount?: number;
  /** share of benefit income that counts, 0–100 (benefit income types only) */
  benefitPercent?: number;
}

/** Monthly income from the current pay stub (salary per period or hourly). */
export function miValue(i: IncomeInputs): number | null {
  if ((i.miMode ?? 'salary') === 'hourly') return monthlyFromHourly(i.hourlyRate ?? NaN, i.hoursPerWeek ?? NaN);
  return monthlyFromPeriod(i.grossPerPeriod ?? NaN, i.payFrequency ?? 'biweekly');
}

export function ytdValue(i: IncomeInputs): number | null {
  return monthlyFromYtd(i.ytdGross ?? NaN, i.ytdMonths ?? NaN);
}

/** Lower of MI and YTD; when only one is known, that one. */
export function lowerOf(mi: number | null, ytd: number | null): number | null {
  if (mi != null && ytd != null) return Math.min(mi, ytd);
  return mi ?? ytd;
}

export function computeMonthlyIncome(i: IncomeInputs): number | null {
  if (i.method === 'manual') return positive(i.manualAmount ?? NaN) ? roundCents(i.manualAmount as number) : null;

  const mi = miValue(i);
  const ytd = ytdValue(i);

  if (isBenefitType(i.sourceType)) {
    const base = i.method === 'ytd' ? ytd : i.method === 'lower_of' ? lowerOf(mi, ytd) : mi;
    if (base == null) return null;
    return roundCents(base * (clampPercent(i.benefitPercent) / 100));
  }

  switch (i.method) {
    case 'mi': return mi;
    case 'ytd': return ytd;
    case 'lower_of': return lowerOf(mi, ytd);
    case 'mi_plus_10': return mi == null ? null : roundCents(mi * 1.1);
    case 'mi_plus_20': return mi == null ? null : roundCents(mi * 1.2);
    default: return null;
  }
}

/** Gap between MI and YTD as a % of their average (the auto-fill flags > 20%). */
export function miYtdGapPercent(mi: number, ytd: number): number {
  const avg = (mi + ytd) / 2;
  return avg > 0 ? Math.round((Math.abs(mi - ytd) / avg) * 100) : 0;
}

export function formatMoney(n: number | null | undefined, opts: { cents?: boolean } = {}): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `$${n.toLocaleString('en-CA', { minimumFractionDigits: opts.cents ? 2 : 0, maximumFractionDigits: 2 })}`;
}
