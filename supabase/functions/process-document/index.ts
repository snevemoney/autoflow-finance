// process-document — runs on every uploaded document (dealer portal or staff), and on the
// database cron's retry runs:
//   1. auto-sort: name rules first (free, saved at once), then one AI read when the name isn't enough
//   2. auto-fill income: reads pay stubs / statements and fills the matching income source
//      the way the analyst's calculator would (MI, YTD, Lower of) with the same review flags
//   3. marks the document processed → the database re-checks the deal's checklist,
//      closes or opens dealer requests, and routes the deal (see the SQL triggers)
//
// Callers:
//   signed-in staff or the owning dealer: {documentIds: [...≤5], background?: true, force?: true (staff only)}
//   the database cron (header x-autoflow-internal): {retryDue: true} → up to 10 documents that are due
import { ERR, parseOrigins, responder } from "../_shared/http.ts";
import { adminClient, getCaller, isInternalCall, maxAiCallsPerDealDay, settings, userClient } from "../_shared/auth.ts";
import { aiConfigFromEnv } from "../_shared/ai.ts";
import { claimAll, parseProcessRequest, processAll, RETRY_BATCH, type DocRow } from "../_shared/pipeline.ts";
import { supabaseRepo } from "../_shared/repo.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

Deno.serve(async (req) => {
  const admin = adminClient();
  const get = await settings(admin);
  const http = responder(req, parseOrigins(get("ALLOWED_ORIGINS")));
  if (req.method === "OPTIONS") return http.preflight();
  if (!http.originOk) return http.error(ERR.origin, 403);
  if (req.method !== "POST") return http.error(ERR.method, 405);

  try {
    // ---- who is asking?
    const internalHeader = req.headers.get("x-autoflow-internal");
    const internal = internalHeader != null;
    if (internal && !(await isInternalCall(admin, internalHeader))) return http.error(ERR.forbidden, 401);
    const caller = internal ? null : await getCaller(admin, req);
    if (!internal && !caller) return http.error(ERR.signIn, 401);

    let body: unknown;
    try { body = await req.json(); } catch { return http.error(ERR.badRequest, 400); }
    const parsed = parseProcessRequest(body, { internal, isStaff: !!caller?.isStaff });
    if ("error" in parsed) return http.error(parsed.error, parsed.status);

    const repo = supabaseRepo(admin);
    const now = new Date();

    // ---- which documents? Signed-in callers only get what row-level security lets them see.
    let docs: DocRow[];
    if (parsed.retryDue) {
      docs = await repo.dueDocuments(now, RETRY_BATCH);
    } else {
      let ids = parsed.ids;
      if (!internal) {
        const { data, error } = await userClient(req).from("documents").select("id").in("id", ids);
        ids = error ? [] : (data ?? []).map((d: { id: string }) => d.id);
      }
      docs = await repo.documentsByIds(ids);
      if (!docs.length) return http.error(ERR.notFound, 404);
    }

    const { claimed, skipped } = await claimAll(repo, docs, { force: parsed.force, retryDue: parsed.retryDue }, now);
    const ctx = {
      ai: aiConfigFromEnv(get),
      userId: caller?.userId ?? null,
      bypassCap: parsed.force && !!caller?.isStaff,
      maxAiCallsPerDay: maxAiCallsPerDealDay(get),
    };
    const job = processAll(repo, claimed, ctx);

    if (parsed.background && typeof EdgeRuntime !== "undefined") {
      EdgeRuntime.waitUntil(job.catch((e) => console.error("process-document background", e instanceof Error ? e.message : e)));
      return http.json({ accepted: claimed.map((d) => d.id), skipped }, 202);
    }
    return http.json({ results: [...(await job), ...skipped] });
  } catch (e) {
    console.error("process-document", e instanceof Error ? e.message : String(e));
    return http.error(ERR.server, 500);
  }
});
