// Income auto-fill: turns a reading of a pay stub into the same numbers the analyst's
// Income Calculator would produce (MI, YTD, Lower of MI/YTD) plus the same review flags.
// Pure functions — shared by the edge function and the app's unit tests.
import type { IncomeReading, PayFrequency } from "./classify.ts";

// keep in step with src/components/deals/IncomeCalculator.tsx
export const FREQUENCY_MULTIPLIERS: Record<PayFrequency, number> = {
  weekly: 4.33,
  biweekly: 2.17,
  semimonthly: 2.0,
  monthly: 1.0,
};

export type CalcMethod = "mi" | "ytd" | "lower_of";

export interface SourceForMatch {
  id: string;
  employer_name: string;
  is_primary: boolean;
  verification_status: string;
  stated_monthly_income: number;
  flag_reasons: string[] | null;
}

export function monthlyFromPeriod(gross: number, freq: PayFrequency): number {
  return Math.round(gross * FREQUENCY_MULTIPLIERS[freq]);
}

/** Calendar months covered by YTD figures, rounded up (the conservative choice), at least 1. */
export function ytdMonthsAt(payDate: string): number {
  const d = new Date(`${payDate}T00:00:00Z`);
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  const dayOfYear = Math.floor((d.getTime() - start) / 86_400_000) + 1;
  return Math.max(1, Math.min(12, Math.ceil(dayOfYear / 30.4375 - 0.1)));
}

const STOP_WORDS = /\b(inc|ltd|ltee|limitee|corp|corporation|co|cie|company|compagnie|llc|lp|senc|the|le|la|les|de|du|des)\b/g;
export function normalizeEmployer(name: string): string {
  return name
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(STOP_WORDS, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function employersMatch(a: string, b: string): boolean {
  const x = normalizeEmployer(a), y = normalizeEmployer(b);
  if (!x || !y) return false;
  if (x.includes(y) || y.includes(x)) return true;
  const tx = new Set(x.split(" ")), ty = y.split(" ");
  const shared = ty.filter((t) => t.length > 2 && tx.has(t)).length;
  return shared / Math.min(tx.size, ty.length) >= 0.5;
}

/** Which income source does this document belong to? */
export function pickSource(employerOnDoc: string | null, sources: SourceForMatch[]): SourceForMatch | null {
  if (!sources.length) return null;
  if (employerOnDoc) {
    const hit = sources.find((s) => employersMatch(employerOnDoc, s.employer_name));
    if (hit) return hit;
  }
  if (sources.length === 1) return sources[0];
  return sources.find((s) => s.is_primary) ?? null;
}

export interface AutoFill {
  gross_per_period: number | null;
  pay_frequency: PayFrequency | null;
  ytd_gross: number | null;
  ytd_months: number | null;
  calc_method: CalcMethod;
  calculated_monthly_income: number;
  mi: number | null;
  ytd: number | null;
  flags: string[];
  verification_status: "unverified" | "needs_review" | "flagged";
}

/**
 * Returns null when the document doesn't carry enough to compute an income.
 * `today` is injectable for tests.
 */
export function computeAutoFill(
  reading: IncomeReading,
  source: Pick<SourceForMatch, "employer_name" | "stated_monthly_income" | "flag_reasons">,
  today: Date = new Date(),
): AutoFill | null {
  const mi = reading.gross_pay != null && reading.gross_pay > 0 && reading.pay_frequency
    ? monthlyFromPeriod(reading.gross_pay, reading.pay_frequency)
    : null;
  const months = reading.ytd_gross != null && reading.ytd_gross > 0 && reading.pay_date ? ytdMonthsAt(reading.pay_date) : null;
  const ytd = months ? Math.round(reading.ytd_gross! / months) : null;
  if (mi == null && ytd == null) return null;

  const calc_method: CalcMethod = mi != null && ytd != null ? "lower_of" : mi != null ? "mi" : "ytd";
  const calculated = calc_method === "lower_of" ? Math.min(mi!, ytd!) : (mi ?? ytd)!;

  // same flag wording as the analyst calculator, so flags merge instead of duplicating
  const keep = (source.flag_reasons ?? []).filter((f) => !f.startsWith("MI vs YTD gap:"));
  const flags = new Set(keep);
  const stated = source.stated_monthly_income;
  if (stated > 0 && Math.abs(calculated - stated) / stated > 0.15) flags.add("Income variance > 15%");
  if (reading.employer_name && source.employer_name && source.employer_name !== "Not provided"
      && !employersMatch(reading.employer_name, source.employer_name)) {
    flags.add("Employer name mismatch");
  }
  if (reading.pay_date) {
    const age = (today.getTime() - new Date(`${reading.pay_date}T00:00:00Z`).getTime()) / 86_400_000;
    if (age > 60) flags.add("Document > 60 days old");
  }
  if (reading.confidence === "low") flags.add("Low confidence extraction");
  let gap = false;
  if (mi != null && ytd != null) {
    const pct = Math.round((Math.abs(mi - ytd) / ((mi + ytd) / 2)) * 100);
    if (pct > 20) { flags.add(`MI vs YTD gap: ${pct}%`); gap = true; }
  }

  const newFlags = [...flags].filter((f) => !keep.includes(f));
  return {
    gross_per_period: reading.gross_pay,
    pay_frequency: reading.pay_frequency,
    ytd_gross: reading.ytd_gross,
    ytd_months: months,
    calc_method,
    calculated_monthly_income: calculated,
    mi,
    ytd,
    flags: [...flags],
    verification_status: gap ? "flagged" : newFlags.length ? "needs_review" : "unverified",
  };
}

export const METHOD_LABEL: Record<CalcMethod, string> = { mi: "MI", ytd: "YTD", lower_of: "Lower of MI/YTD" };
