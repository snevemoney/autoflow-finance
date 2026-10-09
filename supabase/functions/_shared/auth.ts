// Staff check for edge functions that only internal users may call.
import { createClient } from "npm:@supabase/supabase-js@2";

export async function requireStaff(req: Request): Promise<{ userId: string } | Response> {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data } = await admin.auth.getUser(token);
  if (!data?.user) return new Response(JSON.stringify({ error: "Sign in required" }), { status: 401 });
  const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", data.user.id);
  if (!(roles ?? []).some((r: { role: string }) => r.role !== "dealer")) {
    return new Response(JSON.stringify({ error: "Staff only" }), { status: 403 });
  }
  return { userId: data.user.id };
}
