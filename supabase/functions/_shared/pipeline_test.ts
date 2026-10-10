// deno test supabase/functions/_shared
// The process-document lifecycle against an in-memory store and a fake OpenRouter: claiming,
// file-name type saved before the AI, failures and retries, escalation, the daily cap, and
// the income auto-fill rules (locks, newest pay stub, review status).
import nodeAssert from "node:assert/strict";
import { aiConfigFromEnv, callJson } from "./ai.ts";
import type { DocumentType } from "./classify.ts";
import type { SourceForMatch } from "./income.ts";
import {
  type AiUsageRow, backoffMinutes, claimableStatuses, claimAll, claimPatch, type ClaimMode, type DocRow, failurePatch,
  isStale, MAX_DOCS_PER_CALL, MESSAGES, parseProcessRequest, processAll, type ProcessingStatus, processClaimed, type Repo,
  retryDueFilter, type RunContext,
} from "./pipeline.ts";
import { AiError } from "./ai.ts";

const assert = (v: unknown, msg?: string) => nodeAssert.ok(v, msg);
const assertEquals = (a: unknown, b: unknown, msg?: string) => nodeAssert.deepStrictEqual(a, b, msg);

const NOW = new Date("2026-10-10T12:00:00.000Z");
const DEAL = "11111111-1111-4111-8111-111111111111";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// ---------------------------------------------------------------- in-memory store
type Row = Record<string, unknown>;
class MemRepo implements Repo {
  docs = new Map<string, DocRow & Row>();
  sources: (SourceForMatch & Row)[] = [];
  extractions = new Map<string, Row>();
  usage: AiUsageRow[] = [];
  timelineRows: { description: string; metadata: Row }[] = [];
  events: string[] = [];
  automationSettings = { autoSort: true, autoFill: true };
  priorCallsToday = 0;
  failDownloadFor = new Set<string>();

  addDoc(o: Partial<DocRow> & { name: string }): DocRow {
    const doc: DocRow = {
      id: id(this.docs.size + 1), deal_id: DEAL, type: "other", type_source: "auto", processing_status: "pending",
      storage_path: `${DEAL}/file-${this.docs.size + 1}.jpg`, file_url: "", preview_path: null, mime_type: "image/jpeg",
      file_size: 1000, attempt_count: 0, processing_started_at: null, next_attempt_at: null,
      created_at: "2026-10-10T11:00:00.000Z", ...o,
    };
    this.docs.set(doc.id, { ...doc });
    return { ...doc };
  }
  doc(docId: string) { return this.docs.get(docId)!; }

  async documentsByIds(ids: string[]) { return ids.filter((i) => this.docs.has(i)).map((i) => ({ ...this.docs.get(i)! })); }
  async dueDocuments() { return [...this.docs.values()].map((d) => ({ ...d })); }
  async claimDocument(doc: DocRow, mode: ClaimMode, now: Date) {
    const row = this.docs.get(doc.id);
    if (!row || row.attempt_count !== doc.attempt_count || !claimableStatuses(mode).includes(row.processing_status)) return null;
    if (mode === "stale" && !isStale(row, now)) return null;
    Object.assign(row, claimPatch(doc, now));
    this.events.push(`claim:${doc.id}`);
    return { ...row };
  }
  async setDocumentType(docId: string, type: DocumentType, source: "rule" | "auto", confidence: string) {
    const row = this.docs.get(docId)!;
    if (row.type_source === "manual") return false;
    Object.assign(row, { type, type_source: source, classification_confidence: confidence });
    this.events.push(`type:${source}:${type}`);
    return true;
  }
  async documentType(docId: string) { const r = this.docs.get(docId)!; return { type: r.type, type_source: r.type_source }; }
  async updateDocument(docId: string, patch: Row, onlyIfStatus?: ProcessingStatus) {
    const row = this.docs.get(docId)!;
    if (onlyIfStatus && row.processing_status !== onlyIfStatus) return;
    Object.assign(row, patch);
  }
  async download(path: string) {
    if (this.failDownloadFor.has(path)) throw new Error("storage exploded");
    return new Uint8Array([1, 2, 3]);
  }
  async automations() { return this.automationSettings; }
  async aiCallsToday(dealId: string) { return this.priorCallsToday + this.usage.filter((u) => u.deal_id === dealId).length; }
  async logAiUsage(row: AiUsageRow) { this.usage.push(row); this.events.push(`ai:${row.purpose}`); }
  async timeline(_dealId: string, description: string, metadata: Row) { this.timelineRows.push({ description, metadata }); }
  async incomeSources() { return this.sources.map((s) => ({ ...s })); }
  async createPrimarySource(_dealId: string, employer: string | null) {
    const s = { id: "new-source", employer_name: employer ?? "Employer on document", is_primary: true, verification_status: "unverified",
      stated_monthly_income: 0, flag_reasons: [], calc_locked: false };
    this.sources.push(s);
    return { ...s };
  }
  async extractionPayDate(documentId: string) { return (this.extractions.get(documentId)?.pay_date as string) ?? null; }
  async saveExtraction(row: Row) { this.extractions.set(row.document_id as string, row); }
  async updateIncomeSource(sourceId: string, patch: Row) {
    const s = this.sources.find((x) => x.id === sourceId)!;
    if (s.calc_locked || s.verification_status === "verified") return false;
    Object.assign(s, patch);
    return true;
  }
}

