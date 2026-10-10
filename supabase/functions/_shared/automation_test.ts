// deno test supabase/functions/_shared
// The AI client: settings, privacy defaults, the request sent to OpenRouter, timeouts and usage.
// File-name sorting is in classify_test.ts, income maths in income_test.ts, the document
// lifecycle in pipeline_test.ts, HTTP/security helpers in http_test.ts.
import nodeAssert from "node:assert/strict";
import { needsAi, normalizeReading, toAmount } from "./classify.ts";
import {
  type AiAttempt, aiConfigFromEnv, AiError, buildRequestBody, callJson, clearAiConfigCache, DEFAULT_ESCALATION_MODELS,
  DEFAULT_MODELS, isTransientAiError, loadAiConfig, loadSettings, MAX_MODELS_PER_REQUEST, modelBatches, parseJsonReply,
} from "./ai.ts";

const assert = (v: unknown, msg?: string) => nodeAssert.ok(v, msg);
const assertEquals = (a: unknown, b: unknown, msg?: string) => nodeAssert.deepStrictEqual(a, b, msg);
async function assertRejects(fn: () => Promise<unknown>, cls: new (...a: never[]) => Error): Promise<Error> {
  try { await fn(); } catch (e) { nodeAssert.ok(e instanceof cls, `expected ${cls.name}, got ${e}`); return e as Error; }
  throw new Error("expected promise to reject");
}
const env = (o: Record<string, string>) => (k: string) => o[k];
// deno-lint-ignore no-explicit-any
type Body = Record<string, any>;

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
});

Deno.test("AI config: needs an OpenRouter key; secrets override the default models", () => {
  assertEquals(aiConfigFromEnv(env({})), null);
  const cfg = aiConfigFromEnv(env({ OPENROUTER_API_KEY: "k", AI_MODELS: "a/free:free, b/paid", AI_DATA_COLLECTION: "deny" }))!;
  assertEquals(cfg.apiKey, "k");
  assertEquals(cfg.models, ["a/free:free", "b/paid"]);
  assertEquals(cfg.dataCollection, "deny");
  assertEquals(aiConfigFromEnv(env({ OPENROUTER_API_KEY: "k" }))!.models, DEFAULT_MODELS);
});

Deno.test("privacy is on by default: no data collection, zero data retention only", () => {
  const cfg = aiConfigFromEnv(env({ OPENROUTER_API_KEY: "k" }))!;
  assertEquals(cfg.dataCollection, "deny");
  assertEquals(cfg.zdr, true);
  assertEquals(cfg.timeoutMs, 45_000);
  // only an explicit opt-out lifts them
  const open = aiConfigFromEnv(env({ OPENROUTER_API_KEY: "k", AI_DATA_COLLECTION: "allow", AI_ZDR: "false" }))!;
  assertEquals(open.dataCollection, "allow");
  assertEquals(open.zdr, false);
  assertEquals(aiConfigFromEnv(env({ OPENROUTER_API_KEY: "k", AI_DATA_COLLECTION: "yes please" }))!.dataCollection, "deny");
});

Deno.test("default model chains are short and paid ZDR models, not free endpoints", () => {
  for (const chain of [DEFAULT_MODELS, DEFAULT_ESCALATION_MODELS]) {
    assert(chain.length >= 1 && chain.length <= MAX_MODELS_PER_REQUEST, "1–3 models per chain");
    assert(chain.every((m) => /^[a-z0-9-]+\/[a-z0-9.-]+$/.test(m)), "plain OpenRouter model ids");
    assert(!chain.some((m) => m.endsWith(":free")), "free endpoints are not zero-data-retention");
  }
});

