// process-document — runs on every uploaded document (dealer portal or staff):
//   1. auto-sort: name rules first (free), then one AI read when the name isn't enough
//   2. auto-fill income: reads pay stubs / statements and fills the matching income source
//      the way the analyst's calculator would (MI, YTD, Lower of) with the same review flags
//   3. marks the document processed → the database re-checks the deal's checklist,
//      closes or opens dealer requests, and routes the deal (see the SQL triggers)
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, json, toBase64 } from "../_shared/http.ts";
import { AiError, aiConfigFromEnv, callJson, type AiConfig, type ContentPart } from "../_shared/ai.ts";
import {
  classifyByFilename, INCOME_TYPES, isUnsure, needsAi, normalizeReading, SYSTEM_PROMPT, userPrompt,
  type DocumentReading, type DocumentType,
} from "../_shared/classify.ts";
import { computeAutoFill, METHOD_LABEL, pickSource, type SourceForMatch } from "../_shared/income.ts";

const MAX_AI_BYTES = 8 * 1024 * 1024;
const LABEL: Record<DocumentType, string> = {
  credit_application: "Credit Application", income_verification: "Income Verification", pay_stub: "Pay Stub",
  bank_statement: "Bank Statement", vehicle_invoice: "Vehicle Invoice", trade_in: "Trade-In Documentation",
  insurance: "Insurance Proof", id_verification: "ID Verification", other: "Other",
};

type Doc = {
  id: string; deal_id: string; name: string; type: DocumentType; type_source: string; processing_status: string;
  storage_path: string | null; file_url: string; preview_path: string | null; mime_type: string | null; file_size: number;
};

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  // ---- who is asking, and may they touch these documents?
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth } = await admin.auth.getUser(token);
  const user = auth?.user;
  if (!user) return json({ error: "Sign in required" }, 401);

  let body: { documentId?: string; documentIds?: string[]; force?: boolean; background?: boolean };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const ids = [...new Set([...(body.documentIds ?? []), ...(body.documentId ? [body.documentId] : [])])].slice(0, 25);
  if (!ids.length) return json({ error: "documentId or documentIds is required" }, 400);

  const { data: docsRaw } = await admin.from("documents")
    .select("id, deal_id, name, type, type_source, processing_status, storage_path, file_url, preview_path, mime_type, file_size")
    .in("id", ids);
  const docs: Doc[] = [];
  for (const d of (docsRaw ?? []) as Doc[]) {
    if (await canAccess(admin, user.id, d.deal_id)) docs.push(d);
  }
  if (!docs.length) return json({ error: "Document not found" }, 404);
  const todo = docs.filter((d) => body.force || !["done", "processing"].includes(d.processing_status));
  if (!todo.length) return json({ results: docs.map((d) => ({ id: d.id, status: d.processing_status, type: d.type })) });

  await admin.from("documents").update({ processing_status: "processing", processing_error: null }).in("id", todo.map((d) => d.id));

  // one at a time: keeps well inside free-model rate limits
  const job = (async () => {
    const results = [];
    for (const doc of todo) results.push({ id: doc.id, ...(await runOne(admin, doc)) });
    return results;
  })();

  if (body.background && typeof EdgeRuntime !== "undefined") {
    EdgeRuntime.waitUntil(job);
    return json({ accepted: todo.map((d) => d.id) }, 202);
  }
  return json({ results: await job });
});

async function runOne(admin: SupabaseClient, doc: Doc) {
  try {
    return await processDocument(admin, doc);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("process-document", doc.id, message);
    await admin.from("documents").update({
      processing_status: "failed", processing_error: message.slice(0, 500), processed_at: new Date().toISOString(),
    }).eq("id", doc.id);
    return { status: "failed", error: message, retryable: e instanceof AiError && [429, 402, 502, 503].includes(e.status) };
  }
}

async function canAccess(admin: SupabaseClient, userId: string, dealId: string): Promise<boolean> {
  const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", userId);
  if ((roles ?? []).some((r: { role: string }) => r.role !== "dealer")) return true;
  const { data: link } = await admin.from("dealer_users").select("dealer_id").eq("user_id", userId).maybeSingle();
  if (!link) return false;
  const { data: deal } = await admin.from("deals").select("dealer_id").eq("id", dealId).maybeSingle();
  return !!deal && deal.dealer_id === link.dealer_id;
}