// ---------------------------------------------------------------- fake OpenRouter
type Reply = Row | { status: number; error: string };
function openRouter(replies: Reply[]) {
  const sent: { models: string[] }[] = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    sent.push({ models: body.models ?? [body.model] });
    const r = replies.shift();
    if (!r) throw new Error("unexpected AI call");
    if ("error" in r && "status" in r) {
      return new Response(JSON.stringify({ error: { message: r.error, code: r.status } }), { status: r.status as number });
    }
    return new Response(JSON.stringify({
      model: body.model, usage: { prompt_tokens: 900, completion_tokens: 60, cost: 0.0003 },
      choices: [{ message: { content: JSON.stringify(r) } }],
    }));
  }) as unknown as typeof fetch;
  return { sent, fetchImpl };
}

const CFG = aiConfigFromEnv((k) => ({
  OPENROUTER_API_KEY: "sk-test", AI_MODELS: "main/a,main/b", AI_ESCALATION_MODELS: "strong/x",
} as Record<string, string>)[k])!;

function ctxWith(fetchImpl: typeof fetch, o: Partial<RunContext> = {}): RunContext {
  return {
    ai: CFG, callAi: (cfg, opts) => callJson(cfg, { ...opts, fetchImpl }), userId: "user-1",
    bypassCap: false, maxAiCallsPerDay: 60, now: () => NOW, ...o,
  };
}

async function claimOne(repo: MemRepo, doc: DocRow, force = false) {
  const { claimed } = await claimAll(repo, [doc], { force, retryDue: false }, NOW);
  assertEquals(claimed.length, 1, "claimed");
  return claimed[0];
}

const payStubReply = (o: Row = {}) => ({
  document_type: "pay_stub", type_confidence: "high", summary: "Pay stub",
  income: { gross_pay: 2100, pay_frequency: "biweekly", pay_date: "2026-09-25", employer_name: "Hydro-Québec", ytd_gross: 39900, confidence: "high", ...o },
});

// ---------------------------------------------------------------- tests
Deno.test("the file-name type is saved before the AI call and survives an AI failure", async () => {
  const repo = new MemRepo();
  const doc = await claimOne(repo, repo.addDoc({ name: "TalonDePaie_Sept2026.jpg" }));
  const ai = openRouter([{ status: 429, error: "Rate limit exceeded: upstream key sk-live-123 quota" }]);
  const result = await processClaimed(repo, doc, ctxWith(ai.fetchImpl));

  assertEquals(result.status, "failed");
  const row = repo.doc(doc.id);
  assertEquals([row.type, row.type_source], ["pay_stub", "rule"]);
  assert(repo.events.indexOf("type:rule:pay_stub") < repo.events.indexOf("ai:extract"), "type saved before the AI call");
  // rate limit → retry later, short generic message for the dealer, no escalation
  assertEquals(row.processing_error, MESSAGES.retrying);
  assertEquals(row.next_attempt_at, new Date(NOW.getTime() + 5 * 60_000).toISOString());
  assertEquals(ai.sent.length, 1, "a failed request is never escalated");
  // the technical detail is in ai_usage only
  assertEquals(repo.usage.length, 1);
  assertEquals([repo.usage[0].ok, repo.usage[0].error_code, repo.usage[0].purpose], [false, "rate_limit", "extract"]);
  assert(repo.usage[0].error_detail?.includes("quota"));
  assert(!JSON.stringify(row).includes("sk-live"), "nothing technical on the document");
});

