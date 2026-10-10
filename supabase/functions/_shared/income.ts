// Income auto-fill: turns a reading of a pay stub into the same numbers the analyst's
// Income Calculator would produce (MI, YTD, Lower of MI/YTD) plus the same review flags.
// Pure functions — shared by the edge function and the tests.
import type { IncomeReading, PayFrequency } from "./classify.ts";

// Exact pay periods per month (52 weeks, 26 fortnights, 24 half-months, 12 months a year).
// src/components/deals/IncomeCalculator.tsx must use the same factors.
export const FREQUENCY_MULTIPLIERS: Record<PayFrequency, number> = {
  weekly: 52 / 12,
  biweekly: 26 / 12,
  semimonthly: 24 / 12,
  monthly: 12 / 12,
};

export type CalcMethod = "mi" | "ytd" | "lower_of";

// Mirrors IncomeCalculator's isBenefitType: these incomes count at the source's benefit
// percentage (stored in tip_percentage), 50% unless the analyst set another.
export const BENEFIT_SOURCE_TYPES = ["government_assistance", "unemployed"];
export const DEFAULT_BENEFIT_PERCENT = 50;

export const isBenefitType = (sourceType: string | null | undefined) =>
  !!sourceType && BENEFIT_SOURCE_TYPES.includes(sourceType);

export function benefitPercent(tipPercentage: number | null | undefined): number {
  const pct = Number.isFinite(Number(tipPercentage)) && tipPercentage != null ? Math.trunc(Number(tipPercentage)) : 0;
  return Math.max(0, Math.min(100, pct || DEFAULT_BENEFIT_PERCENT));
}

export interface SourceForMatch {
  id: string;
  employer_name: string;
  is_primary: boolean;
  verification_status: string;
  stated_monthly_income: number;
  flag_reasons: string[] | null;
  source_type?: string | null;
  tip_percentage?: number | null;
  calc_locked?: boolean | null;
  calc_method?: string | null;
  calculated_monthly_income?: number | null;
  manual_override_amount?: number | null;
  auto_fill_document_id?: string | null;
  auto_filled_at?: string | null;
}

export function monthlyFromPeriod(gross: number, freq: PayFrequency): number {
  return Math.round(gross * FREQUENCY_MULTIPLIERS[freq]);
}

export const DAYS_PER_MONTH = 365.25 / 12; // 30.4375

/**
 * Months covered by year-to-date figures at `date` (the end of the pay period): the real
 * span, day-of-year / 30.4375, to two decimals, at least half a month and at most 12.
 */
export function ytdMonthsAt(date: string): number {
  const d = new Date(`${date}T00:00:00Z`);
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  const dayOfYear = Math.floor((d.getTime() - start) / 86_400_000) + 1;
  return Math.round(Math.max(0.5, Math.min(12, dayOfYear / DAYS_PER_MONTH)) * 100) / 100;
}

// ---------------------------------------------------------------- employer matching
// Words that say nothing about which employer it is: legal forms, articles, and words shared
// by many unrelated employers ("Banque Nationale du Canada" vs "Banque Royale du Canada").
const GENERIC_WORDS = new Set([
  "canada", "inc", "ltd", "ltee", "limitee", "limited", "corp", "corporation", "co", "company", "compagnie", "cie",
  "llc", "lp", "senc", "sec", "groupe", "group", "the", "of", "and", "et", "de", "du", "des", "la", "le", "les",
  "d", "l", "ville", "city", "banque", "bank", "services", "service", "societe",
]);

/** The distinctive words of an employer name: accents, punctuation and generic words removed. */
export function employerWords(name: string): string[] {
  return name
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(" ")
    .filter((w) => w && !GENERIC_WORDS.has(w));
}

/**
 * Same employer when the distinctive words of one name are all in the other ("Desjardins" =
 * "Mouvement Desjardins"), or they spell the same thing without spaces ("WAL-MART" =
 * "Walmart"). Generic words alone never match ("Ville de Montréal" ≠ "Ville de Laval").
 */
