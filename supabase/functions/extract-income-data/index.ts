// extract-income-data — staff: read the income figures from one stored document.
// POST {documentId}. Only documents the caller can see (row-level security) are read; files
// are taken from storage, never from a caller-supplied URL or upload. Uploads are processed
// automatically by process-document; this is for a manual re-read.
import { aiFailure, ERR, isUuid, parseOrigins, responder } from "../_shared/http.ts";
import { adminClient, getCaller, settings, userClient } from "../_shared/auth.ts";
import { aiConfigFromEnv, callJson } from "../_shared/ai.ts";
import { normalizeReading, SYSTEM_PROMPT } from "../_shared/classify.ts";
import { DOC_COLUMNS, type DocRow, documentContent, usageRow } from "../_shared/pipeline.ts";
import { supabaseRepo } from "../_shared/repo.ts";

Deno.serve(async (req) => {
  const admin = adminClient();
  const get = await settings(admin);
  const http = responder(req, parseOrigins(get("ALLOWED_ORIGINS")));
  if (req.method === "OPTIONS") return http.preflight();
  if (!http.originOk) return http.error(ERR.origin, 403);
  if (req.method !== "POST") return http.error(ERR.method, 405);

  try {
    const caller = await getCaller(admin, req);
    if (!caller) return http.error(ERR.signIn, 401);
    if (!caller.isStaff) return http.error(ERR.forbidden, 403);

    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return http.error(ERR.badRequest, 400); }
    const documentId = body?.documentId;
    if (!isUuid(documentId)) return http.error("documentId is required", 400);

    // visible to this user? (row-level security decides)
    const { data: visible } = await userClient(req).from("documents").select("id").eq("id", documentId).maybeSingle();
    if (!visible) return http.error(ERR.notFound, 404);
    const { data: doc } = await admin.from("documents").select(DOC_COLUMNS).eq("id", documentId).maybeSingle();
    if (!doc) return http.error(ERR.notFound, 404);
    const d = doc as unknown as DocRow;

    const cfg = aiConfigFromEnv(get);
    if (!cfg) return http.error(ERR.aiNotConfigured, 503);

    const repo = supabaseRepo(admin);
    const content = await documentContent(repo, d);
    if (!content) return http.error("This file can't be read automatically", 422);

    const r = await callJson(cfg, {
      system: SYSTEM_PROMPT, content: content.parts, hasPdf: content.hasPdf,
      onAttempt: (a) => repo.logAiUsage(usageRow({ deal_id: d.deal_id, document_id: d.id, user_id: caller.userId, purpose: "extract" }, a)),
    });
    const reading = normalizeReading(r.data);
    const inc = reading.income;
    // response shape kept compatible with the original function
    return http.json({
      gross_pay: inc?.gross_pay ?? null,
      net_pay: inc?.net_pay ?? null,
      pay_frequency: inc?.pay_frequency ?? null,
      pay_date: inc?.pay_date ?? null,
      period_end: inc?.period_end ?? null,
      employer_name: inc?.employer_name ?? null,
      ytd_gross: inc?.ytd_gross ?? null,
      raw_text: reading.summary,
      confidence: inc?.confidence ?? "low",
      document_type: reading.document_type,
      model: r.model,
    });
  } catch (e) {
    console.error("extract-income-data", e instanceof Error ? e.message : String(e));
    const f = aiFailure(e);
    return http.error(f.message, f.status);
  }
});
