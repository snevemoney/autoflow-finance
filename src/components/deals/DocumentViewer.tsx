import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Download, FileText, Image, File, CloudOff, Loader2 } from 'lucide-react';
import { signedUrl } from '@/lib/uploads';

interface DocumentViewerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  document: {
    name: string;
    fileUrl: string;
    type: string;
    storagePath?: string | null;
    mimeType?: string | null;
  } | null;
}

export function DocumentViewer({ open, onOpenChange, document }: DocumentViewerProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!open || !document) return;
    setLoading(true);
    signedUrl(document.storagePath ?? document.fileUrl).then((u) => {
      if (!cancelled) { setUrl(u); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [open, document]);

  if (!document) return null;

  const isImage = document.mimeType?.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp)$/i.test(document.name);
  const isPdf = document.mimeType === 'application/pdf' || /\.pdf$/i.test(document.name);

  const icon = isImage ? <Image className="h-5 w-5 text-info" /> : isPdf ? <FileText className="h-5 w-5 text-destructive" /> : <File className="h-5 w-5 text-muted-foreground" />;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">{icon}{document.name}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-auto rounded-lg border bg-muted/30">
          {loading ? (
            <div className="flex items-center justify-center p-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : !url ? (
            <div className="flex flex-col items-center justify-center gap-4 p-12 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                <CloudOff className="h-8 w-8 text-muted-foreground" />
              </div>
              <div className="space-y-1">
                <p className="font-medium">Document preview unavailable</p>
                <p className="text-sm text-muted-foreground">This file isn't in storage or you don't have access to it.</p>
              </div>
            </div>
          ) : isPdf ? (
            <iframe src={url} className="w-full h-[70vh] rounded-lg" title={document.name} />
          ) : isImage ? (
            <div className="flex items-center justify-center p-4">
              <img src={url} alt={document.name} className="max-w-full max-h-[65vh] object-contain rounded" />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-4 p-12 text-center">
              <File className="h-16 w-16 text-muted-foreground" />
              <p className="text-muted-foreground">Preview not available for this file type.</p>
            </div>
          )}
        </div>

        {url && (
          <div className="flex justify-end pt-2">
            <Button variant="outline" asChild>
              <a href={url} download={document.name} target="_blank" rel="noopener noreferrer">
                <Download className="h-4 w-4 mr-2" />
                Download
              </a>
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
