// Shared server-side helpers: the service-role client, the staff check, and AI settings.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { type AiConfig, loadAiConfig } from "./ai.ts";

export function adminClient(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
}

/** AI settings from the function secrets, falling back to Supabase Vault. */
export function aiConfig(admin: SupabaseClient): Promise<AiConfig | null> {
  return loadAiConfig((k) => Deno.env.get(k), async () => {
    const { data, error } = await admin.rpc("get_ai_settings");
    if (error) throw new Error(error.message);
    return (data ?? {}) as Record<string, string>;
  });
}

export async function requireStaff(req: Request): Promise<{ userId: string; admin: SupabaseClient } | Response> {
  const admin = adminClient();
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data } = await admin.auth.getUser(token);
  if (!data?.user) return new Response(JSON.stringify({ error: "Sign in required" }), { status: 401 });
  const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", data.user.id);
  if (!(roles ?? []).some((r: { role: string }) => r.role !== "dealer")) {
    return new Response(JSON.stringify({ error: "Staff only" }), { status: 403 });
  }
  return { userId: data.user.id, admin };
}
