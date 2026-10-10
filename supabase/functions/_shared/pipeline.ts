// The document pipeline behind process-document, written against a small storage interface
// (Repo) so the whole lifecycle can be tested without a database:
//   claim → sort by file name (saved before any AI call) → one AI read if needed (escalated
//   only when unsure) → auto-fill income → done, or failed with a retry time.
import {
  AiError, callJson, isTransientAiError,
  type AiAttempt, type AiConfig, type ContentPart, type JsonCallOptions, type JsonCallResult,
} from "./ai.ts";
import {
  classifyByFilename, INCOME_TYPES, isUnsure, normalizeReading, SYSTEM_PROMPT, userPrompt,
  type DocumentReading, type DocumentType,
} from "./classify.ts";
import { computeAutoFill, fillBlockedBy, METHOD_LABEL, pickSource, type SourceForMatch } from "./income.ts";
import { isUuid, toBase64 } from "./http.ts";

export const MAX_DOCS_PER_CALL = 5;
export const RETRY_BATCH = 10;
export const MAX_ATTEMPTS = 5;
/** A pending document nobody claimed within this long is picked up by the retry run. */
export const PENDING_GRACE_MIN = 5;
/** A document "processing" for longer than this was left by a run that died. */
export const STALE_PROCESSING_MIN = 15;
export const DEFAULT_MAX_AI_CALLS_PER_DEAL_DAY = 60;
/** Wait before retry n (by attempt count): 5 min, 15 min, 1 h, 4 h. */
export const BACKOFF_MINUTES = [5, 15, 60, 240];
export const MAX_AI_BYTES = 8 * 1024 * 1024;

/** processing_error is shown to dealers: short and generic. Details go to ai_usage. */
export const MESSAGES = {
  retrying: "Couldn't be read automatically yet — AutoFlow will retry.",
  failed: "Couldn't be read automatically — staff will review it.",
  dailyCap: "Automatic reading is paused for this deal today — staff will review it.",
  notConfigured: "Automatic reading isn't set up — staff will review it.",
} as const;

const LABEL: Record<DocumentType, string> = {
  credit_application: "Credit Application", income_verification: "Income Verification", pay_stub: "Pay Stub",
  bank_statement: "Bank Statement", vehicle_invoice: "Vehicle Invoice", trade_in: "Trade-In Documentation",
  insurance: "Insurance Proof", id_verification: "ID Verification", other: "Other",
};

export type ProcessingStatus = "pending" | "processing" | "done" | "failed" | "skipped" | "manual";

export interface DocRow {
  id: string;
  deal_id: string;
  name: string;
  type: DocumentType;
  type_source: string;
  processing_status: ProcessingStatus;
  storage_path: string | null;
  file_url: string;
  preview_path: string | null;
  mime_type: string | null;
  file_size: number;
  attempt_count: number;
  processing_started_at: string | null;
  next_attempt_at: string | null;
  created_at: string;
}

export const DOC_COLUMNS = "id, deal_id, name, type, type_source, processing_status, storage_path, file_url, preview_path, "
  + "mime_type, file_size, attempt_count, processing_started_at, next_attempt_at, created_at";

export interface AiUsageRow {
  deal_id: string | null;
  document_id: string | null;
  user_id: string | null;
  purpose: "classify" | "extract" | "escalate" | "verify_employer";
  model: string | null;
  ok: boolean;
  error_code: string | null;
  error_detail: string | null;
  latency_ms: number;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  cost: number | null;
}

export function usageRow(
  base: Pick<AiUsageRow, "deal_id" | "document_id" | "user_id" | "purpose">,
  a: AiAttempt,
): AiUsageRow {
  return {
    ...base,
    model: a.model ?? a.models.join(","),
    ok: a.ok,
    error_code: a.errorCode,
    error_detail: a.errorDetail,
    latency_ms: a.latencyMs,
    prompt_tokens: a.promptTokens,
    completion_tokens: a.completionTokens,
    cost: a.cost,
  };
}

export type ClaimMode = "normal" | "force" | "stale";

