// deno test supabase/functions/_shared
import nodeAssert from "node:assert/strict";

const assert = (v: unknown, msg?: string) => nodeAssert.ok(v, msg);
const assertEquals = (a: unknown, b: unknown, msg?: string) => nodeAssert.deepStrictEqual(a, b, msg);
async function assertRejects(fn: () => Promise<unknown>, cls: new (...a: never[]) => Error): Promise<Error> {
  try { await fn(); } catch (e) { nodeAssert.ok(e instanceof cls, `expected ${cls.name}`); return e as Error; }
  throw new Error("expected promise to reject");
}
import { classifyByFilename, isUnsure, needsAi, normalizeReading, toAmount } from "./classify.ts";
import { computeAutoFill, employersMatch, monthlyFromPeriod, pickSource, ytdMonthsAt } from "./income.ts";
import { aiConfigFromEnv, AiError, callJson, DEFAULT_MODELS, modelBatches, parseJsonReply } from "./ai.ts";

Deno.test("file names sort documents in English and French", () => {
  const cases: [string, string | null][] = [
    ["Talon de paie - juin.pdf", "pay_stub"],
    ["paystub_2026-09-15.jpg", "pay_stub"],
    ["relevé bancaire Desjardins.pdf", "bank_statement"],
    ["Bank Statement Aug.pdf", "bank_statement"],
    ["Permis de conduire recto.jpg", "id_verification"],
    ["carte assurance maladie.jpg", "id_verification"],
    ["Preuve d'assurance auto.pdf", "insurance"],
    ["insurance_binder.pdf", "insurance"],
    ["Facture véhicule RAV4.pdf", "vehicle_invoice"],
    ["Bill_of_Sale.pdf", "vehicle_invoice"],
    ["Demande de crédit signée.pdf", "credit_application"],
    ["credit-app.pdf", "credit_application"],
    ["Lettre d'emploi.pdf", "income_verification"],
    ["Avis de cotisation 2025.pdf", "income_verification"],
    ["trade-in payoff letter.pdf", "trade_in"],
    ["IMG_4402.jpg", null],
    ["scan0001.pdf", null],
  ];
  for (const [name, type] of cases) assertEquals(classifyByFilename(name), type, name);
});

Deno.test("AI is only called when the name is not enough or there is income to read", () => {
  assert(needsAi("other", false));
  assert(needsAi("pay_stub", true));
  assert(!needsAi("pay_stub", false));
  assert(!needsAi("insurance", true));
});

Deno.test("amounts are parsed from French and English formats", () => {
  assertEquals(toAmount("1 234,56 $"), 1234.56);
  assertEquals(toAmount("2,450.00"), 2450);
  assertEquals(toAmount("3.200,5"), 3200.5);
  assertEquals(toAmount(1875.456), 1875.46);
  assertEquals(toAmount("n/a"), null);
  assertEquals(toAmount(-5), null);
});

Deno.test("model replies are normalized and validated", () => {
  const r = normalizeReading({
    document_type: "Pay_Stub ", type_confidence: "high",
    income: { gross_pay: "2 100,00", pay_frequency: "Biweekly", pay_date: "2026-09-12", employer_name: " Hydro-Québec ", ytd_gross: 39900, confidence: "medium" },
    summary: "Pay stub",
  });
  assertEquals(r.document_type, "pay_stub");
  assertEquals(r.income?.gross_pay, 2100);
  assertEquals(r.income?.pay_frequency, "biweekly");
  assertEquals(r.income?.employer_name, "Hydro-Québec");
  assertEquals(normalizeReading({ document_type: "selfie" }).document_type, "other");
  assertEquals(normalizeReading({ document_type: "pay_stub", income: { gross_pay: null } }).income, null);
  assert(isUnsure(normalizeReading({ document_type: "pay_stub", type_confidence: "high" })), "pay stub with no figures");
  assert(!isUnsure(normalizeReading({ document_type: "insurance", type_confidence: "medium" })));
});

Deno.test("YTD months are conservative calendar months", () => {
  assertEquals(ytdMonthsAt("2026-01-31"), 1);
  assertEquals(ytdMonthsAt("2026-02-28"), 2);
  assertEquals(ytdMonthsAt("2026-03-15"), 3);
  assertEquals(ytdMonthsAt("2026-06-30"), 6);
  assertEquals(ytdMonthsAt("2026-12-31"), 12);
});

Deno.test("employer matching ignores accents, legal suffixes and word order", () => {
  assert(employersMatch("HYDRO-QUÉBEC", "Hydro Quebec"));
  assert(employersMatch("Les Aliments Dubé Ltée", "Aliments Dube"));
  assert(employersMatch("CGI Inc.", "cgi"));
  assert(!employersMatch("Bombardier", "Desjardins"));
});

Deno.test("income auto-fill matches the analyst calculator", () => {
  const today = new Date("2026-09-20T00:00:00Z");
  const source = { employer_name: "Hydro-Québec", stated_monthly_income: 4600, flag_reasons: [] };
  // biweekly 2,100 → MI 4,557 ; YTD 39,900 by Sep 12 (9 months) → 4,433 ; lower_of → 4,433
  const fill = computeAutoFill({ gross_pay: 2100, net_pay: 1500, pay_frequency: "biweekly", pay_date: "2026-09-12",
    employer_name: "Hydro Quebec", ytd_gross: 39900, confidence: "high" }, source, today)!;
  assertEquals(monthlyFromPeriod(2100, "biweekly"), 4557);
  assertEquals(fill.calc_method, "lower_of");
  assertEquals(fill.ytd_months, 9);
  assertEquals(fill.calculated_monthly_income, 4433);
  assertEquals(fill.flags, []);
  assertEquals(fill.verification_status, "unverified");

  const odd = computeAutoFill({ gross_pay: 3000, net_pay: null, pay_frequency: "weekly", pay_date: "2026-05-01",
    employer_name: "Someone Else Inc", ytd_gross: 20000, confidence: "low" }, source, today)!;
  assert(odd.flags.includes("Employer name mismatch"));
  assert(odd.flags.includes("Document > 60 days old"));
  assert(odd.flags.includes("Low confidence extraction"));
  assert(odd.flags.some((f) => f.startsWith("MI vs YTD gap:")));
  assertEquals(odd.verification_status, "flagged");

  assertEquals(computeAutoFill({ gross_pay: null, net_pay: 900, pay_frequency: null, pay_date: null,
    employer_name: null, ytd_gross: null, confidence: "high" }, source, today), null);
});

