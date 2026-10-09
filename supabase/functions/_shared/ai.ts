// One AI client for every automation. All models are reached through OpenRouter with a
// priority-ordered fallback chain (free models first, paid ones only if the free ones are
// unavailable). Everything is configured outside the code, so models can change freely:
//
//   OPENROUTER_API_KEY     required
//   AI_MODELS              comma-separated chain used for every document. OpenRouter takes
//                          3 models per request, so longer chains are sent 3 at a time.
//   AI_ESCALATION_MODELS   chain used to re-read a document the first pass was unsure about
//   AI_DATA_COLLECTION     "allow" (default) or "deny" — deny = only providers that don't keep data
//   AI_ZDR                 "true" to restrict to zero-data-retention endpoints
//   APP_URL                optional, sent to OpenRouter for attribution
//
// Each setting is read from the edge-function secrets first, then from Supabase Vault
// (see loadAiConfig), so it can be managed from either place.

export const AI_SETTING_KEYS = [
  "OPENROUTER_API_KEY", "AI_MODELS", "AI_ESCALATION_MODELS", "AI_DATA_COLLECTION", "AI_ZDR", "APP_URL",
] as const;

export const DEFAULT_MODELS = [
  "google/gemma-4-31b-it:free",
  "google/gemma-4-26b-a4b-it:free",
  "google/gemini-2.5-flash-lite",
];
export const DEFAULT_ESCALATION_MODELS = [
  "google/gemini-3.8-flash",
  "anthropic/claude-haiku-5.5",
];

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "file"; file: { filename: string; file_data: string } };

export interface AiConfig {
  apiKey: string;
  models: string[];
  escalationModels: string[];
  dataCollection: "allow" | "deny";
  zdr: boolean;
  appUrl?: string;
}

export class AiError extends Error {
  constructor(message: string, readonly status = 500) {
    super(message);
  }
}

const list = (v: string | undefined, fallback: string[]) => {
  const items = (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return items.length ? items : fallback;
};

export function aiConfigFromEnv(get: (key: string) => string | undefined): AiConfig | null {
  const apiKey = get("OPENROUTER_API_KEY");
  if (!apiKey) return null;
  return {
    apiKey,
    models: list(get("AI_MODELS"), DEFAULT_MODELS),
    escalationModels: list(get("AI_ESCALATION_MODELS"), DEFAULT_ESCALATION_MODELS),
    dataCollection: get("AI_DATA_COLLECTION") === "deny" ? "deny" : "allow",
    zdr: get("AI_ZDR") === "true",
    appUrl: get("APP_URL"),
  };
}

/** Reads the settings stored in Supabase Vault (service role only, via public.get_ai_settings). */
export type VaultReader = () => Promise<Record<string, string>>;

let vaultCache: { at: number; values: Record<string, string> } | null = null;
const VAULT_TTL_MS = 5 * 60_000;

/**
 * Settings come from the function secrets first; anything not set there is read from the
 * vault (cached for five minutes per function instance, so a vault change applies quickly).
 */
export async function loadAiConfig(env: (key: string) => string | undefined, readVault?: VaultReader): Promise<AiConfig | null> {
  let vault: Record<string, string> = {};
  const missing = AI_SETTING_KEYS.some((k) => !env(k));
  if (missing && readVault) {
    if (vaultCache && Date.now() - vaultCache.at < VAULT_TTL_MS) {
      vault = vaultCache.values;
    } else {
      try {
        vault = await readVault();
        vaultCache = { at: Date.now(), values: vault };
      } catch (e) {
        console.warn("AI settings: vault not readable", e instanceof Error ? e.message : e);
      }
    }
  }
  return aiConfigFromEnv((k) => env(k) || vault[k] || undefined);
}

/** For tests. */
export function clearAiConfigCache() {
  vaultCache = null;
}

/** Pull the first JSON object out of a model reply (handles ```json fences and chatter). */
export function parseJsonReply(text: string): Record<string, unknown> {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) throw new AiError("Model reply contained no JSON object", 502);
  const parsed = JSON.parse(candidate.slice(start, end + 1));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AiError("Model reply was not a JSON object", 502);
  }
  return parsed as Record<string, unknown>;
}