Deno.test("retry waits grow with each attempt and stop after five", () => {
  assertEquals([1, 2, 3, 4, 5].map(backoffMinutes), [5, 15, 60, 240, null]);
  const at = (attempt: number, e: unknown) => failurePatch(e, attempt, NOW);
  assertEquals(at(3, new AiError("t", 408, "timeout")).next_attempt_at, new Date(NOW.getTime() + 60 * 60_000).toISOString());
  assertEquals(at(4, new AiError("c", 402, "credits")).next_attempt_at, new Date(NOW.getTime() + 240 * 60_000).toISOString());
  assertEquals(at(5, new AiError("r", 429, "rate_limit")), {
    processing_status: "failed", processing_error: MESSAGES.failed, next_attempt_at: null, processed_at: NOW.toISOString(),
  });
  // anything else: failed, generic, no automatic retry
  assertEquals(at(1, new Error("relation does not exist")).next_attempt_at, null);
  assertEquals(at(1, new Error("relation does not exist")).processing_error, MESSAGES.failed);
  assertEquals(at(1, new AiError("bad key", 401, "auth")).processing_error, MESSAGES.failed);
});

Deno.test("claims are atomic: a document is processed by one run only", async () => {
  const repo = new MemRepo();
  const doc = repo.addDoc({ name: "scan.jpg" });
  const [a, b] = await Promise.all([
    claimAll(repo, [doc], { force: false, retryDue: false }, NOW),
    claimAll(repo, [doc], { force: false, retryDue: false }, NOW),
  ]);
  assertEquals(a.claimed.length + b.claimed.length, 1);
  const row = repo.doc(doc.id);
  assertEquals([row.processing_status, row.attempt_count, row.processing_started_at], ["processing", 1, NOW.toISOString()]);

  // what can be claimed
  const done = repo.addDoc({ name: "x.jpg", processing_status: "done" });
  const busy = repo.addDoc({ name: "y.jpg", processing_status: "processing", processing_started_at: NOW.toISOString() });
  const spent = repo.addDoc({ name: "z.jpg", processing_status: "failed", attempt_count: 5 });
  const r = await claimAll(repo, [done, busy, spent], { force: false, retryDue: false }, NOW);
  assertEquals(r.claimed.length, 0);
  assertEquals(r.skipped.map((s) => s.status), ["done", "processing", "failed"]);
  // staff force re-reads a done document (and one out of attempts), never one in flight
  const f = await claimAll(repo, [done, busy, spent], { force: true, retryDue: false }, NOW);
  assertEquals(f.claimed.map((d) => d.id), [done.id, spent.id]);
});

Deno.test("the retry run recovers documents left 'processing' by a run that died", async () => {
  const repo = new MemRepo();
  const old = new Date(NOW.getTime() - 20 * 60_000).toISOString();
  const stale = repo.addDoc({ name: "a.jpg", processing_status: "processing", processing_started_at: old, attempt_count: 1 });
  const fresh = repo.addDoc({ name: "b.jpg", processing_status: "processing", processing_started_at: NOW.toISOString(), attempt_count: 1 });
  const spent = repo.addDoc({ name: "c.jpg", processing_status: "processing", processing_started_at: old, attempt_count: 5 });
  const { claimed, skipped } = await claimAll(repo, [stale, fresh, spent], { force: false, retryDue: true }, NOW);
  assertEquals(claimed.map((d) => d.id), [stale.id]);
  assertEquals(repo.doc(stale.id).attempt_count, 2);
  assertEquals(skipped.find((s) => s.id === fresh.id)?.status, "processing");
  assertEquals([repo.doc(spent.id).processing_status, repo.doc(spent.id).processing_error], ["failed", MESSAGES.failed]);
});

