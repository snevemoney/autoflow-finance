// deno test supabase/functions/_shared
// The Supabase-backed store sends conditional writes: these tests record the PostgREST
// requests supabase-js makes and check their WHERE clauses.
import nodeAssert from "node:assert/strict";
import { createClient } from "npm:@supabase/supabase-js@2";
import { supabaseRepo } from "./repo.ts";
import type { DocRow } from "./pipeline.ts";

const assert = (v: unknown, msg?: string) => nodeAssert.ok(v, msg);
const assertEquals = (a: unknown, b: unknown, msg?: string) => nodeAssert.deepStrictEqual(a, b, msg);

interface Sent { method: string; path: string; params: URLSearchParams; body: unknown }

function recordingRepo(reply: (s: Sent) => unknown = () => []) {
  const sent: Sent[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const s: Sent = {
      method: init?.method ?? "GET", path: url.pathname, params: url.searchParams,
      body: init?.body ? JSON.parse(String(init.body)) : null,
    };
    sent.push(s);
    return new Response(JSON.stringify(reply(s)), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  const admin = createClient("http://db.test", "service-key", {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchImpl },
  });
  return { repo: supabaseRepo(admin), sent };
}

const DOC: DocRow = {
  id: "00000000-0000-4000-8000-000000000001", deal_id: "11111111-1111-4111-8111-111111111111", name: "a.pdf",
  type: "other", type_source: "auto", processing_status: "failed", storage_path: null, file_url: "", preview_path: null,
  mime_type: null, file_size: 1, attempt_count: 2, processing_started_at: null, next_attempt_at: null, created_at: "2026-10-10T00:00:00Z",
};
const NOW = new Date("2026-10-10T12:00:00.000Z");

Deno.test("claiming is one conditional UPDATE … RETURNING on status and the attempt count seen", async () => {
  const { repo, sent } = recordingRepo(() => [{ ...DOC, processing_status: "processing", attempt_count: 3 }]);
  const row = await repo.claimDocument(DOC, "normal", NOW);
  assertEquals(row?.attempt_count, 3);
  const s = sent[0];
  assertEquals([s.method, s.path], ["PATCH", "/rest/v1/documents"]);
  assertEquals(s.params.get("id"), `eq.${DOC.id}`);
  assertEquals(s.params.get("processing_status"), "in.(pending,failed)");
  assertEquals(s.params.getAll("attempt_count").sort(), ["eq.2", "lt.5"]);
  assert(s.params.get("select")?.includes("attempt_count"), "returns the claimed row");
  assertEquals(s.body, {
    processing_status: "processing", processing_started_at: NOW.toISOString(), attempt_count: 3,
    processing_error: null, next_attempt_at: null,
  });

  const { repo: r2, sent: s2 } = recordingRepo(() => []);
  assertEquals(await r2.claimDocument({ ...DOC, processing_status: "done" }, "force", NOW), null, "nothing claimed → null");
  assertEquals(s2[0].params.get("processing_status"), "in.(pending,failed,done,skipped,manual)");
});

Deno.test("a document's type is only written while no person has set it", async () => {
  const { repo, sent } = recordingRepo(() => []);
  assertEquals(await repo.setDocumentType(DOC.id, "pay_stub", "rule", "high"), false);
  assertEquals(sent[0].params.get("type_source"), "neq.manual");
  assertEquals(sent[0].body, { type: "pay_stub", type_source: "rule", classification_confidence: "high" });
});

Deno.test("income figures are only written to unlocked, unverified sources", async () => {
  const { repo, sent } = recordingRepo(() => [{ id: "s1" }]);
  assert(await repo.updateIncomeSource("s1", { calculated_monthly_income: 4550 }));
  assertEquals(sent[0].params.get("calc_locked"), "not.is.true");
  assertEquals(sent[0].params.get("verification_status"), "neq.verified");
});

Deno.test("finishing a document only touches it while this run holds it", async () => {
  const { repo, sent } = recordingRepo(() => []);
  await repo.updateDocument(DOC.id, { processing_status: "done" }, "processing");
  assertEquals(sent[0].params.get("processing_status"), "eq.processing");
});

Deno.test("AI usage and the daily count go through the contract's table and helper", async () => {
  const { repo, sent } = recordingRepo((s) => (s.path.endsWith("/ai_calls_today") ? 7 : []));
  assertEquals(await repo.aiCallsToday(DOC.deal_id), 7);
  assertEquals([sent[0].method, sent[0].path, sent[0].body], ["POST", "/rest/v1/rpc/ai_calls_today", { _deal_id: DOC.deal_id }]);
  await repo.logAiUsage({ deal_id: DOC.deal_id, document_id: DOC.id, user_id: null, purpose: "classify", model: "m", ok: true,
    error_code: null, error_detail: null, latency_ms: 10, prompt_tokens: 1, completion_tokens: 2, cost: 0.1 });
  assertEquals([sent[1].method, sent[1].path], ["POST", "/rest/v1/ai_usage"]);
});

Deno.test("the retry run asks for due documents oldest first, ten at a time", async () => {
  const { repo, sent } = recordingRepo(() => []);
  await repo.dueDocuments(NOW, 10);
  assert(sent[0].params.get("or")?.startsWith("(and(processing_status.eq.failed,"));
  assertEquals(sent[0].params.get("order"), "created_at.asc");
  assertEquals(sent[0].params.get("limit"), "10");
});