interface ChatResponse {
  model?: string;
  error?: { message?: string; code?: number | string };
  choices?: { message?: { content?: string | { text?: string }[] } }[];
}

export interface JsonCallOptions {
  system: string;
  content: ContentPart[];
  models?: string[];
  maxTokens?: number;
  /** PDFs are turned into text by OpenRouter's free parser before they reach the model. */
  hasPdf?: boolean;
  fetchImpl?: typeof fetch;
}

export interface JsonCallResult {
  data: Record<string, unknown>;
  model: string;
}

/** OpenRouter accepts at most this many models per request (`models` array). */
export const MAX_MODELS_PER_REQUEST = 3;

/** Split a chain into the batches sent one after another. */
export function modelBatches(models: string[], size = MAX_MODELS_PER_REQUEST): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < models.length; i += size) out.push(models.slice(i, i + size));
  return out;
}

/** A bad or unauthorised key fails the same way for every model, so don't try the rest. */
const isFinal = (status: number) => status === 401 || status === 403;

export async function callJson(cfg: AiConfig, opts: JsonCallOptions): Promise<JsonCallResult> {
  const models = opts.models?.length ? opts.models : cfg.models;
  const batches = modelBatches(models);
  let lastError: AiError | null = null;
  for (const batch of batches) {
    try {
      return await callBatch(cfg, opts, batch);
    } catch (e) {
      const err = e instanceof AiError ? e : new AiError(e instanceof Error ? e.message : String(e), 502);
      if (isFinal(err.status)) throw err;
      lastError = err;
    }
  }
  throw lastError ?? new AiError("No AI models configured", 500);
}

async function callBatch(cfg: AiConfig, opts: JsonCallOptions, models: string[]): Promise<JsonCallResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const body: Record<string, unknown> = {
    model: models[0],
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.content },
    ],
    temperature: 0,
    max_tokens: opts.maxTokens ?? 900,
    response_format: { type: "json_object" },
    provider: {
      data_collection: cfg.dataCollection,
      ...(cfg.zdr ? { zdr: true } : {}),
    },
  };
  if (models.length > 1) body.models = models;
  if (opts.hasPdf) body.plugins = [{ id: "file-parser", pdf: { engine: "cloudflare-ai" } }];

  const headers: Record<string, string> = {
    Authorization: `Bearer ${cfg.apiKey}`,
    "Content-Type": "application/json",
    "X-Title": "AutoFlow",
  };
  if (cfg.appUrl) headers["HTTP-Referer"] = cfg.appUrl;

  const res = await doFetch(OPENROUTER_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  let payload: ChatResponse | null = null;
  try { payload = JSON.parse(raw) as ChatResponse; } catch { /* not JSON */ }
  if (!res.ok || payload?.error) {
    const msg = payload?.error?.message ?? raw.slice(0, 300) ?? res.statusText;
    const code = Number(payload?.error?.code);
    const status = res.ok ? (Number.isFinite(code) && code > 0 ? code : 502) : res.status;
    if (status === 429) throw new AiError("AI rate limit reached — try again shortly", 429);
    if (status === 402) throw new AiError("AI credits exhausted for paid models", 402);
    throw new AiError(`AI request failed: ${msg}`, status);
  }
  const message = payload?.choices?.[0]?.message;
  const text: string = typeof message?.content === "string"
    ? message.content
    : Array.isArray(message?.content)
      ? message.content.map((p) => p?.text ?? "").join("")
      : "";
  if (!text) throw new AiError("AI returned an empty reply", 502);
  return { data: parseJsonReply(text), model: payload?.model ?? models[0] };
}
