import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  corsHeaders,
  fetchWithRetry,
  isIsoDate,
  isSafeHttpsUrl,
  jsonResponse,
  requireUser,
} from "../_shared/auth.ts";

const ALLOWED_MIME = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
const MAX_BASE64_CHARS = 8_000_000;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders(req) });
  }

  if (req.method !== "POST") {
    return jsonResponse(req, { error: "Method not allowed" }, 405);
  }

  const { user, error: authError } = await requireUser(req);
  if (!user) {
    return jsonResponse(req, { error: authError ?? "Unauthorized" }, 401);
  }

  try {
    const body = await req.json();
    const imageBase64 = typeof body?.imageBase64 === "string" ? body.imageBase64 : "";
    const imageUrl = body?.imageUrl;
    const mimeType = typeof body?.mimeType === "string" ? body.mimeType : "image/jpeg";

    if (!imageBase64 && !imageUrl) {
      return jsonResponse(req, { error: "Either imageBase64 or imageUrl is required" }, 400);
    }
    if (imageBase64 && imageBase64.length > MAX_BASE64_CHARS) {
      return jsonResponse(req, { error: "Image payload is too large" }, 400);
    }
    if (imageBase64 && !ALLOWED_MIME.has(mimeType)) {
      return jsonResponse(req, { error: "Unsupported image type" }, 400);
    }
    if (imageUrl && !isSafeHttpsUrl(imageUrl)) {
      return jsonResponse(req, { error: "imageUrl must be a public https URL" }, 400);
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const imagePart = imageBase64
      ? {
          type: "image_url" as const,
          image_url: {
            url: `data:${mimeType};base64,${imageBase64}`,
          },
        }
      : {
          type: "image_url" as const,
          image_url: { url: imageUrl },
        };

    const response = await fetchWithRetry("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content: `You are an income document data extraction assistant. You analyze images of pay stubs, bank statements, and other income documents. Extract financial data accurately. If you cannot read a value clearly, indicate low confidence. Extract all visible monetary amounts.`,
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Extract the income data from this document image. Look for gross pay, net pay, pay frequency, pay date, employer name, and any YTD totals. Also extract the full visible text for audit purposes. pay_date must be YYYY-MM-DD or omitted.",
              },
              imagePart,
            ],
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "extract_income_data",
              description: "Return structured income data extracted from the document image",
              parameters: {
                type: "object",
                properties: {
                  gross_pay: {
                    type: "number",
                    description: "Gross pay amount for the pay period. Null if not found.",
                  },
                  net_pay: {
                    type: "number",
                    description: "Net pay (take-home) amount for the pay period. Null if not found.",
                  },
                  pay_frequency: {
                    type: "string",
                    enum: ["weekly", "biweekly", "semimonthly", "monthly"],
                    description: "How often the person is paid, inferred from the document",
                  },
                  pay_date: {
                    type: "string",
                    description: "Pay date in YYYY-MM-DD format if visible",
                  },
                  employer_name: {
                    type: "string",
                    description: "Employer/company name as printed on the document",
                  },
                  ytd_gross: {
                    type: "number",
                    description: "Year-to-date gross earnings if visible. Null if not found.",
                  },
                  raw_text: {
                    type: "string",
                    description: "Full extracted text from the document for audit trail",
                  },
                  confidence: {
                    type: "string",
                    enum: ["high", "medium", "low"],
                    description: "Overall confidence in the extraction accuracy",
                  },
                },
                required: ["confidence", "raw_text"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "extract_income_data" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return jsonResponse(req, { error: "Rate limit exceeded, please try again later." }, 429);
      }
      if (response.status === 402) {
        return jsonResponse(req, { error: "Payment required, please add credits." }, 402);
      }
      const text = await response.text();
      console.error("AI gateway error:", response.status, text);
      throw new Error("AI gateway error");
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];

    if (!toolCall) {
      throw new Error("No tool call in AI response");
    }

    const result = JSON.parse(toolCall.function.arguments);
    if (result.pay_date && !isIsoDate(result.pay_date)) {
      result.pay_date = null;
    }

    return jsonResponse(req, result);
  } catch (e) {
    console.error("extract-income-data error:", e);
    return jsonResponse(
      req,
      { error: e instanceof Error ? e.message : "Unknown error" },
      500,
    );
  }
});
