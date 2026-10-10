// document-url — a short-lived link to open one document's file or preview.
// POST {documentId, kind: "file" | "preview"} with the user's session.
// Staff, or the dealer who owns the deal: the document must be visible to the caller under
// row-level security. The link is signed with the service role, valid for 5 minutes, and every
// link handed out is recorded in document_access_log.
import { ERR, isUuid, parseOrigins, responder } from "../_shared/http.ts";
import { adminClient, getCaller, settings, userClient } from "../_shared/auth.ts";
import { FILE_KINDS, type FileKind, pathFor, SIGNED_URL_SECONDS } from "../_shared/storage.ts";

Deno.serve(async (req) => {
  const admin = adminClient();
  const get = await settings(admin);
  const http = responder(req, parseOrigins(get("ALLOWED_ORIGINS")));
  if (req.method === "OPTIONS") return http.preflight();
  if (!http.originOk) return http.error(ERR.origin, 403);
  if (req.method !== "POST") return http.error(ERR.method, 405);

  try {
    const caller = await getCaller(admin, req);
    if (!caller) return http.error(ERR.signIn, 401);
    if (!caller.roles.length) return http.error(ERR.forbidden, 403);

    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return http.error(ERR.badRequest, 400); }
    const documentId = body?.documentId;
    const kind = (body?.kind ?? "file") as FileKind;
    if (!isUuid(documentId) || !FILE_KINDS.includes(kind)) return http.error(ERR.badRequest, 400);

    // as the caller: row-level security decides whether they may see this document
    const { data: doc, error } = await userClient(req).from("documents")
      .select("id, deal_id, storage_path, file_url, preview_path")
      .eq("id", documentId)
      .maybeSingle();
    if (error || !doc) return http.error(ERR.notFound, 404);

    const path = pathFor(doc, kind);
    if (!path) return http.error(ERR.notFound, 404);

    const { data: signed, error: signError } = await admin.storage.from("documents").createSignedUrl(path, SIGNED_URL_SECONDS);
    if (signError || !signed?.signedUrl) return http.error(ERR.notFound, 404);

    // no log row, no link
    const { error: logError } = await admin.from("document_access_log").insert({
      user_id: caller.userId, document_id: doc.id, deal_id: doc.deal_id, kind,
    });
    if (logError) {
      console.error("document-url: access log insert failed", logError.message);
      return http.error(ERR.server, 500);
    }
    return http.json({ url: signed.signedUrl, expiresIn: SIGNED_URL_SECONDS });
  } catch (e) {
    console.error("document-url", e instanceof Error ? e.message : String(e));
    return http.error(ERR.server, 500);
  }
});
