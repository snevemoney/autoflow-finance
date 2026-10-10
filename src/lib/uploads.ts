import { supabase } from '@/integrations/supabase/client';
import type { DocumentType } from '@/types/deal';
import { errorMessage, processDocuments } from './rpc';

export type UploadType = DocumentType | 'auto';

export interface PendingUpload {
  file: File;
  /** 'auto' lets AutoFlow sort the document */
  type: UploadType;
}

export interface UploadResult {
  documentIds: string[];
  failed: { name: string; error: string }[];
  /** uploaded, but process-document could not be started for these — offer Retry */
  notStarted: string[];
}

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
export const TOO_LARGE = 'This file is larger than 15 MB';
export const WRONG_TYPE = 'Only PDF or photos (JPG, PNG, WebP, HEIC)';

const MIME_OK = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const EXT_OK = /\.(pdf|jpe?g|png|webp|heic|heif)$/i;

/** react-dropzone `accept` value matching the rules above. */
export const UPLOAD_ACCEPT = {
  'application/pdf': ['.pdf'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
  'image/heic': ['.heic'],
  'image/heif': ['.heif'],
};

/** null when the file can be uploaded, otherwise a sentence for the person uploading it. */
export function validateUpload(file: { name: string; size: number; type: string }): string | null {
  if (file.size > MAX_UPLOAD_BYTES) return TOO_LARGE;
  const typeOk = file.type ? MIME_OK.includes(file.type.toLowerCase()) : EXT_OK.test(file.name);
  if (!typeOk && !(file.type === 'application/octet-stream' && EXT_OK.test(file.name))) return WRONG_TYPE;
  if (file.size === 0) return 'This file is empty';
  return null;
}

/** Turn storage / network errors into something a dealer can act on. */
export function friendlyUploadError(e: unknown): string {
  const msg = errorMessage(e);
  if (/payload too large|exceeded the maximum|413|too large/i.test(msg)) return TOO_LARGE;
  if (/mime|content type|invalid_mime|not supported/i.test(msg)) return WRONG_TYPE;
  if (/failed to fetch|network|offline/i.test(msg)) return 'The connection dropped — check the internet connection and try again';
  if (/row-level security|permission|not allowed|unauthori[sz]ed|403/i.test(msg)) return "You don't have permission to add documents to this deal";
  return 'The upload failed — please try again';
}

class UploadProblem extends Error {}

function safeName(name: string): string {
  const clean = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w.-]+/g, '_');
  return clean.slice(-120) || 'document';
}

const isPdf = (file: File) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name);

/** First page of a PDF as a JPEG, so scanned PDFs can be read by vision models. */
export async function renderPdfPreview(file: File, maxWidth = 1600): Promise<Blob | null> {
  try {
    const pdfjs = await import('pdfjs-dist');
    const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
    const page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(2.5, maxWidth / base.width) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.85));
    await pdf.destroy();
    return blob;
  } catch (err) {
    console.warn('PDF preview failed', err);
    return null;
  }
}

/**
 * Stores files under "<dealId>/…", records them, and asks the server to sort and read them
 * (process-document, five at a time). Reading continues on the server even if this page is closed;
 * if it can't be started the ids come back in `notStarted` so the page can offer a Retry.
 */
export async function uploadDealDocuments(
  dealId: string,
  uploads: PendingUpload[],
  onFileDone?: (index: number, ok: boolean, error?: string) => void,
  /** staff uploads get a timeline entry; dealers can't write the internal timeline (each file is logged when it's sorted) */
  opts: { logTimeline?: boolean } = {},
): Promise<UploadResult> {
  const rows: Record<string, unknown>[] = [];
  const failed: UploadResult['failed'] = [];

  for (let i = 0; i < uploads.length; i++) {
    const { file, type } = uploads[i];
    try {
      const problem = validateUpload(file);
      if (problem) throw new UploadProblem(problem);
      const id = crypto.randomUUID();
      const path = `${dealId}/${id}-${safeName(file.name)}`;
      const { error } = await supabase.storage.from('documents').upload(path, file, { contentType: file.type || undefined, upsert: false });
      if (error) throw new UploadProblem(friendlyUploadError(error));

      let previewPath: string | null = null;
      if (isPdf(file)) {
        const preview = await renderPdfPreview(file);
        if (preview) {
          const p = `${dealId}/previews/${id}.jpg`;
          const { error: pErr } = await supabase.storage.from('documents').upload(p, preview, { contentType: 'image/jpeg' });
          if (!pErr) previewPath = p;
        }
      }
      // uploaded_by, status, processing fields and type_source are set by the server
      rows.push({
        deal_id: dealId,
        name: file.name,
        type: type === 'auto' ? 'other' : type,
        file_url: path,
        storage_path: path,
        preview_path: previewPath,
        mime_type: file.type || null,
        file_size: file.size,
      });
      onFileDone?.(i, true);
    } catch (err) {
      const message = err instanceof UploadProblem ? err.message : friendlyUploadError(err);
      failed.push({ name: file.name, error: message });
      onFileDone?.(i, false, message);
    }
  }

  if (!rows.length) return { documentIds: [], failed, notStarted: [] };
  // one insert → the database waits for every file in the batch before checking for gaps
  const { data, error } = await supabase.from('documents').insert(rows as never).select('id');
  if (error) throw new Error(friendlyUploadError(error));
  const documentIds = (data ?? []).map((d) => d.id as string);

  if (opts.logTimeline) {
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from('deal_timeline').insert({
      deal_id: dealId,
      type: 'document_upload',
      description: `${documentIds.length} document${documentIds.length === 1 ? '' : 's'} uploaded`,
      created_by: user?.id ?? null,
      metadata: { document_ids: documentIds },
    }).then(() => undefined, () => undefined);
  }

  const { failed: notStarted } = await processDocuments(documentIds);
  return { documentIds, failed, notStarted };
}

export { processDocuments };