Deno.test("AI settings: function secrets win, the vault fills the gaps, and is cached", async () => {
  clearAiConfigCache();
  let reads = 0;
  const vault = async () => { reads++; return { OPENROUTER_API_KEY: "vault-key", AI_MODELS: "v/one,v/two", AI_DATA_COLLECTION: "deny", ALLOWED_ORIGINS: "https://x.example" }; };
  const fromVault = await loadAiConfig(() => undefined, vault);
  assertEquals(fromVault?.apiKey, "vault-key");
  assertEquals(fromVault?.models, ["v/one", "v/two"]);
  assertEquals(fromVault?.dataCollection, "deny");
  const mixed = await loadAiConfig((k) => (k === "AI_MODELS" ? "env/model" : undefined), vault);
  assertEquals(mixed?.apiKey, "vault-key");
  assertEquals(mixed?.models, ["env/model"]);
  // the same loader serves the other settings
  const get = await loadSettings(["ALLOWED_ORIGINS"], (k) => (k === "AI_ZDR" ? "true" : undefined), vault);
  assertEquals(get("ALLOWED_ORIGINS"), "https://x.example");
  assertEquals(get("AI_ZDR"), "true");
  assertEquals(reads, 1); // later calls used the cache

  clearAiConfigCache();
  const failing = async () => { throw new Error("no access"); };
  assertEquals(await loadAiConfig(() => undefined, failing), null);
  assertEquals((await loadAiConfig((k) => (k === "OPENROUTER_API_KEY" ? "env-key" : undefined), failing))?.apiKey, "env-key");
  clearAiConfigCache();
});

Deno.test("JSON is pulled out of fenced or chatty replies", () => {
  assertEquals(parseJsonReply('Sure!\n```json\n{"a": 1}\n```'), { a: 1 });
  assertEquals(parseJsonReply('{"document_type":"pay_stub"} trailing'), { document_type: "pay_stub" });
  const e = (() => { try { parseJsonReply("{not json}"); } catch (err) { return err; } })();
  assert(e instanceof AiError && e.code === "bad_reply");
});

Deno.test("OpenRouter request carries the fallback chain, privacy settings and usage accounting", async () => {
  const cfg = aiConfigFromEnv(env({ OPENROUTER_API_KEY: "sk", AI_MODELS: "m1,m2,m3" }))!;
  let sent: Body = {};
  const fakeFetch = (async (_url: string, init: RequestInit) => {
    sent = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ model: "m2", choices: [{ message: { content: '{"document_type":"insurance"}' } }] }));
  }) as unknown as typeof fetch;
  const r = await callJson(cfg, { system: "s", content: [{ type: "text", text: "t" }], hasPdf: true, fetchImpl: fakeFetch });
  assertEquals(r.model, "m2");
  assertEquals(r.data.document_type, "insurance");
  assertEquals(sent.models, ["m1", "m2", "m3"]);
  assertEquals(sent.provider, { data_collection: "deny", zdr: true });
  assertEquals(sent.usage, { include: true });
  assertEquals(sent.temperature, 0);
  // under ZDR the PDF goes to the ZDR model itself, not to a parsing plugin
  assertEquals(sent.plugins[0].pdf.engine, "native");

  const open = aiConfigFromEnv(env({ OPENROUTER_API_KEY: "sk", AI_ZDR: "false" }))!;
  const body = buildRequestBody(open, { system: "s", content: [], hasPdf: true }, ["a"]);
  assertEquals((body as Body).plugins[0].pdf.engine, "cloudflare-ai");
  assertEquals((body as Body).provider, { data_collection: "deny" });
  assertEquals((body as Body).models, undefined, "a single model is sent as `model` only");

  const limited = (async () => new Response(JSON.stringify({ error: { message: "slow down", code: 429 } }), { status: 429 })) as unknown as typeof fetch;
  const err = await assertRejects(() => callJson(cfg, { system: "s", content: [], fetchImpl: limited }), AiError);
  assertEquals((err as AiError).status, 429);
  assertEquals((err as AiError).code, "rate_limit");
});

