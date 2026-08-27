import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  corsHeaders,
  fetchWithRetry,
  jsonResponse,
  requireUser,
} from "../_shared/auth.ts";

function asTrimmedString(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

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
    const employer = asTrimmedString(body?.employer, 200);
    const city = asTrimmedString(body?.city, 80);
    const state = asTrimmedString(body?.state, 40);

    if (!employer) {
      return jsonResponse(req, { error: "Employer name is required" }, 400);
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const locationContext = city && state ? ` located in ${city}, ${state}` : "";

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
            content: `You are a business verification assistant. When given an employer/business name and optional location, determine if the business likely exists and is legitimate. Respond using the provided tool.`,
          },
          {
            role: "user",
            content: `Verify this employer: "${employer}"${locationContext}. Is this a real, operating business?`,
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "employer_verification",
              description: "Return employer verification results",
              parameters: {
                type: "object",
                properties: {
                  verified: {
                    type: "boolean",
                    description: "Whether the employer appears to be a real, legitimate business",
                  },
                  confidence: {
                    type: "string",
                    enum: ["high", "medium", "low"],
                    description: "Confidence level of the verification",
                  },
                  businessType: {
                    type: "string",
                    description: "Type of business (e.g., Corporation, LLC, Healthcare Provider)",
                  },
                  yearsInOperation: {
                    type: "string",
                    description: "Estimated years in operation or 'Unknown'",
                  },
                  summary: {
                    type: "string",
                    description: "Brief 1-2 sentence summary about the business",
                  },
                },
                required: ["verified", "confidence", "summary"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "employer_verification" } },
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
    return jsonResponse(req, result);
  } catch (e) {
    console.error("verify-employer error:", e);
    return jsonResponse(
      req,
      { error: e instanceof Error ? e.message : "Unknown error" },
      500,
    );
  }
});
