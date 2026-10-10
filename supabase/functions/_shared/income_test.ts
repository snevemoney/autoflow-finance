// deno test supabase/functions/_shared
// Income auto-fill maths: the same numbers and flags the analyst's calculator would produce.
import nodeAssert from "node:assert/strict";
import type { IncomeReading } from "./classify.ts";
import {
  benefitPercent, computeAutoFill, employersMatch, FLAG, fillBlockedBy, FREQUENCY_MULTIPLIERS, isCalcLocked,
  isOlderDocument, monthlyFromPeriod, pickSource, raiseStatus, type SourceForMatch, ytdMonthsAt,
} from "./income.ts";

const assert = (v: unknown, msg?: string) => nodeAssert.ok(v, msg);
const assertEquals = (a: unknown, b: unknown, msg?: string) => nodeAssert.deepStrictEqual(a, b, msg);
const near = (actual: number, expected: number, pct: number, msg?: string) =>
  assert(Math.abs(actual - expected) / expected <= pct / 100, `${msg ?? ""} ${actual} not within ${pct}% of ${expected}`);

const reading = (o: Partial<IncomeReading>): IncomeReading => ({
  gross_pay: null, net_pay: null, pay_frequency: null, pay_date: null, period_end: null,
  employer_name: null, ytd_gross: null, confidence: "high", ...o,
});
const source = (o: Partial<SourceForMatch> = {}) =>
  ({ employer_name: "Employer", stated_monthly_income: 0, flag_reasons: [] as string[], verification_status: "unverified", ...o });

Deno.test("pay frequencies use exact periods per month", () => {
  assertEquals(FREQUENCY_MULTIPLIERS.weekly, 52 / 12);
  assertEquals(FREQUENCY_MULTIPLIERS.biweekly, 26 / 12);
  assertEquals(FREQUENCY_MULTIPLIERS.semimonthly, 2);
  assertEquals(FREQUENCY_MULTIPLIERS.monthly, 1);
  assertEquals(monthlyFromPeriod(1000, "weekly"), 4333);
  assertEquals(monthlyFromPeriod(2100, "biweekly"), 4550);
  assertEquals(monthlyFromPeriod(2500, "semimonthly"), 5000);
});

Deno.test("YTD months are the real span covered, fractional, at least half a month", () => {
  assertEquals(ytdMonthsAt("2026-01-10"), 0.5); // 10 days → the half-month minimum
  assertEquals(ytdMonthsAt("2026-01-31"), 1.02);
  assertEquals(ytdMonthsAt("2026-03-15"), 2.43);
  assertEquals(ytdMonthsAt("2026-04-10"), 3.29);
  assertEquals(ytdMonthsAt("2026-06-30"), 5.95);
  assertEquals(ytdMonthsAt("2026-12-31"), 11.99);
  assertEquals(ytdMonthsAt("2028-12-31"), 12); // leap year capped
});

Deno.test("weekly $1,000 paid Apr 10: MI ≈ $4,333 and YTD near it — no understated lower-of", () => {
  // 15 Friday pays from Jan 2 to Apr 10
  const fill = computeAutoFill(reading({ gross_pay: 1000, pay_frequency: "weekly", pay_date: "2026-04-10", ytd_gross: 15000 }),
    source(), new Date("2026-04-20T00:00:00Z"))!;
  assertEquals(fill.mi, 4333);
  near(fill.ytd!, 4333, 6, "YTD monthly");
  assertEquals(fill.calc_method, "lower_of");
  near(fill.calculated_monthly_income, 4333, 1, "calculated");
  assert(!fill.flags.some((f) => f.startsWith(FLAG.gapPrefix)), "no MI/YTD gap");
  assertEquals(fill.verification_status, "unverified");
});

Deno.test("semi-monthly $2,500 paid Mar 15: ≈ $5,000, flagged for a short YTD", () => {
  // Jan 15, Jan 31, Feb 15, Feb 28, Mar 15
  const fill = computeAutoFill(reading({ gross_pay: 2500, pay_frequency: "semimonthly", pay_date: "2026-03-15", ytd_gross: 12500 }),
    source(), new Date("2026-03-20T00:00:00Z"))!;
  assertEquals(fill.mi, 5000);
  near(fill.calculated_monthly_income, 5000, 1);
  assert(fill.flags.includes(FLAG.shortYtd));
  assertEquals(fill.verification_status, "needs_review");
});

Deno.test("January stubs are flagged and use the pay-period figure, not a distorted YTD", () => {
  const fill = computeAutoFill(reading({ gross_pay: 2000, pay_frequency: "biweekly", pay_date: "2026-01-16", ytd_gross: 4000 }),
    source(), new Date("2026-01-20T00:00:00Z"))!;
  assertEquals(fill.ytd_months, 0.53);
  assertEquals(fill.calc_method, "mi");
  assertEquals(fill.calculated_monthly_income, 4333);
  assert(fill.flags.includes(FLAG.shortYtd));
  assertEquals(fill.verification_status, "needs_review");
});

