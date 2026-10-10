// verify-employer — staff: quick plausibility check that an employer is a real, operating business.
// POST {employer, city?, state?, dealId?}. Every AI call is logged to ai_usage.
import { aiFailure, ERR, isUuid, parseOrigins, responder } from "../_shared/http.ts";
import { adminClient, getCaller, settings } from "../_shared/auth.ts";
import { aiConfigFromEnv, callJson } from "../_shared/ai.ts";
import { usageRow } from "../_shared/pipeline.ts";
import { supabaseRepo } from "../_shared/repo.ts";

const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\r\n"]+/g, " ").trim().slice(0, max) : "");

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
    const employer = text(body?.employer, 200);
    const city = text(body?.city, 100);
    const state = text(body?.state, 100);
    if (!employer) return http.error("Employer name is required", 400);

    const cfg = aiConfigFromEnv(get);
    if (!cfg) return http.error(ERR.aiNotConfigured, 503);

    const repo = supabaseRepo(admin);
    const where = city && state ? ` located in ${city}, ${state}` : "";
    const r = await callJson(cfg, {
      system: "You are a business verification assistant for a Canadian auto lender. Reply with ONE JSON object only.",
      content: [{
        type: "text",
        text: `Verify this employer: "${employer}"${where}. Is it a real, operating business?
Return {"verified": boolean, "confidence": "high|medium|low", "businessType": string, "yearsInOperation": string, "summary": "1-2 sentences"}.
If you are not sure the business exists, set verified false and confidence low.`,
      }],
      onAttempt: (a) => repo.logAiUsage(usageRow({
        deal_id: isUuid(body?.dealId) ? body.dealId : null, document_id: null, user_id: caller.userId, purpose: "verify_employer",
      }, a)),
    });
    const d = r.data;
    const confidence = ["high", "medium", "low"].includes(String(d.confidence)) ? String(d.confidence) : "low";
    return http.json({
      verified: d.verified === true,
      confidence,
      businessType: typeof d.businessType === "string" ? d.businessType.slice(0, 200) : undefined,
      yearsInOperation: typeof d.yearsInOperation === "string" ? d.yearsInOperation.slice(0, 100) : "Unknown",
      summary: typeof d.summary === "string" ? d.summary.slice(0, 600) : "",
      model: r.model,
    });
  } catch (e) {
    console.error("verify-employer", e instanceof Error ? e.message : String(e));
    const f = aiFailure(e);
    return http.error(f.message, f.status);
  }
});