/** Storage used by the pipeline. The edge function backs it with Supabase (repo.ts). */
export interface Repo {
  // documents
  documentsByIds(ids: string[]): Promise<DocRow[]>;
  dueDocuments(now: Date, limit: number): Promise<DocRow[]>;
  /** Conditional update: only if the row still has the status and attempt count we saw. */
  claimDocument(doc: DocRow, mode: ClaimMode, now: Date): Promise<DocRow | null>;
  /** Writes type only while type_source is not 'manual'. Returns false if a person set it. */
  setDocumentType(id: string, type: DocumentType, source: "rule" | "auto", confidence: string): Promise<boolean>;
  documentType(id: string): Promise<{ type: DocumentType; type_source: string } | null>;
  updateDocument(id: string, patch: Record<string, unknown>, onlyIfStatus?: ProcessingStatus): Promise<void>;
  download(path: string): Promise<Uint8Array | null>;
  // settings and logs
  automations(): Promise<{ autoSort: boolean; autoFill: boolean }>;
  aiCallsToday(dealId: string): Promise<number>;
  logAiUsage(row: AiUsageRow): Promise<void>;
  timeline(dealId: string, description: string, metadata: Record<string, unknown>): Promise<void>;
  // income
  incomeSources(dealId: string): Promise<SourceForMatch[]>;
  createPrimarySource(dealId: string, employer: string | null): Promise<SourceForMatch | null>;
  extractionPayDate(documentId: string): Promise<string | null>;
  saveExtraction(row: Record<string, unknown>): Promise<void>;
  /** Writes only while calc_locked is false and the source is not verified. */
  updateIncomeSource(id: string, patch: Record<string, unknown>): Promise<boolean>;
}

// ---------------------------------------------------------------- the request
export interface ProcessRequest {
  ids: string[];
  force: boolean;
  background: boolean;
  retryDue: boolean;
}

export function parseProcessRequest(
  body: unknown,
  who: { internal: boolean; isStaff: boolean },
): ProcessRequest | { status: number; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { status: 400, error: "Invalid request" };
  const b = body as Record<string, unknown>;
  const force = b.force === true;
  const background = b.background === true;
  if (b.retryDue === true) {
    if (!who.internal) return { status: 403, error: "Not allowed" };
    return { ids: [], force: false, background: true, retryDue: true };
  }
  const raw = [...(Array.isArray(b.documentIds) ? b.documentIds : []), ...(b.documentId != null ? [b.documentId] : [])];
  if (!raw.length) return { status: 400, error: "documentId or documentIds is required" };
  if (!raw.every(isUuid)) return { status: 400, error: "Invalid document id" };
  const ids = [...new Set(raw.map((s) => s.toLowerCase()))];
  if (ids.length > MAX_DOCS_PER_CALL) {
    return { status: 400, error: `Send at most ${MAX_DOCS_PER_CALL} documents per request` };
  }
  if (force && !who.isStaff) return { status: 403, error: "Only staff can re-read a processed document" };
  return { ids, force, background, retryDue: false };
}

/** PostgREST filter for documents the retry run should pick up (values quoted: they hold ':' and '.'). */
export function retryDueFilter(now: Date): string {
  const at = (minutesAgo: number) => `"${new Date(now.getTime() - minutesAgo * 60_000).toISOString()}"`;
  return [
    `and(processing_status.eq.failed,next_attempt_at.lte.${at(0)},attempt_count.lt.${MAX_ATTEMPTS})`,
    `and(processing_status.eq.pending,created_at.lt.${at(PENDING_GRACE_MIN)})`,
    `and(processing_status.eq.processing,processing_started_at.lt.${at(STALE_PROCESSING_MIN)})`,
  ].join(",");
}

// ---------------------------------------------------------------- claiming
export function claimableStatuses(mode: ClaimMode): ProcessingStatus[] {
  if (mode === "stale") return ["processing"];
  if (mode === "force") return ["pending", "failed", "done", "skipped", "manual"];
  return ["pending", "failed"];
}

export function isStale(doc: DocRow, now: Date): boolean {
  if (doc.processing_status !== "processing") return false;
  if (!doc.processing_started_at) return true;
  return now.getTime() - new Date(doc.processing_started_at).getTime() > STALE_PROCESSING_MIN * 60_000;
}

export function canClaim(doc: DocRow, mode: ClaimMode, now: Date): boolean {
  if (!claimableStatuses(mode).includes(doc.processing_status)) return false;
  if (mode === "stale") return isStale(doc, now) && doc.attempt_count < MAX_ATTEMPTS;
  if (mode === "normal") return doc.attempt_count < MAX_ATTEMPTS;
  return true;
}

export function claimPatch(doc: DocRow, now: Date): Record<string, unknown> {
  return {
    processing_status: "processing",
    processing_started_at: now.toISOString(),
    attempt_count: doc.attempt_count + 1,
    processing_error: null,
    next_attempt_at: null,
  };
}

export interface Skipped { id: string; status: string; type: DocumentType }

