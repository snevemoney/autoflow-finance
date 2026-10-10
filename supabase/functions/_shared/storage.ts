// Where a document's file lives in the private "documents" bucket.

export const SIGNED_URL_SECONDS = 5 * 60;
export type FileKind = "file" | "preview";
export const FILE_KINDS: FileKind[] = ["file", "preview"];

/**
 * The object path inside the bucket for a stored path: "<deal_id>/…", "documents/<deal_id>/…",
 * or an old full storage URL of this bucket. Anything else (another bucket, an outside link,
 * "..") gives null.
 */
export function objectPath(stored: string | null | undefined): string | null {
  if (!stored) return null;
  let p = stored.trim();
  if (/^https?:\/\//i.test(p)) {
    let url: URL;
    try { url = new URL(p); } catch { return null; }
    const m = url.pathname.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/documents\/(.+)$/);
    if (!m) return null;
    try { p = decodeURIComponent(m[1]); } catch { return null; }
  }
  p = p.replace(/^\/+/, "").replace(/^documents\//, "");
  if (!p || p.split("/").some((seg) => seg === ".." || seg === ".")) return null;
  return p;
}

/** Which stored path a kind of link refers to. */
export function pathFor(
  doc: { storage_path: string | null; file_url: string | null; preview_path: string | null },
  kind: FileKind,
): string | null {
  return objectPath(kind === "preview" ? doc.preview_path : (doc.storage_path ?? doc.file_url));
}