Deno.test("a new hire (YTD far below the months elapsed) is flagged, not averaged over the year", () => {
  // started in August: 4 biweekly pays by Sep 25
  const fill = computeAutoFill(reading({ gross_pay: 2000, pay_frequency: "biweekly", pay_date: "2026-09-25", ytd_gross: 8000 }),
    source({ stated_monthly_income: 4300 }), new Date("2026-09-28T00:00:00Z"))!;
  assert(fill.flags.includes(FLAG.partialYear));
  assertEquals(fill.calc_method, "mi");
  assertEquals(fill.calculated_monthly_income, 4333);
  assertEquals(fill.verification_status, "flagged");
});

Deno.test("the pay-period end is used for YTD months when the document shows it", () => {
  const withEnd = computeAutoFill(reading({ gross_pay: 2100, pay_frequency: "biweekly", pay_date: "2026-09-18", period_end: "2026-09-12", ytd_gross: 39900 }),
    source(), new Date("2026-09-20T00:00:00Z"))!;
  assertEquals(withEnd.ytd_months, ytdMonthsAt("2026-09-12"));
});

Deno.test("income auto-fill matches the analyst calculator", () => {
  const today = new Date("2026-09-20T00:00:00Z");
  const src = source({ employer_name: "Hydro-Québec", stated_monthly_income: 4600 });
  // biweekly 2,100 → MI 4,550 ; YTD 39,900 by Sep 12 (8.38 months) → 4,761 ; lower_of → 4,550
  const fill = computeAutoFill(reading({ gross_pay: 2100, net_pay: 1500, pay_frequency: "biweekly", pay_date: "2026-09-12",
    employer_name: "Hydro Quebec", ytd_gross: 39900 }), src, today)!;
  assertEquals(fill.calc_method, "lower_of");
  assertEquals(fill.ytd_months, 8.38);
  assertEquals(fill.ytd, 4761);
  assertEquals(fill.calculated_monthly_income, 4550);
  assertEquals(fill.flags, []);
  assertEquals(fill.verification_status, "unverified");

  const odd = computeAutoFill(reading({ gross_pay: 3000, pay_frequency: "weekly", pay_date: "2026-05-01",
    employer_name: "Someone Else Inc", ytd_gross: 38000, confidence: "low" }), src, today)!;
  assert(odd.flags.includes(FLAG.employer));
  assert(odd.flags.includes(FLAG.old));
  assert(odd.flags.includes(FLAG.lowConfidence));
  assert(odd.flags.some((f) => f.startsWith(FLAG.gapPrefix)));
  assertEquals(odd.verification_status, "flagged");

  assertEquals(computeAutoFill(reading({ net_pay: 900 }), src, today), null);
});

Deno.test("existing analyst flags are kept, not duplicated; document flags are recomputed", () => {
  const fill = computeAutoFill(reading({ gross_pay: 1000, pay_frequency: "monthly", pay_date: "2026-09-01" }),
    source({ employer_name: "X", stated_monthly_income: 5000, flag_reasons: ["Income variance > 15%", "MI vs YTD gap: 40%", "Analyst note"] }),
    new Date("2026-09-10T00:00:00Z"))!;
  assertEquals(fill.flags, ["Income variance > 15%", "Analyst note"]);
  assertEquals(fill.verification_status, "unverified", "only already-known flags → no new review needed");
});

Deno.test("the review status is never lowered and never set to verified", () => {
  assertEquals(raiseStatus("flagged", "unverified"), "flagged");
  assertEquals(raiseStatus("needs_review", "unverified"), "needs_review");
  assertEquals(raiseStatus("needs_review", "flagged"), "flagged");
  assertEquals(raiseStatus("unverified", "needs_review"), "needs_review");
  assertEquals(raiseStatus("verified", "flagged"), "verified");
  assertEquals(raiseStatus("insufficient_docs", "unverified"), "insufficient_docs");
  assertEquals(raiseStatus(null, "unverified"), "unverified");
  // a clean newer stub on a flagged source keeps it flagged
  const fill = computeAutoFill(reading({ gross_pay: 2100, pay_frequency: "biweekly", pay_date: "2026-09-12", ytd_gross: 39900 }),
    source({ verification_status: "flagged", flag_reasons: ["MI vs YTD gap: 35%"] }), new Date("2026-09-20T00:00:00Z"))!;
  assertEquals(fill.verification_status, "flagged");
});