async function settings(admin: SupabaseClient) {
  const { data } = await admin.from("app_settings").select("automations").maybeSingle();
  const a = (data?.automations ?? {}) as Record<string, boolean>;
  return { autoSort: a.auto_sort !== false, autoFill: a.auto_fill_income !== false };
}

async function timeline(admin: SupabaseClient, dealId: string, description: string, metadata: Record<string, unknown>) {
  await admin.from("deal_timeline").insert({ deal_id: dealId, type: "automation", description, created_by: null, metadata });
}

async function processDocument(admin: SupabaseClient, doc: Doc) {
  const { autoSort, autoFill } = await settings(admin);
  const pickedByPerson = doc.type_source === "manual" && doc.type !== "other";

  // ---- 1. free pass: the file name
  let type: DocumentType = doc.type;
  let typeSource = doc.type_source;
  let confidence: string | null = null;
  if (!pickedByPerson && autoSort) {
    const byName = classifyByFilename(doc.name);
    if (byName) { type = byName; typeSource = "rule"; confidence = "high"; }
  }

  // ---- 2. AI read, only if the name wasn't enough or there is income to read
  const cfg = aiConfigFromEnv((k) => Deno.env.get(k));
  let reading: DocumentReading | null = null;
  let model: string | null = null;
  const wantAi = (autoSort && !pickedByPerson && type === "other") || (autoFill && needsAi(type, true) && type !== "other");
  if (wantAi && cfg) {
    const content = await documentContent(admin, doc);
    if (content) {
      ({ reading, model } = await readDocument(cfg, content.parts, content.hasPdf, doc.name));
      if (autoSort && !pickedByPerson && reading.type_confidence !== "low") {
        type = reading.document_type;
        typeSource = "auto";
        confidence = reading.type_confidence;
      }
    }
  }

  const changed = type !== doc.type;
  await admin.from("documents").update({
    type, type_source: typeSource, classification_confidence: confidence ?? undefined, ai_model: model ?? undefined,
  }).eq("id", doc.id);
  if (changed) {
    await timeline(admin, doc.deal_id, `Auto-sorted "${doc.name}" as ${LABEL[type]}`,
      { automation: "auto_sort", document_id: doc.id, type, by: typeSource === "rule" ? "file name" : model, confidence });
  }

  // ---- 3. income auto-fill
  let autoFilled: Record<string, unknown> | null = null;
  if (reading?.income && INCOME_TYPES.includes(type)) {
    autoFilled = await fillIncome(admin, doc, reading, model, autoFill);
  }

  // ---- 4. done → database re-checks the deal (requests + routing)
  const status = wantAi && !cfg ? "skipped" : "done";
  await admin.from("documents").update({
    processing_status: status,
    processing_error: status === "skipped" ? "AI is not configured (set OPENROUTER_API_KEY)" : null,
    processed_at: new Date().toISOString(),
  }).eq("id", doc.id);

  return { status, type, typeSource, model, autoFilled };
}