Deno.test("the retry query asks for due failures, unclaimed pending and stale processing, with quoted times", () => {
  const f = retryDueFilter(NOW);
  assert(f.includes(`and(processing_status.eq.failed,next_attempt_at.lte."2026-10-10T12:00:00.000Z",attempt_count.lt.5)`));
  assert(f.includes(`and(processing_status.eq.pending,created_at.lt."2026-10-10T11:55:00.000Z")`));
  assert(f.includes(`and(processing_status.eq.processing,processing_started_at.lt."2026-10-10T11:45:00.000Z")`));
});

Deno.test("a manual type is never overwritten, even if a person sets it mid-run", async () => {
  const repo = new MemRepo();
  // set by a person: no rule, no AI type
  const manual = await claimOne(repo, repo.addDoc({ name: "Talon de paie.jpg", type: "bank_statement", type_source: "manual" }));
  const ai = openRouter([{ ...payStubReply(), document_type: "pay_stub" }]);
  await processClaimed(repo, manual, ctxWith(ai.fetchImpl));
  assertEquals([repo.doc(manual.id).type, repo.doc(manual.id).type_source], ["bank_statement", "manual"]);
  assert(!repo.events.some((e) => e.startsWith("type:")));

  // changed to manual by staff while the AI was reading
  const repo2 = new MemRepo();
  const doc = await claimOne(repo2, repo2.addDoc({ name: "IMG_0042.jpg" }));
  const ai2 = openRouter([{ document_type: "insurance", type_confidence: "high", income: null, summary: "" }]);
  const ctx = ctxWith(ai2.fetchImpl);
  const orig = ctx.callAi!;
  ctx.callAi = async (cfg, opts) => {
    const r = await orig(cfg, opts);
    Object.assign(repo2.doc(doc.id), { type: "trade_in", type_source: "manual" });
    return r;
  };
  await processClaimed(repo2, doc, ctx);
  assertEquals([repo2.doc(doc.id).type, repo2.doc(doc.id).processing_status], ["trade_in", "done"]);
});

Deno.test("escalation happens only for a low-confidence answer, never after a failed request", async () => {
  // confident first answer: one call
  let repo = new MemRepo();
  let doc = await claimOne(repo, repo.addDoc({ name: "IMG_1.jpg" }));
  let ai = openRouter([{ document_type: "insurance", type_confidence: "high", income: null, summary: "" }]);
  await processClaimed(repo, doc, ctxWith(ai.fetchImpl));
  assertEquals(ai.sent.length, 1);
  assertEquals([repo.doc(doc.id).type, repo.doc(doc.id).type_source], ["insurance", "auto"]);

  // unsure type: re-read once on the escalation chain
  repo = new MemRepo();
  doc = await claimOne(repo, repo.addDoc({ name: "IMG_2.jpg" }));
  ai = openRouter([
    { document_type: "insurance", type_confidence: "low", income: null, summary: "" },
    { document_type: "vehicle_invoice", type_confidence: "high", income: null, summary: "" },
  ]);
  await processClaimed(repo, doc, ctxWith(ai.fetchImpl));
  assertEquals(ai.sent.map((s) => s.models), [["main/a", "main/b"], ["strong/x"]]);
  assertEquals(repo.usage.map((u) => u.purpose), ["classify", "escalate"]);
  assertEquals(repo.doc(doc.id).type, "vehicle_invoice");

  // income figures low-confidence on a pay stub: escalate; if the re-read fails, keep the first answer
  repo = new MemRepo();
  repo.sources.push({ id: "s1", employer_name: "Hydro-Québec", is_primary: true, verification_status: "unverified",
    stated_monthly_income: 4500, flag_reasons: [], calc_locked: false });
  doc = await claimOne(repo, repo.addDoc({ name: "paystub.jpg" }));
  ai = openRouter([payStubReply({ confidence: "low" }), { status: 503, error: "overloaded" }]);
  const r = await processClaimed(repo, doc, ctxWith(ai.fetchImpl));
  assertEquals(ai.sent.length, 2);
  assertEquals(r.status, "done");
  assertEquals(repo.extractions.get(doc.id)?.gross_pay, 2100);

  // the first request fails: failed + retry, the escalation chain is not tried
  repo = new MemRepo();
  doc = await claimOne(repo, repo.addDoc({ name: "IMG_3.jpg" }));
  ai = openRouter([{ status: 504, error: "gateway timeout" }]);
  await processClaimed(repo, doc, ctxWith(ai.fetchImpl));
  assertEquals(ai.sent.length, 1);
  assertEquals([repo.doc(doc.id).processing_status, repo.doc(doc.id).processing_error], ["failed", MESSAGES.retrying]);
});

