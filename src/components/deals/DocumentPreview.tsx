import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CloudOff, Download, File, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { documentUrl, errorMessage } from '@/lib/rpc';
import { isImageDoc, isPdfDoc, type PreviewableDocument } from '@/lib/documents';
import { cn } from '@/lib/utils';

const MAX_PAGES = 25;

/**
 * Draws a PDF with pdf.js onto canvases — no <iframe>, no browser PDF plugin, no script from the file
 * ever runs (eval disabled). Falls back to "can't show" for anything pdf.js can't parse.
 */
function PdfCanvas({ url, title, maxHeight }: { url: string; title: string; maxHeight: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ status: 'loading' | 'ready' | 'error'; pages: number; shown: number }>({ status: 'loading', pages: 0, shown: 0 });

  useEffect(() => {
    let cancelled = false;
    let destroy: (() => void) | null = null;
    const el = host.current;
    (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        const task = pdfjs.getDocument({ url, isEvalSupported: false, disableAutoFetch: true, withCredentials: false });
        destroy = () => { void task.destroy(); };
        const pdf = await task.promise;
        if (cancelled || !el) return;
        el.replaceChildren();
        const width = Math.max(280, el.clientWidth - 16);
        const shown = Math.min(pdf.numPages, MAX_PAGES);
        for (let n = 1; n <= shown; n++) {
          const page = await pdf.getPage(n);
          if (cancelled) return;
          const base = page.getViewport({ scale: 1 });
          const ratio = window.devicePixelRatio || 1;
          const viewport = page.getViewport({ scale: (width / base.width) * ratio });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.style.width = `${Math.floor(viewport.width / ratio)}px`;
          canvas.className = 'mx-auto mb-3 block bg-white shadow-sm rounded';
          canvas.setAttribute('role', 'img');
          canvas.setAttribute('aria-label', `${title}, page ${n} of ${pdf.numPages}`);
          el.appendChild(canvas);
          const ctx = canvas.getContext('2d');
          if (ctx) await page.render({ canvasContext: ctx, viewport }).promise;
          if (n === 1 && !cancelled) setState({ status: 'ready', pages: pdf.numPages, shown });
        }
      } catch (e) {
        if (!cancelled) {
          console.warn('PDF preview failed', errorMessage(e));
          setState({ status: 'error', pages: 0, shown: 0 });
        }
      }
    })();
    return () => {
      cancelled = true;
      destroy?.();
    };
  }, [url, title]);

  return (
    <div className="relative">
      {state.status === 'loading' && (
        <div className="flex items-center justify-center p-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading document" /></div>
      )}
      {state.status === 'error' && (
        <div className="flex flex-col items-center justify-center gap-2 p-10 text-center text-sm">
          <File className="h-10 w-10 text-muted-foreground" aria-hidden />
          <p className="text-muted-foreground">This PDF can't be shown here. Download it to open it.</p>
        </div>
      )}
      <div ref={host} className="overflow-auto p-2" style={{ maxHeight }} aria-label={title} />
      {state.status === 'ready' && state.pages > state.shown && (
        <p className="text-center text-xs text-muted-foreground pb-2">Showing the first {state.shown} of {state.pages} pages — download for the rest.</p>
      )}
    </div>
  );
}

/** Adds Supabase's download flag so the file is saved, not rendered on the storage domain. */
function downloadUrl(url: string, name: string): string {
  try {
    const u = new URL(url);
    u.searchParams.set('download', name);
    return u.toString();
  } catch {
    return url;
  }
}

/** Shows a document from a short-lived link issued by the `document-url` edge function. */
export function DocumentPreview({ doc, maxHeight = '70vh', className, showDownload = true }: {
  doc: PreviewableDocument; maxHeight?: string; className?: string; showDownload?: boolean;
}) {
  const { user } = useAuth();
  const link = useQuery({
    queryKey: ['document-url', user?.id ?? null, doc.id],
    queryFn: () => documentUrl(doc.id, 'file'),
    staleTime: 4 * 60_000, // links are valid for 5 minutes
    gcTime: 4 * 60_000,
    retry: 1,
  });
  const [imageFailed, setImageFailed] = useState(false);
  const url = link.data ?? null;

  return (
    <div className={cn('space-y-2', className)}>
      <div className="min-h-0 overflow-auto rounded-lg border bg-muted/30">
        {link.isLoading ? (
          <div className="flex items-center justify-center p-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading document" /></div>
        ) : !url ? (
          <div className="flex flex-col items-center justify-center gap-3 p-10 text-center">
            <CloudOff className="h-8 w-8 text-muted-foreground" aria-hidden />
            <div className="space-y-1">
              <p className="font-medium">Document preview unavailable</p>
              <p className="text-sm text-muted-foreground">{link.error ? errorMessage(link.error) : 'This file could not be opened.'}</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => link.refetch()}>Try again</Button>
          </div>
        ) : isPdfDoc(doc) ? (
          <PdfCanvas url={url} title={doc.name} maxHeight={maxHeight} />
        ) : isImageDoc(doc) && !imageFailed ? (
          <div className="flex items-center justify-center p-2 sm:p-4">
            <img src={url} alt={doc.name} referrerPolicy="no-referrer" onError={() => setImageFailed(true)}
              className="max-w-full object-contain rounded" style={{ maxHeight }} />
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 p-10 text-center">
            <File className="h-10 w-10 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">{imageFailed ? "This photo format can't be shown in the browser." : 'Preview not available for this file type.'} Download it to open it.</p>
          </div>
        )}
      </div>
      {showDownload && url && (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" asChild>
            <a href={downloadUrl(url, doc.name)} rel="noopener noreferrer" target="_blank">
              <Download className="h-4 w-4 mr-2" aria-hidden /> Download
            </a>
          </Button>
        </div>
      )}
    </div>
  );
}
