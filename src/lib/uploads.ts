import { supabase } from '@/integrations/supabase/client';
import type { DocumentType } from '@/types/deal';

export type UploadType = DocumentType | 'auto';

export interface PendingUpload {
  file: File;
  /** 'auto' lets AutoFlow sort the document */
  type: UploadType;
}

export interface UploadResult {
  documentIds: string[];
  failed: { name: string; error: string }[];
}

const MAX_BYTES = 15 * 1024 * 1024;

function safeName(name: string): string {
  const clean = name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '_');
  return clean.slice(-120) || 'document';
}

/** First page of a PDF as a JPEG, so scanned PDFs can be read by vision models. */
export async function renderPdfPreview(file: File, maxWidth = 1600): Promise<Blob | null> {
  try {
    const pdfjs = await import('pdfjs-dist');
    const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
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
 * Stores files under "<dealId>/…", records them, and asks the server to sort and read them.
 * Reading continues on the server even if this page is closed.
 */
export async function uploadDealDocuments(
  dealId: string,
  uploads: PendingUpload[],
  onFileDone?: (index: number, ok: boolean) => void,
  /** staff uploads get a timeline entry; dealers can't write the internal timeline (each file is logged when it's sorted) */
  opts: { logTimeline?: boolean } = {},
): Promise<UploadResult> {
  const { data: { user } } = await supabase.auth.getUser();
  const rows: Record<string, unknown>[] = [];
  const failed: UploadResult['failed'] = [];

  for (let i = 0; i < uploads.length; i++) {
    const { file, type } = uploads[i];
    try {
      if (file.size > MAX_BYTES) throw new Error('File is larger than 15 MB');
      const id = crypto.randomUUID();
      const path = `${dealId}/${id}-${safeName(file.name)}`;
      const { error } = await supabase.storage.from('documents').upload(path, file, { contentType: file.type || undefined, upsert: false });
      if (error) throw error;

      let previewPath: string | null = null;
      if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
        const preview = await renderPdfPreview(file);
        if (preview) {
          const p = `${dealId}/previews/${id}.jpg`;
          const { error: pErr } = await supabase.storage.from('documents').upload(p, preview, { contentType: 'image/jpeg' });
          if (!pErr) previewPath = p;
        }
      }
      rows.push({
        deal_id: dealId,
        name: file.name,
        type: type === 'auto' ? 'other' : type,
        type_source: type === 'auto' ? 'auto' : 'manual',
        file_url: path,
        storage_path: path,
        preview_path: previewPath,
        mime_type: file.type || null,
        file_size: file.size,
        uploaded_by: user?.id ?? null,
        status: 'pending',
        processing_status: 'pending',
      });
      onFileDone?.(i, true);
    } catch (err) {
      failed.push({ name: file.name, error: err instanceof Error ? err.message : String(err) });
      onFileDone?.(i, false);
    }
  }

  if (!rows.length) return { documentIds: [], failed };
  // one insert → the database waits for every file in the batch before checking for gaps
  const { data, error } = await supabase.from('documents').insert(rows as never).select('id');
  if (error) throw error;
  const documentIds = (data ?? []).map((d) => d.id);

  if (opts.logTimeline) {
    await supabase.from('deal_timeline').insert({
      deal_id: dealId,
      type: 'document_upload',
      description: `${documentIds.length} document${documentIds.length === 1 ? '' : 's'} uploaded`,
      created_by: user?.id ?? null,
      metadata: { document_ids: documentIds },
    }).then(() => undefined, () => undefined);
  }

  await processDocuments(documentIds);
  return { documentIds, failed };
}

/** Ask the server to (re)read documents. Returns once the job is accepted. */
export async function processDocuments(documentIds: string[], force = false) {
  if (!documentIds.length) return;
  const { error } = await supabase.functions.invoke('process-document', {
    body: { documentIds, force, background: true },
  });
  if (error) console.warn('process-document could not be started', error);
}

export async function signedUrl(path: string | null | undefined, seconds = 3600): Promise<string | null> {
  if (!path) return null;
  if (/^(https?:|blob:)/.test(path)) return path;
  const { data, error } = await supabase.storage.from('documents').createSignedUrl(path.replace(/^documents\//, ''), seconds);
  return error ? null : data.signedUrl;
}
