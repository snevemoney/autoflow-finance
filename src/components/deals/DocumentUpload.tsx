import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, X, FileText, Image, File, CheckCircle2, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DOCUMENT_TYPE_CONFIG, type DocumentType } from '@/types/deal';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { uploadDealDocuments, type PendingUpload, type UploadType } from '@/lib/uploads';

interface DocumentUploadProps {
  /** when set, files are uploaded to this deal; otherwise they are handed to onChange (new-deal form) */
  dealId?: string;
  onUploaded?: (documentIds: string[]) => void;
  /** controlled mode for forms that upload after the deal exists */
  onChange?: (files: PendingUpload[]) => void;
  /** pre-select a type (e.g. answering a request for Insurance Proof) */
  defaultType?: UploadType;
  compact?: boolean;
  submitLabel?: string;
}

const ACCEPT = {
  'application/pdf': ['.pdf'],
  'image/*': ['.jpg', '.jpeg', '.png', '.webp', '.heic'],
};

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FileIcon({ file }: { file: File }) {
  if (file.type.startsWith('image/')) return <Image className="h-5 w-5 text-info" />;
  if (file.type === 'application/pdf') return <FileText className="h-5 w-5 text-destructive" />;
  return <File className="h-5 w-5 text-muted-foreground" />;
}

export function DocumentUpload({ dealId, onUploaded, onChange, defaultType = 'auto', compact = false, submitLabel }: DocumentUploadProps) {
  const [files, setFiles] = useState<PendingUpload[]>([]);
  const [uploading, setUploading] = useState(false);
  const [done, setDone] = useState<Record<number, boolean>>({});
  const qc = useQueryClient();
  const { isStaff } = useAuth();

  const update = useCallback((next: PendingUpload[]) => {
    setFiles(next);
    onChange?.(next);
  }, [onChange]);

  const onDrop = useCallback((accepted: File[]) => {
    update([...files, ...accepted.map((file) => ({ file, type: defaultType }))]);
  }, [files, update, defaultType]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPT,
    maxSize: 15 * 1024 * 1024,
    onDropRejected: (rejections) => toast({
      title: 'Some files were skipped',
      description: rejections.map((r) => `${r.file.name}: ${r.errors[0]?.message}`).join('\n'),
      variant: 'destructive',
    }),
  });

  const handleUpload = async () => {
    if (!dealId || !files.length) return;
    setUploading(true);
    setDone({});
    try {
      const result = await uploadDealDocuments(dealId, files, (i, ok) => setDone((d) => ({ ...d, [i]: ok })), { logTimeline: isStaff });
      if (result.failed.length) {
        toast({ title: `${result.failed.length} file(s) failed`, description: result.failed.map((f) => `${f.name}: ${f.error}`).join('\n'), variant: 'destructive' });
      }
      if (result.documentIds.length) {
        toast({
          title: `${result.documentIds.length} document(s) uploaded`,
          description: 'AutoFlow is sorting them and reading any income documents.',
        });
      }
      update([]);
      qc.invalidateQueries({ queryKey: ['deal', dealId] });
      qc.invalidateQueries({ queryKey: ['checklist', dealId] });
      onUploaded?.(result.documentIds);
    } catch (err) {
      toast({ title: 'Upload failed', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div
        {...getRootProps()}
        className={cn(
          'border-2 border-dashed rounded-lg text-center cursor-pointer transition-colors',
          compact ? 'p-4' : 'p-8',
          isDragActive ? 'border-accent bg-accent/5' : 'border-border hover:border-muted-foreground/50',
        )}
      >
        <input {...getInputProps()} />
        <div className="flex flex-col items-center gap-2">
          {!compact && (
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Upload className="h-6 w-6 text-muted-foreground" />
            </div>
          )}
          <p className="font-medium text-sm">
            {isDragActive ? 'Drop files here…' : compact ? 'Drop files or click to add' : 'Drag & drop files here'}
          </p>
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Sparkles className="h-3 w-3 text-accent" />
            PDF or photos, up to 15 MB — AutoFlow sorts them and reads income documents
          </p>
        </div>
      </div>

      {files.length > 0 && (
        <div className="space-y-2">
          {files.map((item, index) => (
            <div key={`${item.file.name}-${index}`} className="flex items-center gap-2 rounded-lg border bg-card p-2.5">
              <div className="shrink-0"><FileIcon file={item.file} /></div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{item.file.name}</p>
                <p className="text-xs text-muted-foreground">{formatFileSize(item.file.size)}</p>
              </div>
              <Select
                value={item.type}
                onValueChange={(v) => update(files.map((f, i) => (i === index ? { ...f, type: v as UploadType } : f)))}
                disabled={uploading}
              >
                <SelectTrigger className="w-44 h-8 text-xs" aria-label="Document type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">
                    <span className="flex items-center gap-1"><Sparkles className="h-3 w-3 text-accent" /> Auto-detect</span>
                  </SelectItem>
                  {(Object.keys(DOCUMENT_TYPE_CONFIG) as DocumentType[]).filter((t) => t !== 'other').map((key) => (
                    <SelectItem key={key} value={key}>{DOCUMENT_TYPE_CONFIG[key].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {uploading ? (
                done[index] === true ? <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                  : done[index] === false ? <X className="h-4 w-4 text-destructive shrink-0" />
                  : <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />
              ) : (
                <Button variant="ghost" size="icon" className="shrink-0 h-8 w-8" aria-label={`Remove ${item.file.name}`}
                  onClick={() => update(files.filter((_, i) => i !== index))}>
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}

          {dealId && (
            <Button onClick={handleUpload} className="w-full" disabled={uploading}>
              {uploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
              {uploading ? 'Uploading…' : submitLabel ?? `Upload ${files.length} document${files.length === 1 ? '' : 's'}`}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