export function employersMatch(a: string, b: string): boolean {
  const x = employerWords(a), y = employerWords(b);
  if (!x.length || !y.length) return false;
  if (x.join("") === y.join("")) return true;
  const [small, big] = x.length <= y.length ? [x, new Set(y)] : [y, new Set(x)];
  return small.every((w) => big.has(w));
}

/** Which income source does this document belong to? */
export function pickSource<T extends SourceForMatch>(employerOnDoc: string | null, sources: T[]): T | null {
  if (!sources.length) return null;
  if (employerOnDoc) {
    const hit = sources.find((s) => employersMatch(employerOnDoc, s.employer_name));
    if (hit) return hit;
  }
  if (sources.length === 1) return sources[0];
  return sources.find((s) => s.is_primary) ?? null;
}

// ---------------------------------------------------------------- may the auto-fill change it?
export type FillBlock = "verified" | "locked" | "older" | null;

/**
 * A source's figures are the analyst's when they locked them, chose a manual amount, or
 * entered a calculation that the auto-fill didn't make (sources from before calc_locked).
 */
export function isCalcLocked(s: SourceForMatch): boolean {
  if (s.calc_locked) return true;
  if (s.calc_method === "manual" || s.manual_override_amount != null) return true;
  return s.calculated_monthly_income != null && !s.auto_fill_document_id && !s.auto_filled_at;
}

/** Is the new document older than the one the current figures came from? */
export function isOlderDocument(newDate: string | null | undefined, currentDate: string | null | undefined): boolean {
  if (!currentDate) return false;
  if (!newDate) return true; // an undated document never replaces dated figures
  return newDate < currentDate;
}

export function fillBlockedBy(
  source: SourceForMatch,
  newPayDate: string | null | undefined,
  currentPayDate: string | null | undefined,
): FillBlock {
  if (source.verification_status === "verified") return "verified";
  if (isCalcLocked(source)) return "locked";
  if (isOlderDocument(newPayDate, currentPayDate)) return "older";
  return null;
}

// ---------------------------------------------------------------- the fill itself
export type FillStatus = "unverified" | "needs_review" | "flagged";
const STATUS_RANK: Record<string, number> = { unverified: 0, needs_review: 1, flagged: 2 };

/**
 * The auto-fill only ever raises the review status (unverified → needs review → flagged).
 * It never lowers it, never sets "verified", and leaves the analyst's own statuses
 * (verified, insufficient docs) alone.
 */
export function raiseStatus(current: string | null | undefined, computed: FillStatus): string {
  const cur = current ?? "unverified";
  if (!(cur in STATUS_RANK)) return cur;
  return STATUS_RANK[computed] > STATUS_RANK[cur] ? computed : cur;
}

export const FLAG = {
  variance: "Income variance > 15%",
  employer: "Employer name mismatch",
  old: "Document > 60 days old",
  lowConfidence: "Low confidence extraction",
  gapPrefix: "MI vs YTD gap:",
  shortYtd: "YTD covers < 3 months",
  partialYear: "YTD low for the months elapsed (new hire or unpaid leave?)",
} as const;

// Flags that describe the document the figures came from; they are recomputed on each fill.
const DOCUMENT_FLAGS = [FLAG.employer, FLAG.old, FLAG.lowConfidence, FLAG.shortYtd, FLAG.partialYear];
const isDocumentFlag = (f: string) => DOCUMENT_FLAGS.includes(f as (typeof DOCUMENT_FLAGS)[number]) || f.startsWith(FLAG.gapPrefix);

export interface AutoFill {
  gross_per_period: number | null;
  pay_frequency: PayFrequency | null;
  ytd_gross: number | null;
  ytd_months: number | null;
  calc_method: CalcMethod;
  calculated_monthly_income: number;
  /** monthly income from the pay period (after the benefit percentage, if any) */
  mi: number | null;
  /** monthly income from year-to-date (after the benefit percentage, if any) */
  ytd: number | null;
  flags: string[];
  verification_status: string;
  benefit_percent: number | null;
}

