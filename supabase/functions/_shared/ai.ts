// One AI client for every automation. All models are reached through OpenRouter with a
// priority-ordered fallback chain. Everything is configured outside the code, so models can
// change freely:
//
//   OPENROUTER_API_KEY     required
//   AI_MODELS              comma-separated chain used for every document. OpenRouter takes
//                          3 models per request, so longer chains are sent 3 at a time.
//   AI_ESCALATION_MODELS   chain used to re-read a document the first pass was unsure about
//   AI_DATA_COLLECTION     "deny" (default) = only providers that don't store or train on prompts;
//                          "allow" to lift that restriction
//   AI_ZDR                 "true" (default) = zero-data-retention endpoints only; "false" to lift it
//   APP_URL                optional, sent to OpenRouter for attribution
//
// Each setting is read from the edge-function secrets first, then from Supabase Vault
// (see loadSettings), so it can be managed from either place.

export const AI_SETTING_KEYS = [
  "OPENROUTER_API_KEY", "AI_MODELS", "AI_ESCALATION_MODELS", "AI_DATA_COLLECTION", "AI_ZDR", "APP_URL",
] as const;

// Default chains. Every model here has zero-data-retention endpoints on OpenRouter
// (https://openrouter.ai/api/v1/endpoints/zdr), reads images, and takes PDFs natively, so a
// borrower's file only ever goes to ZDR endpoints. Each chain mixes two vendors so one
// provider outage doesn't stop the work.
//   First pass: a fast, low-cost multimodal model that reads scans and French well, then a
//   stronger small model if it is unavailable.
//   Escalation (only for an unsure first pass): two stronger models.
export const DEFAULT_MODELS = [
  "google/gemini-3.1-flash-lite",
  "anthropic/claude-haiku-5.5",
];
export const DEFAULT_ESCALATION_MODELS = [
  "google/gemini-3.8-flash",
  "anthropic/claude-sonnet-5.5",
];

/** A single AI request is abandoned after this long. */
export const AI_TIMEOUT_MS = 45_000;

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
  timeoutMs: number;
}

export type AiErrorCode = "timeout" | "rate_limit" | "credits" | "auth" | "upstream" | "bad_reply" | "network" | "config";

/** Technical detail stays in `message` (logged to ai_usage); never show it to a caller. */
export class AiError extends Error {
  constructor(message: string, readonly status = 500, readonly code: AiErrorCode = "upstream") {
    super(message);
  }
}

/** Errors that clear up on their own: worth an automatic retry later. */
export function isTransientAiError(e: unknown): boolean {
  if (!(e instanceof AiError)) return false;
  if (["rate_limit", "credits", "timeout", "network", "bad_reply"].includes(e.code)) return true;
  return e.code === "upstream" && e.status >= 500;
}

const list = (v: string | undefined, fallback: string[]) => {
  const items = (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return items.length ? items : fallback;
};

export type Env = (key: string) => string | undefined;

export function aiConfigFromEnv(get: Env): AiConfig | null {
  const apiKey = get("OPENROUTER_API_KEY");
  if (!apiKey) return null;
  return {
    apiKey,
    models: list(get("AI_MODELS"), DEFAULT_MODELS),
    escalationModels: list(get("AI_ESCALATION_MODELS"), DEFAULT_ESCALATION_MODELS),
    dataCollection: get("AI_DATA_COLLECTION")?.trim().toLowerCase() === "allow" ? "allow" : "deny",
    zdr: get("AI_ZDR")?.trim().toLowerCase() !== "false",
    appUrl: get("APP_URL"),
    timeoutMs: AI_TIMEOUT_MS,
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
export async function loadSettings(keys: readonly string[], env: Env, readVault?: VaultReader): Promise<Env> {
  let vault: Record<string, string> = {};
  const missing = keys.some((k) => !env(k));
  if (missing && readVault) {
    if (vaultCache && Date.now() - vaultCache.at < VAULT_TTL_MS) {
      vault = vaultCache.values;
    } else {
      try {
        vault = await readVault();
        vaultCache = { at: Date.now(), values: vault };
      } catch (e) {
        console.warn("settings: vault not readable", e instanceof Error ? e.message : e);
      }
    }
  }
  return (k) => env(k) || vault[k] || undefined;
}

export async function loadAiConfig(env: Env, readVault?: VaultReader): Promise<AiConfig | null> {
  return aiConfigFromEnv(await loadSettings(AI_SETTING_KEYS, env, readVault));
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
  if (start < 0 || end <= start) throw new AiError("Model reply contained no JSON object", 502, "bad_reply");
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate.slice(start, end + 1));
  } catch {
    throw new AiError("Model reply was not valid JSON", 502, "bad_reply");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AiError("Model reply was not a JSON object", 502, "bad_reply");
  }
  return parsed as Record<string, unknown>;
}

interface ChatResponse {
  model?: string;
  error?: { message?: string; code?: number | string };
  choices?: { message?: { content?: string | { text?: string }[] } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
}

/** One HTTP request to OpenRouter, reported for the ai_usage log whether it worked or not. */
export interface AiAttempt {
  models: string[];
  model: string | null;
  ok: boolean;
  status: number;
  errorCode: AiErrorCode | null;
  errorDetail: string | null;
  latencyMs: number;
  promptTokens: number | null;
  completionTokens: number | null;
  cost: number | null;
}

export interface JsonCallOptions {
  system: string;
  content: ContentPart[];
  models?: string[];
  maxTokens?: number;
  /** PDFs: read natively by the model under ZDR, otherwise by OpenRouter's free parser. */
  hasPdf?: boolean;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Called after every request (success or failure), e.g. to write ai_usage. */
  onAttempt?: (attempt: AiAttempt) => void | Promise<void>;
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
const isFinal = (e: AiError) => e.code === "auth";

export async function callJson(cfg: AiConfig, opts: JsonCallOptions): Promise<JsonCallResult> {
  const models = opts.models?.length ? opts.models : cfg.models;
  const batches = modelBatches(models);
  let lastError: AiError | null = null;
  for (const batch of batches) {
    try {
      return await callBatch(cfg, opts, batch);
    } catch (e) {
      const err = e instanceof AiError ? e : new AiError(e instanceof Error ? e.message : String(e), 502);
      if (isFinal(err)) throw err;
      lastError = err;
    }
  }
  throw lastError ?? new AiError("No AI models configured", 500, "config");
}

function codeForStatus(status: number): AiErrorCode {
  if (status === 429) return "rate_limit";
  if (status === 402) return "credits";
  if (status === 401 || status === 403) return "auth";
  if (status === 408) return "timeout";
  return "upstream";
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function buildRequestBody(cfg: AiConfig, opts: JsonCallOptions, models: string[]): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: models[0],
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.content },
    ],
    temperature: 0,
    // room for the JSON answer plus brief reasoning on models that always reason
    max_tokens: opts.maxTokens ?? 4000,
    reasoning: { effort: "low", exclude: true },
    response_format: { type: "json_object" },
    usage: { include: true },
    provider: {
      data_collection: cfg.dataCollection,
      ...(cfg.zdr ? { zdr: true } : {}),
    },
  };
  if (models.length > 1) body.models = models;
  // ZDR covers model endpoints, not OpenRouter's parsing plugins, so under ZDR the PDF goes
  // to the (ZDR) model itself; otherwise the free parser turns it into text first.
  if (opts.hasPdf) body.plugins = [{ id: "file-parser", pdf: { engine: cfg.zdr ? "native" : "cloudflare-ai" } }];
  return body;
}