/**
 * Claims what can be claimed; everything else is reported unchanged. A document stuck in
 * "processing" with no attempts left is closed as failed instead of being retried again.
 */
export async function claimAll(
  repo: Repo,
  docs: DocRow[],
  opts: { force: boolean; retryDue: boolean },
  now: Date,
): Promise<{ claimed: DocRow[]; skipped: Skipped[] }> {
  const claimed: DocRow[] = [];
  const skipped: Skipped[] = [];
  for (const doc of docs) {
    const skip = (status: string = doc.processing_status) => skipped.push({ id: doc.id, status, type: doc.type });
    let mode: ClaimMode = opts.force ? "force" : "normal";
    if (opts.retryDue && doc.processing_status === "processing") {
      if (!isStale(doc, now)) { skip(); continue; }
      if (doc.attempt_count >= MAX_ATTEMPTS) {
        await repo.updateDocument(doc.id, {
          processing_status: "failed", processing_error: MESSAGES.failed, next_attempt_at: null, processed_at: now.toISOString(),
        }, "processing");
        skip("failed");
        continue;
      }
      mode = "stale";
    }
    if (!canClaim(doc, mode, now)) { skip(); continue; }
    const row = await repo.claimDocument(doc, mode, now);
    if (row) claimed.push(row); else skip();
  }
  return { claimed, skipped };
}

// ---------------------------------------------------------------- failure handling
export function backoffMinutes(attemptCount: number): number | null {
  if (attemptCount >= MAX_ATTEMPTS) return null;
  return BACKOFF_MINUTES[Math.min(Math.max(attemptCount, 1), BACKOFF_MINUTES.length) - 1];
}

/** Rate limit, credits, timeout and other passing AI trouble: retry later. Anything else: staff. */
export function failurePatch(e: unknown, attemptCount: number, now: Date): Record<string, unknown> {
  let message: string = MESSAGES.failed;
  let next: string | null = null;
  if (isTransientAiError(e)) {
    const wait = backoffMinutes(attemptCount);
    if (wait != null) {
      message = MESSAGES.retrying;
      next = new Date(now.getTime() + wait * 60_000).toISOString();
    }
  }
  return { processing_status: "failed", processing_error: message, next_attempt_at: next, processed_at: now.toISOString() };
}

// ---------------------------------------------------------------- processing
export interface RunContext {
  ai: AiConfig | null;
  callAi?: (cfg: AiConfig, opts: JsonCallOptions) => Promise<JsonCallResult>;
  userId: string | null;
  /** staff "force" re-reads skip the per-deal daily cap */
  bypassCap: boolean;
  maxAiCallsPerDay: number;
  now?: () => Date;
}

export interface DocResult {
  id: string;
  status: ProcessingStatus;
  type?: DocumentType;
  autoFilled?: boolean;
}

/** Processes one claimed document; never throws, so one document can't stop the others. */
export async function processClaimed(repo: Repo, doc: DocRow, ctx: RunContext): Promise<DocResult> {
  const now = ctx.now ?? (() => new Date());
  try {
    return await processDocument(repo, doc, ctx);
  } catch (e) {
    if (!(e instanceof AiError)) console.error("process-document", doc.id, e instanceof Error ? e.message : String(e));
    try {
      await repo.updateDocument(doc.id, failurePatch(e, doc.attempt_count, now()), "processing");
    } catch (e2) {
      console.error("process-document: could not record failure", doc.id, e2 instanceof Error ? e2.message : String(e2));
    }
    return { id: doc.id, status: "failed" };
  }
}

/** Runs documents with limited concurrency; each one independent of the others. */
export async function processAll(repo: Repo, docs: DocRow[], ctx: RunContext, concurrency = 2): Promise<DocResult[]> {
  const results: DocResult[] = new Array(docs.length);
  let next = 0;
  const worker = async () => {
    while (next < docs.length) {
      const i = next++;
      results[i] = await processClaimed(repo, docs[i], ctx);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, docs.length) }, worker));
  return results;
}