/**
 * Returns null when the document doesn't carry enough to compute an income.
 * `today` is injectable for tests.
 */
export function computeAutoFill(
  reading: IncomeReading,
  source: Pick<SourceForMatch, "employer_name" | "stated_monthly_income" | "flag_reasons">
    & Partial<Pick<SourceForMatch, "verification_status" | "source_type" | "tip_percentage">>,
  today: Date = new Date(),
): AutoFill | null {
  const rawMi = reading.gross_pay != null && reading.gross_pay > 0 && reading.pay_frequency
    ? monthlyFromPeriod(reading.gross_pay, reading.pay_frequency)
    : null;
  const ytdDate = reading.period_end ?? reading.pay_date;
  const months = reading.ytd_gross != null && reading.ytd_gross > 0 && ytdDate ? ytdMonthsAt(ytdDate) : null;
  const rawYtd = months ? Math.round(reading.ytd_gross! / months) : null;
  if (rawMi == null && rawYtd == null) return null;

  const flags = new Set((source.flag_reasons ?? []).filter((f) => !isDocumentFlag(f)));
  const before = new Set(source.flag_reasons ?? []);

  // How many months of pay at the current rate the YTD amounts to, versus months elapsed.
  // Far fewer → the person started this year (or had unpaid time): YTD can't be averaged.
  const partialYear = rawMi != null && rawYtd != null && months! >= 2 && reading.ytd_gross! < rawMi * months! * 0.6;
  const shortYtd = months != null && months < 3;

  let calc_method: CalcMethod;
  if (rawMi != null && rawYtd != null && !partialYear && !shortYtd) calc_method = "lower_of";
  else if (rawMi != null) calc_method = "mi";
  else calc_method = "ytd";

  const pct = isBenefitType(source.source_type) ? benefitPercent(source.tip_percentage) : null;
  const capped = (v: number | null) => (v == null || pct == null ? v : Math.round(v * (pct / 100)));
  const mi = capped(rawMi), ytd = capped(rawYtd);
  const calculated = calc_method === "lower_of" ? Math.min(mi!, ytd!) : calc_method === "mi" ? mi! : ytd!;

  // same flag wording as the analyst calculator, so flags merge instead of duplicating
  const stated = source.stated_monthly_income;
  if (stated > 0 && Math.abs(calculated - stated) / stated > 0.15) flags.add(FLAG.variance);
  if (reading.employer_name && source.employer_name && source.employer_name !== "Not provided"
      && !employersMatch(reading.employer_name, source.employer_name)) {
    flags.add(FLAG.employer);
  }
  const docDate = reading.pay_date ?? reading.period_end;
  if (docDate) {
    const age = (today.getTime() - new Date(`${docDate}T00:00:00Z`).getTime()) / 86_400_000;
    if (age > 60) flags.add(FLAG.old);
  }
  if (reading.confidence === "low") flags.add(FLAG.lowConfidence);
  if (shortYtd) flags.add(FLAG.shortYtd);
  let serious = false;
  if (partialYear) {
    flags.add(FLAG.partialYear);
    serious = true;
  } else if (rawMi != null && rawYtd != null && !shortYtd) {
    const pct = Math.round((Math.abs(rawMi - rawYtd) / ((rawMi + rawYtd) / 2)) * 100);
    if (pct > 20) { flags.add(`${FLAG.gapPrefix} ${pct}%`); serious = true; }
  }

  const added = [...flags].filter((f) => !before.has(f));
  const computed: FillStatus = serious ? "flagged" : added.length ? "needs_review" : "unverified";
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
    verification_status: raiseStatus(source.verification_status, computed),
    benefit_percent: pct,
  };
}

export const METHOD_LABEL: Record<CalcMethod, string> = { mi: "MI", ytd: "YTD", lower_of: "Lower of MI/YTD" };