async function callBatch(cfg: AiConfig, opts: JsonCallOptions, models: string[]): Promise<JsonCallResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${cfg.apiKey}`,
    "Content-Type": "application/json",
    "X-Title": "AutoFlow",
  };
  if (cfg.appUrl) headers["HTTP-Referer"] = cfg.appUrl;

  const started = Date.now();
  const attempt: AiAttempt = {
    models, model: null, ok: false, status: 0, errorCode: null, errorDetail: null,
    latencyMs: 0, promptTokens: null, completionTokens: null, cost: null,
  };
  const timeoutMs = opts.timeoutMs ?? cfg.timeoutMs ?? AI_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let res: Response;
    let raw: string;
    try {
      res = await doFetch(OPENROUTER_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(buildRequestBody(cfg, opts, models)),
        signal: controller.signal,
      });
      raw = await res.text();
    } catch (e) {
      if (controller.signal.aborted) throw new AiError(`AI request timed out after ${Math.round(timeoutMs / 1000)} s`, 408, "timeout");
      throw new AiError(`AI request could not be sent: ${e instanceof Error ? e.message : String(e)}`, 503, "network");
    }
    attempt.status = res.status;
    let payload: ChatResponse | null = null;
    try { payload = JSON.parse(raw) as ChatResponse; } catch { /* not JSON */ }
    attempt.model = payload?.model ?? null;
    attempt.promptTokens = num(payload?.usage?.prompt_tokens);
    attempt.completionTokens = num(payload?.usage?.completion_tokens);
    attempt.cost = num(payload?.usage?.cost);
    if (!res.ok || payload?.error) {
      const msg = payload?.error?.message ?? (raw.slice(0, 300) || res.statusText);
      const code = Number(payload?.error?.code);
      const status = res.ok ? (Number.isFinite(code) && code > 0 ? code : 502) : res.status;
      attempt.status = status;
      throw new AiError(`AI request failed (${status}): ${msg}`, status, codeForStatus(status));
    }
    const message = payload?.choices?.[0]?.message;
    const text: string = typeof message?.content === "string"
      ? message.content
      : Array.isArray(message?.content)
        ? message.content.map((p) => p?.text ?? "").join("")
        : "";
    if (!text) throw new AiError("AI returned an empty reply", 502, "bad_reply");
    const data = parseJsonReply(text);
    attempt.ok = true;
    return { data, model: payload?.model ?? models[0] };
  } catch (e) {
    const err = e instanceof AiError ? e : new AiError(e instanceof Error ? e.message : String(e), 502);
    attempt.errorCode = err.code;
    attempt.errorDetail = err.message.slice(0, 1000);
    if (!attempt.status) attempt.status = err.status;
    throw err;
  } finally {
    clearTimeout(timer);
    attempt.latencyMs = Date.now() - started;
    if (opts.onAttempt) {
      try { await opts.onAttempt(attempt); } catch (e) { console.warn("ai usage log failed", e instanceof Error ? e.message : e); }
    }
  }
}
