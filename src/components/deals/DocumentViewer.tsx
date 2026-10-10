import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FileText, Image, File } from 'lucide-react';
import { DocumentPreview } from './DocumentPreview';
import { isImageDoc, isPdfDoc, type PreviewableDocument } from '@/lib/documents';

interface DocumentViewerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** the document row — its file is fetched through the document-url function, never from a stored URL */
  document: PreviewableDocument | null;
}

export function DocumentViewer({ open, onOpenChange, document }: DocumentViewerProps) {
  if (!document) return null;
  const icon = isImageDoc(document) ? <Image className="h-5 w-5 text-info shrink-0" aria-hidden />
    : isPdfDoc(document) ? <FileText className="h-5 w-5 text-destructive shrink-0" aria-hidden />
    : <File className="h-5 w-5 text-muted-foreground shrink-0" aria-hidden />;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-4xl max-h-[92vh] flex flex-col p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-6 min-w-0"><span className="contents">{icon}</span><span className="truncate">{document.name}</span></DialogTitle>
          <DialogDescription className="sr-only">Document preview</DialogDescription>
        </DialogHeader>
        {open && <DocumentPreview key={document.id} doc={document} maxHeight="68vh" className="flex-1 min-h-0" />}
      </DialogContent>
    </Dialog>
  );
}