async function documentContent(admin: SupabaseClient, doc: Doc): Promise<{ parts: ContentPart[]; hasPdf: boolean } | null> {
  const parts: ContentPart[] = [{ type: "text", text: userPrompt(doc.name) }];
  let hasPdf = false;
  const path = doc.storage_path ?? doc.file_url;
  const mime = doc.mime_type ?? guessMime(doc.name);

  if (doc.preview_path) {
    const preview = await download(admin, doc.preview_path);
    if (preview) parts.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${toBase64(preview)}` } });
  }
  if (mime.startsWith("image/") || mime === "application/pdf") {
    const file = doc.file_size <= MAX_AI_BYTES ? await download(admin, path) : null;
    if (file && mime.startsWith("image/")) {
      parts.push({ type: "image_url", image_url: { url: `data:${mime};base64,${toBase64(file)}` } });
    } else if (file) {
      hasPdf = true;
      parts.push({ type: "file", file: { filename: doc.name, file_data: `data:application/pdf;base64,${toBase64(file)}` } });
    }
  }
  return parts.length > 1 ? { parts, hasPdf } : null;
}

async function download(admin: SupabaseClient, path: string): Promise<Uint8Array | null> {
  const clean = path.replace(/^documents\//, "");
  const { data, error } = await admin.storage.from("documents").download(clean);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}

function guessMime(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return ({ pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic" } as Record<string, string>)[ext]
    ?? "application/octet-stream";
}

/** First pass on the main chain; one re-read on the escalation chain if the first pass is unsure. */
async function readDocument(cfg: AiConfig, parts: ContentPart[], hasPdf: boolean, name: string) {
  let first: { reading: DocumentReading; model: string } | null = null;
  try {
    const r = await callJson(cfg, { system: SYSTEM_PROMPT, content: parts, hasPdf });
    first = { reading: normalizeReading(r.data), model: r.model };
    if (!isUnsure(first.reading) || !cfg.escalationModels.length) return first;
  } catch (e) {
    if (!cfg.escalationModels.length) throw e;
    console.warn("process-document: main chain failed, escalating", name, e instanceof Error ? e.message : e);
  }
  try {
    const r = await callJson(cfg, { system: SYSTEM_PROMPT, content: parts, hasPdf, models: cfg.escalationModels });
    return { reading: normalizeReading(r.data), model: r.model };
  } catch (e) {
    if (first) return first; // keep the first answer if the re-read is unavailable
    throw e;
  }
}

async function fillIncome(admin: SupabaseClient, doc: Doc, reading: DocumentReading, model: string | null, autoFill: boolean) {
  const inc = reading.income!;
  const { data: deal } = await admin.from("deals").select("id, customer_id, customers(monthly_income)").eq("id", doc.deal_id).single();
  const { data: sourcesRaw } = await admin.from("income_sources")
    .select("id, employer_name, is_primary, verification_status, stated_monthly_income, flag_reasons")
    .eq("deal_id", doc.deal_id);
  const sources = (sourcesRaw ?? []) as SourceForMatch[];

  let source = pickSource(inc.employer_name, sources);
  if (!source && autoFill && !sources.length) {
    const customer = (deal as { customers?: { monthly_income?: number | null } | null } | null)?.customers;
    const stated = Number(customer?.monthly_income ?? 0) || 0;
    const { data: created } = await admin.from("income_sources").insert({
      deal_id: doc.deal_id, customer_id: deal!.customer_id, source_type: "salaried",
      employer_name: inc.employer_name ?? "Employer on document", stated_monthly_income: stated,
      is_primary: true, verification_status: "unverified", calc_method: "mi",
    }).select("id, employer_name, is_primary, verification_status, stated_monthly_income, flag_reasons").single();
    source = created as SourceForMatch;
  }

  // the extraction itself is always stored (it feeds the analyst's click-to-fill panel)
  await admin.from("extracted_income_data").upsert({
    deal_id: doc.deal_id, document_id: doc.id, income_source_id: source?.id ?? null,
    gross_pay: inc.gross_pay, net_pay: inc.net_pay, pay_frequency: inc.pay_frequency, pay_date: inc.pay_date,
    employer_name_on_doc: inc.employer_name, ytd_gross: inc.ytd_gross, confidence: inc.confidence,
    raw_extracted_text: reading.summary || null, extracted_at: new Date().toISOString(),
  }, { onConflict: "document_id" });

  if (!autoFill || !source || source.verification_status === "verified") return null;
  const fill = computeAutoFill(inc, source);
  if (!fill) return null;

  await admin.from("income_sources").update({
    gross_per_period: fill.gross_per_period,
    pay_frequency: fill.pay_frequency,
    ytd_gross: fill.ytd_gross,
    ytd_months: fill.ytd_months,
    calc_method: fill.calc_method,
    calculated_monthly_income: fill.calculated_monthly_income,
    flag_reasons: fill.flags,
    verification_status: fill.verification_status,
    auto_filled_at: new Date().toISOString(),
    auto_fill_document_id: doc.id,
  }).eq("id", source.id);

  await timeline(admin, doc.deal_id,
    `Income auto-filled from "${doc.name}": ${METHOD_LABEL[fill.calc_method]} → $${fill.calculated_monthly_income.toLocaleString("en-CA")}/mo`
      + (fill.verification_status !== "unverified" ? ` (${fill.verification_status === "flagged" ? "flagged" : "needs review"})` : ""),
    { automation: "auto_fill_income", document_id: doc.id, income_source_id: source.id, method: fill.calc_method,
      mi: fill.mi, ytd: fill.ytd, calculated: fill.calculated_monthly_income, flags: fill.flags, model });
  return { sourceId: source.id, ...fill };
}