async function processDocument(repo: Repo, doc: DocRow, ctx: RunContext): Promise<DocResult> {
  const now = ctx.now ?? (() => new Date());
  const { autoSort, autoFill } = await repo.automations();
  const manual = doc.type_source === "manual";
  let type: DocumentType = doc.type;

  // ---- 1. free pass: the file name. Saved now, so a failed AI call can't lose it.
  const byName = autoSort && !manual ? classifyByFilename(doc.name) : null;
  if (byName) {
    if (await repo.setDocumentType(doc.id, byName, "rule", "high")) {
      if (byName !== doc.type) {
        await repo.timeline(doc.deal_id, `Auto-sorted "${doc.name}" as ${LABEL[byName]}`,
          { automation: "auto_sort", document_id: doc.id, type: byName, by: "file name", confidence: "high" });
      }
      type = byName;
    } else {
      type = (await repo.documentType(doc.id))?.type ?? type;
    }
  }

  // ---- 2. AI read, only if the name wasn't enough or there is income to read
  const sortWithAi = autoSort && !manual && !byName;
  const wantAi = sortWithAi || (autoFill && INCOME_TYPES.includes(type));
  const finish = (status: ProcessingStatus, extra: Record<string, unknown> = {}) =>
    repo.updateDocument(doc.id, {
      processing_status: status, processing_error: null, next_attempt_at: null, processed_at: now().toISOString(), ...extra,
    }, "processing");

  if (!wantAi) {
    await finish("done");
    return { id: doc.id, status: "done", type };
  }
  if (!ctx.ai) {
    await finish("skipped", { processing_error: MESSAGES.notConfigured });
    return { id: doc.id, status: "skipped", type };
  }
  let used = 0;
  if (!ctx.bypassCap) {
    used = await repo.aiCallsToday(doc.deal_id);
    if (used >= ctx.maxAiCallsPerDay) {
      await finish("failed", { processing_error: MESSAGES.dailyCap });
      return { id: doc.id, status: "failed", type };
    }
  }

  const content = await documentContent(repo, doc);
  if (!content) {
    await finish("done"); // nothing the AI can read (e.g. a Word file); staff sort it
    return { id: doc.id, status: "done", type };
  }

  const knownType = sortWithAi ? null : type;
  const purpose = knownType && INCOME_TYPES.includes(knownType) ? "extract" : "classify";
  const allowEscalation = ctx.bypassCap || used + 1 < ctx.maxAiCallsPerDay;
  const { reading, model } = await readDocument(repo, ctx, doc, content, knownType, purpose, allowEscalation);

  if (sortWithAi && reading.type_confidence !== "low") {
    if (await repo.setDocumentType(doc.id, reading.document_type, "auto", reading.type_confidence)
        && reading.document_type !== doc.type) {
      await repo.timeline(doc.deal_id, `Auto-sorted "${doc.name}" as ${LABEL[reading.document_type]}`,
        { automation: "auto_sort", document_id: doc.id, type: reading.document_type, by: model, confidence: reading.type_confidence });
    }
  }
  type = (await repo.documentType(doc.id))?.type ?? type;

  // ---- 3. income auto-fill
  let autoFilled = false;
  if (reading.income && INCOME_TYPES.includes(type)) {
    autoFilled = await fillIncome(repo, doc, reading, model, autoFill, now());
  }

  // ---- 4. done → the database re-checks the deal (requests + routing)
  await finish("done", { ai_model: model });
  return { id: doc.id, status: "done", type, autoFilled };
}

/**
 * First pass on the main chain. A failed request is a failure (retried later), never a reason
 * to escalate. Only an unsure answer is re-read once on the escalation chain; if that re-read
 * fails, the first answer stands.
 */
async function readDocument(
  repo: Repo, ctx: RunContext, doc: DocRow, content: { parts: ContentPart[]; hasPdf: boolean },
  knownType: DocumentType | null, purpose: "classify" | "extract", allowEscalation: boolean,
): Promise<{ reading: DocumentReading; model: string; escalated: boolean }> {
  const cfg = ctx.ai!;
  const call = ctx.callAi ?? callJson;
  const log = (p: AiUsageRow["purpose"]) => (a: AiAttempt) =>
    repo.logAiUsage(usageRow({ deal_id: doc.deal_id, document_id: doc.id, user_id: ctx.userId, purpose: p }, a));

  const first = await call(cfg, { system: SYSTEM_PROMPT, content: content.parts, hasPdf: content.hasPdf, onAttempt: log(purpose) });
  const reading = normalizeReading(first.data);
  if (!isUnsure(reading, knownType) || !cfg.escalationModels.length || !allowEscalation) {
    return { reading, model: first.model, escalated: false };
  }
  try {
    const second = await call(cfg, {
      system: SYSTEM_PROMPT, content: content.parts, hasPdf: content.hasPdf, models: cfg.escalationModels, onAttempt: log("escalate"),
    });
    return { reading: normalizeReading(second.data), model: second.model, escalated: true };
  } catch {
    return { reading, model: first.model, escalated: false };
  }
}

