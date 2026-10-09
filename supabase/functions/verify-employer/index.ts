// verify-employer — quick plausibility check that an employer is a real, operating business.
import { corsHeaders, json } from "../_shared/http.ts";
import { aiConfig, requireStaff } from "../_shared/auth.ts";
import { AiError, callJson } from "../_shared/ai.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const staff = await requireStaff(req);
  if (staff instanceof Response) return new Response(staff.body, { status: staff.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const { employer, city, state } = await req.json();
    if (!employer) return json({ error: "Employer name is required" }, 400);
    const cfg = await aiConfig(staff.admin);
    if (!cfg) return json({ error: "AI is not configured (OPENROUTER_API_KEY is not set)" }, 503);

    const where = city && state ? ` located in ${city}, ${state}` : "";
    const r = await callJson(cfg, {
      system: "You are a business verification assistant for a Canadian auto lender. Reply with ONE JSON object only.",
      content: [{
        type: "text",
        text: `Verify this employer: "${String(employer).slice(0, 200)}"${where}. Is it a real, operating business?
Return {"verified": boolean, "confidence": "high|medium|low", "businessType": string, "yearsInOperation": string, "summary": "1-2 sentences"}.
If you are not sure the business exists, set verified false and confidence low.`,
      }],
      maxTokens: 400,
    });
    const d = r.data;
    const confidence = ["high", "medium", "low"].includes(String(d.confidence)) ? String(d.confidence) : "low";
    return json({
      verified: d.verified === true,
      confidence,
      businessType: typeof d.businessType === "string" ? d.businessType : undefined,
      yearsInOperation: typeof d.yearsInOperation === "string" ? d.yearsInOperation : "Unknown",
      summary: typeof d.summary === "string" ? d.summary : "",
      model: r.model,
    });
  } catch (e) {
    console.error("verify-employer error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, e instanceof AiError ? e.status : 500);
  }
});