Deno.test("the per-deal daily cap stops AI calls unless staff force a re-read", async () => {
  const repo = new MemRepo();
  repo.priorCallsToday = 60;
  const doc = await claimOne(repo, repo.addDoc({ name: "IMG_9.jpg" }));
  const ai = openRouter([]);
  const r = await processClaimed(repo, doc, ctxWith(ai.fetchImpl));
  assertEquals(r.status, "failed");
  assertEquals(ai.sent.length, 0);
  assertEquals([repo.doc(doc.id).processing_error, repo.doc(doc.id).next_attempt_at], [MESSAGES.dailyCap, null]);

  const forced = await claimOne(repo, repo.doc(doc.id), true);
  const ai2 = openRouter([{ document_type: "insurance", type_confidence: "high", income: null, summary: "" }]);
  assertEquals((await processClaimed(repo, forced, ctxWith(ai2.fetchImpl, { bypassCap: true }))).status, "done");
  assertEquals(ai2.sent.length, 1);

  // one call left: the first pass runs, the escalation doesn't
  const repo3 = new MemRepo();
  repo3.priorCallsToday = 59;
  const d3 = await claimOne(repo3, repo3.addDoc({ name: "IMG_10.jpg" }));
  const ai3 = openRouter([{ document_type: "insurance", type_confidence: "low", income: null, summary: "" }]);
  await processClaimed(repo3, d3, ctxWith(ai3.fetchImpl));
  assertEquals(ai3.sent.length, 1);
});

Deno.test("no AI key: the name-based type is kept and the document is skipped, not failed", async () => {
  const repo = new MemRepo();
  const doc = await claimOne(repo, repo.addDoc({ name: "Relevé bancaire.pdf", mime_type: "application/pdf" }));
  const r = await processClaimed(repo, doc, ctxWith(openRouter([]).fetchImpl, { ai: null }));
  assertEquals(r.status, "skipped");
  assertEquals(repo.doc(doc.id).type, "bank_statement");
  assertEquals(repo.doc(doc.id).processing_error, MESSAGES.notConfigured);
  // a document the name settles completely needs no AI at all
  const id2 = await claimOne(repo, repo.addDoc({ name: "Permis de conduire.jpg" }));
  assertEquals((await processClaimed(repo, id2, ctxWith(openRouter([]).fetchImpl, { ai: null }))).status, "done");
});

Deno.test("each document is independent: one failure doesn't stop the others", async () => {
  const repo = new MemRepo();
  const a = repo.addDoc({ name: "IMG_a.jpg" });
  const b = repo.addDoc({ name: "IMG_b.jpg" });
  const c = repo.addDoc({ name: "IMG_c.jpg" });
  repo.failDownloadFor.add(b.storage_path!);
  const { claimed } = await claimAll(repo, [a, b, c], { force: false, retryDue: false }, NOW);
  const ai = openRouter([
    { document_type: "insurance", type_confidence: "high", income: null, summary: "" },
    { document_type: "trade_in", type_confidence: "high", income: null, summary: "" },
  ]);
  const results = await processAll(repo, claimed, ctxWith(ai.fetchImpl), 1);
  assertEquals(results.map((r) => r.status), ["done", "failed", "done"]);
  assertEquals([repo.doc(b.id).processing_error, repo.doc(b.id).next_attempt_at], [MESSAGES.failed, null]);
});