Deno.test("every request is reported with model, latency, tokens and cost — and failures with detail", async () => {
  const cfg = aiConfigFromEnv(env({ OPENROUTER_API_KEY: "sk", AI_MODELS: "m1,m2" }))!;
  const attempts: AiAttempt[] = [];
  const ok = (async () => new Response(JSON.stringify({
    model: "m1", usage: { prompt_tokens: 1200, completion_tokens: 80, cost: 0.00042 },
    choices: [{ message: { content: '{"a":1}' } }],
  }))) as unknown as typeof fetch;
  await callJson(cfg, { system: "s", content: [], fetchImpl: ok, onAttempt: (a) => { attempts.push(a); } });
  assertEquals(attempts.length, 1);
  assertEquals(attempts[0].ok, true);
  assertEquals(attempts[0].model, "m1");
  assertEquals([attempts[0].promptTokens, attempts[0].completionTokens, attempts[0].cost], [1200, 80, 0.00042]);
  assert(attempts[0].latencyMs >= 0);

  const broke = (async () => new Response(JSON.stringify({ error: { message: "Provider returned error: upstream overloaded", code: 503 } }), { status: 503 })) as unknown as typeof fetch;
  await assertRejects(() => callJson(cfg, { system: "s", content: [], fetchImpl: broke, onAttempt: (a) => { attempts.push(a); } }), AiError);
  const failed = attempts[1];
  assertEquals([failed.ok, failed.status, failed.errorCode], [false, 503, "upstream"]);
  assert(failed.errorDetail?.includes("upstream overloaded"), "technical detail is kept for the log");

  // a logging failure never breaks the call
  await callJson(cfg, { system: "s", content: [], fetchImpl: ok, onAttempt: () => { throw new Error("db down"); } });
});

Deno.test("a request that takes too long is abandoned and reported as a timeout", async () => {
  const cfg = { ...aiConfigFromEnv(env({ OPENROUTER_API_KEY: "sk", AI_MODELS: "slow" }))!, timeoutMs: 30 };
  const attempts: AiAttempt[] = [];
  let aborted = false;
  const hang = ((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => { aborted = true; reject(new DOMException("aborted", "AbortError")); });
  })) as unknown as typeof fetch;
  const started = Date.now();
  const err = await assertRejects(() => callJson(cfg, { system: "s", content: [], fetchImpl: hang, onAttempt: (a) => { attempts.push(a); } }), AiError);
  assert(aborted, "the request was aborted");
  assert(Date.now() - started < 2000);
  assertEquals((err as AiError).code, "timeout");
  assertEquals(attempts[0].errorCode, "timeout");
  assert(isTransientAiError(err));
});

Deno.test("which AI failures are worth retrying later", () => {
  assert(isTransientAiError(new AiError("x", 429, "rate_limit")));
  assert(isTransientAiError(new AiError("x", 402, "credits")));
  assert(isTransientAiError(new AiError("x", 408, "timeout")));
  assert(isTransientAiError(new AiError("x", 503, "upstream")));
  assert(!isTransientAiError(new AiError("x", 401, "auth")));
  assert(!isTransientAiError(new AiError("x", 400, "upstream")));
  assert(!isTransientAiError(new Error("database")));
});

Deno.test("long chains go out three models at a time and move on when a batch fails", async () => {
  assertEquals(modelBatches(["a", "b", "c", "d", "e"]), [["a", "b", "c"], ["d", "e"]]);
  const cfg = aiConfigFromEnv(env({ OPENROUTER_API_KEY: "sk", AI_MODELS: "f1,f2,r,p1,p2" }))!;
  const seen: string[][] = [];
  const fakeFetch = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    seen.push(body.models ?? [body.model]);
    if (seen.length === 1) return new Response(JSON.stringify({ error: { message: "rate-limited upstream", code: 429 } }), { status: 429 });
    return new Response(JSON.stringify({ model: "p1", choices: [{ message: { content: '{"ok":true}' } }] }));
  }) as unknown as typeof fetch;
  const r = await callJson(cfg, { system: "s", content: [{ type: "text", text: "t" }], fetchImpl: fakeFetch });
  assertEquals(seen, [["f1", "f2", "r"], ["p1", "p2"]]);
  assertEquals(r.model, "p1");

  let calls = 0;
  const badKey = (async () => { calls++; return new Response(JSON.stringify({ error: { message: "No auth", code: 401 } }), { status: 401 }); }) as unknown as typeof fetch;
  const err = await assertRejects(() => callJson(cfg, { system: "s", content: [], fetchImpl: badKey }), AiError);
  assertEquals((err as AiError).status, 401);
  assertEquals(calls, 1);
});