export async function documentContent(repo: Repo, doc: Pick<DocRow, "name" | "storage_path" | "file_url" | "preview_path" | "mime_type" | "file_size">): Promise<{ parts: ContentPart[]; hasPdf: boolean } | null> {
  const parts: ContentPart[] = [{ type: "text", text: userPrompt(doc.name) }];
  let hasPdf = false;
  const path = doc.storage_path ?? doc.file_url;
  const mime = doc.mime_type ?? guessMime(doc.name);

  if (doc.preview_path) {
    const preview = await repo.download(doc.preview_path);
    if (preview) parts.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${toBase64(preview)}` } });
  }
  if (mime.startsWith("image/") || mime === "application/pdf") {
    const file = doc.file_size <= MAX_AI_BYTES ? await repo.download(path) : null;
    if (file && mime.startsWith("image/")) {
      parts.push({ type: "image_url", image_url: { url: `data:${mime};base64,${toBase64(file)}` } });
    } else if (file) {
      hasPdf = true;
      parts.push({ type: "file", file: { filename: doc.name, file_data: `data:application/pdf;base64,${toBase64(file)}` } });
    }
  }
  return parts.length > 1 ? { parts, hasPdf } : null;
}

export function guessMime(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return ({ pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic" } as Record<string, string>)[ext]
    ?? "application/octet-stream";
}

/**
 * Stores the reading as evidence on the deal, then fills the matching income source unless an
 * analyst owns its figures (locked / verified) or the figures come from a newer document.
 */
async function fillIncome(
  repo: Repo, doc: DocRow, reading: DocumentReading, model: string | null, autoFill: boolean, now: Date,
): Promise<boolean> {
  const inc = reading.income!;
  const sources = await repo.incomeSources(doc.deal_id);
  let source = pickSource(inc.employer_name, sources);
  if (!source && autoFill && !sources.length) source = await repo.createPrimarySource(doc.deal_id, inc.employer_name);

  // the extraction itself is always stored (it feeds the analyst's click-to-fill panel)
  await repo.saveExtraction({
    deal_id: doc.deal_id, document_id: doc.id, income_source_id: source?.id ?? null,
    gross_pay: inc.gross_pay, net_pay: inc.net_pay, pay_frequency: inc.pay_frequency, pay_date: inc.pay_date,
    employer_name_on_doc: inc.employer_name, ytd_gross: inc.ytd_gross, confidence: inc.confidence,
    raw_extracted_text: reading.summary || null, extracted_at: now.toISOString(),
  });
  if (!autoFill || !source) return false;

  const currentDate = source.auto_fill_document_id && source.auto_fill_document_id !== doc.id
    ? await repo.extractionPayDate(source.auto_fill_document_id)
    : null;
  const blocked = fillBlockedBy(source, inc.pay_date ?? inc.period_end, currentDate);
  if (blocked) return false;

  const fill = computeAutoFill(inc, source, now);
  if (!fill) return false;

  const patch: Record<string, unknown> = {
    gross_per_period: fill.gross_per_period,
    pay_frequency: fill.pay_frequency,
    ytd_gross: fill.ytd_gross,
    ytd_months: fill.ytd_months,
    calc_method: fill.calc_method,
    calculated_monthly_income: fill.calculated_monthly_income,
    flag_reasons: fill.flags,
    verification_status: fill.verification_status,
    auto_filled_at: now.toISOString(),
    auto_fill_document_id: doc.id,
  };
  if (fill.benefit_percent != null) {
    patch.benefit_cap_applied = true;
    patch.tip_percentage = fill.benefit_percent;
  }
  if (!(await repo.updateIncomeSource(source.id, patch))) return false;

  const status = fill.verification_status;
  await repo.timeline(doc.deal_id,
    `Income auto-filled from "${doc.name}": ${METHOD_LABEL[fill.calc_method]} → $${fill.calculated_monthly_income.toLocaleString("en-CA")}/mo`
      + (fill.benefit_percent != null ? ` (benefit counted at ${fill.benefit_percent}%)` : "")
      + (status === "flagged" ? " (flagged)" : status === "needs_review" ? " (needs review)" : ""),
    { automation: "auto_fill_income", document_id: doc.id, income_source_id: source.id, method: fill.calc_method,
      mi: fill.mi, ytd: fill.ytd, ytd_months: fill.ytd_months, calculated: fill.calculated_monthly_income, flags: fill.flags, model });
  return true;
}
