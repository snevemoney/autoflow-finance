import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { imageBase64, imageUrl, mimeType } = await req.json();

    if (!imageBase64 && !imageUrl) {
      return new Response(
        JSON.stringify({ error: "Either imageBase64 or imageUrl is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    // Build image content part for the vision model
    const imagePart = imageBase64
      ? {
          type: "image_url" as const,
          image_url: {
            url: `data:${mimeType || "image/jpeg"};base64,${imageBase64}`,
          },
        }
      : {
          type: "image_url" as const,
          image_url: { url: imageUrl },
        };

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
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
                text: "Extract the income data from this document image. Look for gross pay, net pay, pay frequency, pay date, employer name, and any YTD totals. Also extract the full visible text for audit purposes.",
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
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded, please try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Payment required, please add credits." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
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

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("extract-income-data error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
