import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Download, FileText, Image, File, CloudOff } from 'lucide-react';

interface DocumentViewerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  document: {
    name: string;
    fileUrl: string;
    type: string;
  } | null;
}

function isMockUrl(url: string) {
  return !url.startsWith('http') && !url.startsWith('blob:');
}

export function DocumentViewer({ open, onOpenChange, document }: DocumentViewerProps) {
  if (!document) return null;

  const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(document.name);
  const isPdf = /\.pdf$/i.test(document.name);
  const mock = isMockUrl(document.fileUrl);

  const getIcon = () => {
    if (isImage) return <Image className="h-5 w-5 text-info" />;
    if (isPdf) return <FileText className="h-5 w-5 text-destructive" />;
    return <File className="h-5 w-5 text-muted-foreground" />;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {getIcon()}
            {document.name}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-auto rounded-lg border bg-muted/30">
          {mock ? (
            <div className="flex flex-col items-center justify-center gap-4 p-12 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                <CloudOff className="h-8 w-8 text-muted-foreground" />
              </div>
              <div className="space-y-1">
                <p className="font-medium">Document preview unavailable</p>
                <p className="text-sm text-muted-foreground">
                  This file has not yet been stored in cloud storage. Upload the document to enable preview and download.
                </p>
              </div>
            </div>
          ) : isPdf ? (
            <iframe
              src={document.fileUrl}
              className="w-full h-[70vh] rounded-lg"
              title={document.name}
            />
          ) : isImage ? (
            <div className="flex items-center justify-center p-4">
              <img
                src={document.fileUrl}
                alt={document.name}
                className="max-w-full max-h-[65vh] object-contain rounded"
              />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-4 p-12 text-center">
              <File className="h-16 w-16 text-muted-foreground" />
              <p className="text-muted-foreground">
                Preview not available for this file type.
              </p>
            </div>
          )}
        </div>

        {!mock && (
          <div className="flex justify-end pt-2">
            <Button variant="outline" asChild>
              <a href={document.fileUrl} download={document.name} target="_blank" rel="noopener noreferrer">
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