Deno.test("income auto-fill: locked sources keep their figures but get the evidence", async () => {
  const repo = new MemRepo();
  repo.sources.push({ id: "s1", employer_name: "Hydro-Québec", is_primary: true, verification_status: "unverified",
    stated_monthly_income: 4500, flag_reasons: [], calc_locked: true, calc_method: "mi", calculated_monthly_income: 4100,
    auto_fill_document_id: null, auto_filled_at: null });
  const doc = await claimOne(repo, repo.addDoc({ name: "paystub.jpg" }));
  await processClaimed(repo, doc, ctxWith(openRouter([payStubReply()]).fetchImpl));
  assertEquals(repo.sources[0].calculated_monthly_income, 4100);
  assertEquals(repo.extractions.get(doc.id)?.income_source_id, "s1");
  assertEquals(repo.doc(doc.id).processing_status, "done");
});

Deno.test("income auto-fill: the newest pay stub wins and the review status never drops", async () => {
  const repo = new MemRepo();
  repo.sources.push({ id: "s1", employer_name: "Hydro-Québec", is_primary: true, verification_status: "flagged",
    stated_monthly_income: 4500, flag_reasons: ["MI vs YTD gap: 30%"], calc_locked: false });
  const newer = await claimOne(repo, repo.addDoc({ name: "paystub-sep.jpg" }));
  await processClaimed(repo, newer, ctxWith(openRouter([payStubReply({ pay_date: "2026-09-25" })]).fetchImpl));
  const s = repo.sources[0];
  assertEquals(s.auto_fill_document_id, newer.id);
  // MI 2,100 × 26/12 = 4,550; YTD 39,900 over 8.80 months = 4,534 → lower of
  assertEquals([s.calc_method, s.calculated_monthly_income, s.ytd_months], ["lower_of", 4534, 8.8]);
  assertEquals(s.verification_status, "flagged", "a clean stub doesn't lower a flagged source");

  // an older stub arrives later: evidence only
  const older = await claimOne(repo, repo.addDoc({ name: "paystub-aug.jpg" }));
  await processClaimed(repo, older, ctxWith(openRouter([payStubReply({ pay_date: "2026-08-28", gross_pay: 1900, ytd_gross: 34000 })]).fetchImpl));
  assertEquals(repo.sources[0].auto_fill_document_id, newer.id);
  assertEquals(repo.sources[0].gross_per_period, 2100);
  assertEquals(repo.extractions.get(older.id)?.income_source_id, "s1");
  assertEquals(repo.doc(older.id).processing_status, "done");

  // never set to verified, and a verified source is left alone
  repo.sources[0].verification_status = "verified";
  const third = await claimOne(repo, repo.addDoc({ name: "paystub-oct.jpg" }));
  await processClaimed(repo, third, ctxWith(openRouter([payStubReply({ pay_date: "2026-10-09", gross_pay: 2300 })]).fetchImpl));
  assertEquals(repo.sources[0].gross_per_period, 2100);
  assertEquals(repo.sources[0].verification_status, "verified");
});

Deno.test("process-document requests: at most 5 documents, force is staff-only, retry runs are internal", () => {
  const staff = { internal: false, isStaff: true }, dealer = { internal: false, isStaff: false };
  const six = Array.from({ length: MAX_DOCS_PER_CALL + 1 }, (_, i) => id(i + 1));
  const tooMany = parseProcessRequest({ documentIds: six }, staff);
  assertEquals("status" in tooMany && tooMany.status, 400);
  assert("error" in tooMany && tooMany.error.includes("at most 5"));
  const forced = parseProcessRequest({ documentIds: [id(1)], force: true }, dealer);
  assertEquals("status" in forced && forced.status, 403);
  assertEquals(parseProcessRequest({ retryDue: true }, staff), { status: 403, error: "Not allowed" });
  assertEquals(parseProcessRequest({ retryDue: true }, { internal: true, isStaff: false }),
    { ids: [], force: false, background: true, retryDue: true });
  assertEquals(parseProcessRequest({ documentIds: ["../etc"] }, staff), { status: 400, error: "Invalid document id" });
  const ok = parseProcessRequest({ documentIds: [id(1), id(1).toUpperCase()], documentId: id(2), background: true }, dealer);
  assertEquals(ok, { ids: [id(1), id(2)], force: false, background: true, retryDue: false });
  assertEquals(parseProcessRequest({ documentIds: [id(1)], force: true }, staff), { ids: [id(1)], force: true, background: false, retryDue: false });
});