Deno.test("existing analyst flags are kept, not duplicated", () => {
  const fill = computeAutoFill({ gross_pay: 1000, net_pay: null, pay_frequency: "monthly", pay_date: "2026-09-01",
    employer_name: null, ytd_gross: null, confidence: "high" },
    { employer_name: "X", stated_monthly_income: 5000, flag_reasons: ["Income variance > 15%", "MI vs YTD gap: 40%"] },
    new Date("2026-09-10T00:00:00Z"))!;
  assertEquals(fill.flags, ["Income variance > 15%"]);
  assertEquals(fill.verification_status, "unverified", "only already-known flags → no new review needed");
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
});

Deno.test("AI config: OpenRouter first, legacy gateway as fallback, secrets override models", () => {
  const env = (o: Record<string, string>) => (k: string) => o[k];
  assertEquals(aiConfigFromEnv(env({})), null);
  assertEquals(aiConfigFromEnv(env({ LOVABLE_API_KEY: "l" }))?.provider, "legacy");
  const cfg = aiConfigFromEnv(env({ OPENROUTER_API_KEY: "k", LOVABLE_API_KEY: "l", AI_MODELS: "a/free:free, b/paid", AI_DATA_COLLECTION: "deny" }))!;
  assertEquals(cfg.provider, "openrouter");
  assertEquals(cfg.models, ["a/free:free", "b/paid"]);
  assertEquals(cfg.dataCollection, "deny");
  assertEquals(aiConfigFromEnv(env({ OPENROUTER_API_KEY: "k" }))!.models, DEFAULT_MODELS);
});

Deno.test("JSON is pulled out of fenced or chatty replies", () => {
  assertEquals(parseJsonReply('Sure!\n```json\n{"a": 1}\n```'), { a: 1 });
  assertEquals(parseJsonReply('{"document_type":"pay_stub"} trailing'), { document_type: "pay_stub" });
});

Deno.test("OpenRouter request carries the fallback chain, privacy setting and free PDF parser", async () => {
  const cfg = aiConfigFromEnv((k) => ({ OPENROUTER_API_KEY: "sk", AI_MODELS: "m1:free,m2:free,m3", AI_DATA_COLLECTION: "deny" } as Record<string, string>)[k])!;
  let sent: Record<string, any> = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
  const fakeFetch = (async (_url: string, init: RequestInit) => {
    sent = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ model: "m2:free", choices: [{ message: { content: '{"document_type":"insurance"}' } }] }));
  }) as unknown as typeof fetch;
  const r = await callJson(cfg, { system: "s", content: [{ type: "text", text: "t" }], hasPdf: true, fetchImpl: fakeFetch });
  assertEquals(r.model, "m2:free");
  assertEquals(r.data.document_type, "insurance");
  assertEquals(sent.models, ["m1:free", "m2:free", "m3"]);
  assertEquals(sent.provider.data_collection, "deny");
  assertEquals(sent.plugins[0].pdf.engine, "cloudflare-ai");
  assertEquals(sent.temperature, 0);

  const limited = (async () => new Response(JSON.stringify({ error: { message: "slow down", code: 429 } }), { status: 429 })) as unknown as typeof fetch;
  const err = await assertRejects(() => callJson(cfg, { system: "s", content: [], fetchImpl: limited }), AiError);
  assertEquals((err as AiError).status, 429);
});

Deno.test("long chains go out three models at a time and move on when a batch fails", async () => {
  assertEquals(modelBatches(["a", "b", "c", "d", "e"]), [["a", "b", "c"], ["d", "e"]]);
  const cfg = aiConfigFromEnv((k) => ({ OPENROUTER_API_KEY: "sk", AI_MODELS: "f1:free,f2:free,r,p1,p2" } as Record<string, string>)[k])!;
  const seen: string[][] = [];
  const fakeFetch = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    seen.push(body.models ?? [body.model]);
    if (seen.length === 1) return new Response(JSON.stringify({ error: { message: "rate-limited upstream", code: 429 } }), { status: 429 });
    return new Response(JSON.stringify({ model: "p1", choices: [{ message: { content: '{"ok":true}' } }] }));
  }) as unknown as typeof fetch;
  const r = await callJson(cfg, { system: "s", content: [{ type: "text", text: "t" }], fetchImpl: fakeFetch });
  assertEquals(seen, [["f1:free", "f2:free", "r"], ["p1", "p2"]]);
  assertEquals(r.model, "p1");

  let calls = 0;
  const badKey = (async () => { calls++; return new Response(JSON.stringify({ error: { message: "No auth", code: 401 } }), { status: 401 }); }) as unknown as typeof fetch;
  const err = await assertRejects(() => callJson(cfg, { system: "s", content: [], fetchImpl: badKey }), AiError);
  assertEquals((err as AiError).status, 401);
  assertEquals(calls, 1);
});
