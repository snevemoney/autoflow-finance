// Shared HTTP helpers for edge functions: CORS for the app's own origins only, JSON replies
// with generic error messages, and a constant-time secret comparison.
import { AiError } from "./ai.ts";

/** Used when the ALLOWED_ORIGINS setting is not set. */
export const DEFAULT_ALLOWED_ORIGINS = [
  "https://autoflow-kappa-two.vercel.app",
  "http://localhost:5173",
  "http://localhost:8080",
  "http://127.0.0.1:4173",
];

const ALLOW_HEADERS =
  "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version";

export const normalizeOrigin = (o: string) => o.trim().replace(/\/+$/, "").toLowerCase();

/** "https://a.example, https://b.example/" → normalized list; empty → the defaults. */
export function parseOrigins(value: string | null | undefined): string[] {
  const items = (value ?? "").split(",").map(normalizeOrigin).filter(Boolean);
  return items.length ? [...new Set(items)] : DEFAULT_ALLOWED_ORIGINS;
}

/** Requests without an Origin header (server-to-server, the database cron) are not browser requests. */
export function originAllowed(origin: string | null, allowed: string[]): boolean {
  return origin == null || allowed.includes(normalizeOrigin(origin));
}

/** CORS headers: the request's origin is reflected only when it is on the list. */
export function corsHeadersFor(origin: string | null, allowed: string[]): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": ALLOW_HEADERS,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
  if (origin && allowed.includes(normalizeOrigin(origin))) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

/** Short, generic messages for callers. Technical detail goes to logs / ai_usage only. */
export const ERR = {
  badRequest: "Invalid request",
  signIn: "Sign in required",
  forbidden: "Not allowed",
  notFound: "Not found",
  method: "Method not allowed",
  origin: "Origin not allowed",
  aiBusy: "The AI service is busy — try again in a few minutes",
  aiUnavailable: "The AI service is unavailable right now — try again later",
  aiNotConfigured: "Automatic reading is not set up",
  server: "Something went wrong — try again",
} as const;

/** A meaningful status with a generic message for an AI failure; the upstream text stays server-side. */
export function aiFailure(e: unknown): { status: number; message: string } {
  if (!(e instanceof AiError)) return { status: 500, message: ERR.server };
  if (e.code === "rate_limit") return { status: 429, message: ERR.aiBusy };
  if (e.code === "timeout") return { status: 504, message: ERR.aiBusy };
  if (e.code === "credits" || e.code === "auth" || e.code === "config") return { status: 503, message: ERR.aiUnavailable };
  return { status: 502, message: ERR.aiUnavailable };
}

export interface Responder {
  origin: string | null;
  originOk: boolean;
  json(body: unknown, status?: number): Response;
  error(message: string, status: number): Response;
  preflight(): Response;
}

export function responder(req: Request, allowed: string[]): Responder {
  const origin = req.headers.get("Origin");
  const cors = corsHeadersFor(origin, allowed);
  const originOk = originAllowed(origin, allowed);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  return {
    origin,
    originOk,
    json,
    error: (message, status) => json({ error: message }, status),
    preflight: () => new Response(null, { status: originOk ? 204 : 403, headers: cors }),
  };
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

/** Compares two secrets in constant time (both are hashed first, so length doesn't leak). */
export async function secretsEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const xa = new Uint8Array(x), ya = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < xa.length; i++) diff |= xa[i] ^ ya[i];
  return diff === 0 && a.length > 0 && b.length > 0;
}

/** Base64 for large binary files without blowing the call stack. */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
