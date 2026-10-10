/** Small, pure helpers about documents (file kinds, processing state). */

export interface PreviewableDocument {
  id: string;
  name: string;
  mimeType?: string | null;
}

export const isImageDoc = (d: PreviewableDocument) => !!d.mimeType?.startsWith('image/') || /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(d.name);
export const isPdfDoc = (d: PreviewableDocument) => d.mimeType === 'application/pdf' || /\.pdf$/i.test(d.name);

/** A document still being read after this long gets "Taking longer than usual". */
export const SLOW_AFTER_MS = 15 * 60_000;

export function isSlow(doc: { processingStatus?: string; processingStartedAt?: string | null; uploadedAt: string }, now = Date.now()): boolean {
  if (doc.processingStatus !== 'processing' && doc.processingStatus !== 'pending') return false;
  const since = doc.processingStatus === 'processing' ? doc.processingStartedAt ?? doc.uploadedAt : doc.uploadedAt;
  const t = new Date(since).getTime();
  return Number.isFinite(t) && now - t > SLOW_AFTER_MS;
}
