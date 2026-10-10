// Shared server-side helpers: Supabase clients, who is calling, settings (function secrets
// first, then Vault), and the internal secret the database cron uses.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { AI_SETTING_KEYS, type Env, loadSettings } from "./ai.ts";
import { secretsEqual } from "./http.ts";
import { DEFAULT_MAX_AI_CALLS_PER_DEAL_DAY } from "./pipeline.ts";

export const SETTING_KEYS = [...AI_SETTING_KEYS, "ALLOWED_ORIGINS", "AI_MAX_CALLS_PER_DEAL_DAY"] as const;

export function adminClient(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function publicKey(): string {
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (anon) return anon;
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}") as Record<string, string>;
    return keys.default ?? Object.values(keys)[0] ?? "";
  } catch {
    return "";
  }
}

/** A client that acts as the caller, so row-level security decides what they can see. */
export function userClient(req: Request): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, publicKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
}

/** All settings, read once per request from the function secrets, then the vault (cached). */
export function settings(admin: SupabaseClient): Promise<Env> {
  return loadSettings(SETTING_KEYS, (k) => Deno.env.get(k), async () => {
    const { data, error } = await admin.rpc("get_ai_settings");
    if (error) throw new Error(error.message);
    return (data ?? {}) as Record<string, string>;
  });
}

export function maxAiCallsPerDealDay(get: Env): number {
  const n = Number.parseInt(get("AI_MAX_CALLS_PER_DEAL_DAY") ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_AI_CALLS_PER_DEAL_DAY;
}

export interface Caller {
  userId: string;
  roles: string[];
  isStaff: boolean;
}

/** The signed-in user behind the request's JWT, or null. Staff = any role other than dealer. */
export async function getCaller(admin: SupabaseClient, req: Request): Promise<Caller | null> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return null;
  const { data: rows } = await admin.from("user_roles").select("role").eq("user_id", data.user.id);
  const roles = (rows ?? []).map((r: { role: string }) => r.role);
  return { userId: data.user.id, roles, isStaff: roles.some((r) => r !== "dealer") };
}

let internalCache: { at: number; value: string | null } | null = null;
const INTERNAL_TTL_MS = 5 * 60_000;

/** True when the x-autoflow-internal header carries the INTERNAL_CRON_SECRET from Vault. */
export async function isInternalCall(admin: SupabaseClient, header: string | null): Promise<boolean> {
  if (!header) return false;
  if (!internalCache || Date.now() - internalCache.at > INTERNAL_TTL_MS) {
    const { data, error } = await admin.rpc("get_internal_secret", { _name: "INTERNAL_CRON_SECRET" });
    if (error) {
      console.warn("internal secret not readable", error.message);
      return false;
    }
    internalCache = { at: Date.now(), value: typeof data === "string" && data ? data : null };
  }
  const secret = internalCache.value;
  return !!secret && await secretsEqual(header, secret);
}