Deno.test("benefit income counts at the benefit percentage, like the calculator", () => {
  assertEquals(benefitPercent(null), 50);
  assertEquals(benefitPercent(70), 70);
  assertEquals(benefitPercent(150), 100);
  const today = new Date("2026-10-05T00:00:00Z");
  // monthly 1,800 benefit; YTD 16,200 by Sep 30
  const r = reading({ gross_pay: 1800, pay_frequency: "monthly", pay_date: "2026-09-30", ytd_gross: 16200 });
  const half = computeAutoFill(r, source({ source_type: "government_assistance", stated_monthly_income: 900 }), today)!;
  assertEquals(half.benefit_percent, 50);
  assertEquals(half.mi, 900);
  assertEquals(half.calc_method, "lower_of");
  assertEquals(half.calculated_monthly_income, Math.min(900, Math.round(Math.round(16200 / ytdMonthsAt("2026-09-30")) * 0.5)));
  assert(!half.flags.includes(FLAG.variance), "compared with the stated amount after the cap");

  const seventy = computeAutoFill(r, source({ source_type: "unemployed", tip_percentage: 70 }), today)!;
  assertEquals(seventy.mi, 1260);
  const salaried = computeAutoFill(r, source({ source_type: "salaried", tip_percentage: 10 }), today)!;
  assertEquals(salaried.benefit_percent, null);
  assertEquals(salaried.mi, 1800);
});

Deno.test("a locked, manual or verified source is never refilled; an older stub never replaces a newer one", () => {
  const s = (o: Partial<SourceForMatch>): SourceForMatch => ({
    id: "s", employer_name: "E", is_primary: true, verification_status: "unverified", stated_monthly_income: 0, flag_reasons: [], ...o,
  });
  assertEquals(fillBlockedBy(s({}), "2026-09-12", null), null);
  assertEquals(fillBlockedBy(s({ calc_locked: true }), "2026-09-12", null), "locked");
  assertEquals(fillBlockedBy(s({ calc_method: "manual" }), "2026-09-12", null), "locked");
  assertEquals(fillBlockedBy(s({ verification_status: "verified" }), "2026-09-12", null), "verified");
  // figures an analyst typed before calc_locked existed
  assert(isCalcLocked(s({ calculated_monthly_income: 4100 })));
  assert(!isCalcLocked(s({ calculated_monthly_income: 4100, auto_fill_document_id: "d1", auto_filled_at: "2026-09-01" })));
  // newest pay date wins
  assertEquals(fillBlockedBy(s({}), "2026-08-29", "2026-09-12"), "older");
  assertEquals(fillBlockedBy(s({}), "2026-09-26", "2026-09-12"), null);
  assert(isOlderDocument(null, "2026-09-12"), "an undated document never replaces dated figures");
  assert(!isOlderDocument("2026-09-12", "2026-09-12"));
});

Deno.test("employer matching needs the distinctive words to match", () => {
  assert(employersMatch("HYDRO-QUÉBEC", "Hydro Quebec"));
  assert(employersMatch("Les Aliments Dubé Ltée", "Aliments Dube"));
  assert(employersMatch("CGI Inc.", "cgi"));
  assert(employersMatch("Transports Bélanger Inc.", "TRANSPORTS BELANGER INC"));
  assert(employersMatch("Desjardins", "Mouvement Desjardins"));
  assert(employersMatch("WAL-MART CANADA CORP", "Walmart"));
  assert(!employersMatch("Banque Nationale du Canada", "Banque Royale du Canada"));
  assert(!employersMatch("Walmart Canada Corp", "Canada Post"));
  assert(!employersMatch("Ville de Montréal", "Ville de Laval"));
  assert(!employersMatch("CN", "CNESST"));
  assert(!employersMatch("Bombardier", "Desjardins"));
  assert(!employersMatch("Canada Inc.", "Groupe Canada Ltée"), "generic words alone never match");
});

Deno.test("documents are matched to the right income source", () => {
  const s = (id: string, employer: string, primary = false) =>
    ({ id, employer_name: employer, is_primary: primary, verification_status: "unverified", stated_monthly_income: 0, flag_reasons: [] });
  const sources = [s("a", "Walmart", true), s("b", "Uber Eats")];
  assertEquals(pickSource("WAL-MART CANADA CORP", sources)?.id, "a");
  assertEquals(pickSource("Uber Eats Canada", sources)?.id, "b");
  assertEquals(pickSource("Unknown Co", sources)?.id, "a", "falls back to primary");
  assertEquals(pickSource(null, [s("c", "Only")])?.id, "c");
  assertEquals(pickSource("x", []), null);
  const banks = [s("n", "Banque Nationale du Canada", true), s("r", "Banque Royale du Canada")];
  assertEquals(pickSource("BANQUE ROYALE DU CANADA", banks)?.id, "r");
});
