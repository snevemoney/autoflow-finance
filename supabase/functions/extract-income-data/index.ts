// extract-income-data — read income figures from one pay stub / statement image or PDF.
// Kept for direct calls; uploads are processed automatically by process-document.
import { corsHeaders, json } from "../_shared/http.ts";
import { aiConfig, requireStaff } from "../_shared/auth.ts";
import { AiError, callJson, type ContentPart } from "../_shared/ai.ts";
import { normalizeReading, SYSTEM_PROMPT, userPrompt } from "../_shared/classify.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const staff = await requireStaff(req);
  if (staff instanceof Response) return new Response(staff.body, { status: staff.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const { imageBase64, imageUrl, mimeType, fileName } = await req.json();
    if (!imageBase64 && !imageUrl) return json({ error: "Either imageBase64 or imageUrl is required" }, 400);
    const cfg = await aiConfig(staff.admin);
    if (!cfg) return json({ error: "AI is not configured (OPENROUTER_API_KEY is not set)" }, 503);

    const mime = mimeType || "image/jpeg";
    const isPdf = mime === "application/pdf";
    const dataUrl = imageBase64 ? `data:${mime};base64,${imageBase64}` : imageUrl;
    const parts: ContentPart[] = [
      { type: "text", text: userPrompt(fileName ?? (isPdf ? "document.pdf" : "document.jpg")) },
      isPdf
        ? { type: "file", file: { filename: fileName ?? "document.pdf", file_data: dataUrl } }
        : { type: "image_url", image_url: { url: dataUrl } },
    ];
    const r = await callJson(cfg, { system: SYSTEM_PROMPT, content: parts, hasPdf: isPdf });
    const reading = normalizeReading(r.data);
    const inc = reading.income;
    // response shape kept compatible with the original function
    return json({
      gross_pay: inc?.gross_pay ?? null,
      net_pay: inc?.net_pay ?? null,
      pay_frequency: inc?.pay_frequency ?? null,
      pay_date: inc?.pay_date ?? null,
      employer_name: inc?.employer_name ?? null,
      ytd_gross: inc?.ytd_gross ?? null,
      raw_text: reading.summary,
      confidence: inc?.confidence ?? "low",
      document_type: reading.document_type,
      model: r.model,
    });
  } catch (e) {
    console.error("extract-income-data error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, e instanceof AiError ? e.status : 500);
  }
});
