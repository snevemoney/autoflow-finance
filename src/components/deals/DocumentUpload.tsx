import { useCallback, useState } from 'react';
import { useDropzone, type FileRejection } from 'react-dropzone';
import { Upload, X, FileText, Image, File, CheckCircle2, Loader2, Sparkles, AlertTriangle, RotateCw } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DOCUMENT_TYPE_CONFIG, type DocumentType } from '@/types/deal';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { qk } from '@/lib/query-keys';
import { retryDocuments } from '@/lib/rpc';
import {
  MAX_UPLOAD_BYTES, TOO_LARGE, UPLOAD_ACCEPT, WRONG_TYPE, friendlyUploadError, uploadDealDocuments, validateUpload,
  type PendingUpload, type UploadType,
} from '@/lib/uploads';

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

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FileIcon({ file }: { file: File }) {
  if (file.type.startsWith('image/')) return <Image className="h-5 w-5 text-info" aria-hidden />;
  if (file.type === 'application/pdf') return <FileText className="h-5 w-5 text-destructive" aria-hidden />;
  return <File className="h-5 w-5 text-muted-foreground" aria-hidden />;
}

function rejectionReason(r: FileRejection): string {
  const code = r.errors[0]?.code;
  if (code === 'file-too-large') return TOO_LARGE;
  if (code === 'file-invalid-type') return WRONG_TYPE;
  return validateUpload(r.file) ?? 'This file was skipped';
}

/** Shown when files were stored but the server could not be asked to read them. */
export function ReadingNotStarted({ ids, dealId, onDone }: { ids: string[]; dealId: string; onDone: () => void }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const retry = async () => {
    setBusy(true);
    const { failed } = await retryDocuments(ids);
    setBusy(false);
    qc.invalidateQueries({ queryKey: qk.deal(user?.id, dealId) });
    if (failed.length) toast({ title: 'Reading still didn’t start', description: 'Try again in a minute — AutoFlow also retries on its own.', variant: 'destructive' });
    else {
      toast({ title: 'Reading started' });
      onDone();
    }
  };
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm" role="status">
      <AlertTriangle className="h-4 w-4 text-warning shrink-0" aria-hidden />
      <span className="flex-1">Uploaded, but automatic reading didn’t start{ids.length > 1 ? ` for ${ids.length} files` : ''}.</span>
      <Button size="sm" variant="outline" onClick={retry} disabled={busy}>
        {busy ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" aria-hidden /> : <RotateCw className="h-3.5 w-3.5 mr-1.5" aria-hidden />} Retry
      </Button>
    </div>
  );
}

export function DocumentUpload({ dealId, onUploaded, onChange, defaultType = 'auto', compact = false, submitLabel }: DocumentUploadProps) {
  const [files, setFiles] = useState<PendingUpload[]>([]);
  const [uploading, setUploading] = useState(false);
  const [done, setDone] = useState<Record<number, { ok: boolean; error?: string }>>({});
  const [skipped, setSkipped] = useState<{ name: string; reason: string }[]>([]);
  const [notStarted, setNotStarted] = useState<string[]>([]);
  const qc = useQueryClient();
  const { isStaff, user } = useAuth();

  const update = useCallback((next: PendingUpload[]) => {
    setFiles(next);
    onChange?.(next);
  }, [onChange]);

  const onDrop = useCallback((accepted: File[], rejected: FileRejection[]) => {
    const bad: { name: string; reason: string }[] = rejected.map((r) => ({ name: r.file.name, reason: rejectionReason(r) }));
    const good: File[] = [];
    for (const file of accepted) {
      const problem = validateUpload(file);
      if (problem) bad.push({ name: file.name, reason: problem });
      else good.push(file);
    }
    setSkipped(bad);
    if (good.length) update([...files, ...good.map((file) => ({ file, type: defaultType }))]);
  }, [files, update, defaultType]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, accept: UPLOAD_ACCEPT, maxSize: MAX_UPLOAD_BYTES });

  const handleUpload = async () => {
    if (!dealId || !files.length) return;
    setUploading(true);
    setDone({});
    setNotStarted([]);
    try {
      const result = await uploadDealDocuments(dealId, files, (i, ok, error) => setDone((d) => ({ ...d, [i]: { ok, error } })), { logTimeline: isStaff });
      if (result.failed.length) {
        toast({
          title: `${result.failed.length} file${result.failed.length === 1 ? '' : 's'} not uploaded`,
          description: result.failed.map((f) => `${f.name}: ${f.error}`).join('\n'),
          variant: 'destructive',
        });
      }
      if (result.documentIds.length) {
        toast({
          title: `${result.documentIds.length} document${result.documentIds.length === 1 ? '' : 's'} uploaded`,
          description: result.notStarted.length ? undefined : 'AutoFlow is sorting them and reading any income documents.',
        });
      }
      setNotStarted(result.notStarted);
      // keep only the files that failed so they can be fixed and sent again
      const failedNames = new Set(result.failed.map((f) => f.name));
      update(files.filter((f) => failedNames.has(f.file.name)));
      setDone({});
      qc.invalidateQueries({ queryKey: qk.deal(user?.id, dealId) });
      qc.invalidateQueries({ queryKey: qk.checklist(user?.id, dealId) });
      onUploaded?.(result.documentIds);
    } catch (err) {
      toast({ title: 'Upload failed', description: friendlyUploadError(err), variant: 'destructive' });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div
        {...getRootProps()}
        className={cn(
          'border-2 border-dashed rounded-lg text-center cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          compact ? 'p-4' : 'p-6 sm:p-8',
          isDragActive ? 'border-accent bg-accent/5' : 'border-border hover:border-muted-foreground/50',
        )}
      >
        <input {...getInputProps()} aria-label="Add documents" />
        <div className="flex flex-col items-center gap-2">
          {!compact && (
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Upload className="h-6 w-6 text-muted-foreground" aria-hidden />
            </div>
          )}
          <p className="font-medium text-sm">
            {isDragActive ? 'Drop files here…' : compact ? 'Drop files or tap to add' : 'Drag & drop files here, or click to choose'}
          </p>
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Sparkles className="h-3 w-3 text-accent shrink-0" aria-hidden />
            PDF or photos (JPG, PNG, WebP, HEIC), up to 15 MB — AutoFlow sorts them and reads income documents
          </p>
        </div>
      </div>

      {skipped.length > 0 && (
        <ul className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm space-y-1" role="alert">
          {skipped.map((s, i) => (
            <li key={`${s.name}-${i}`} className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" aria-hidden />
              <span className="min-w-0"><span className="font-medium break-all">{s.name}</span> — {s.reason}</span>
            </li>
          ))}
        </ul>
      )}

      {dealId && notStarted.length > 0 && <ReadingNotStarted ids={notStarted} dealId={dealId} onDone={() => setNotStarted([])} />}

      {files.length > 0 && (
        <div className="space-y-2">
          {files.map((item, index) => (
            <div key={`${item.file.name}-${index}`} className="flex flex-wrap sm:flex-nowrap items-center gap-2 rounded-lg border bg-card p-2.5">
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
                <SelectTrigger className="w-full sm:w-44 h-8 text-xs order-last sm:order-none" aria-label={`Document type for ${item.file.name}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">
                    <span className="flex items-center gap-1"><Sparkles className="h-3 w-3 text-accent" aria-hidden /> Auto-detect</span>
                  </SelectItem>
                  {(Object.keys(DOCUMENT_TYPE_CONFIG) as DocumentType[]).filter((t) => t !== 'other').map((key) => (
                    <SelectItem key={key} value={key}>{DOCUMENT_TYPE_CONFIG[key].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {uploading ? (
                done[index]?.ok === true ? <CheckCircle2 className="h-4 w-4 text-success shrink-0" aria-label="Uploaded" />
                  : done[index]?.ok === false ? <X className="h-4 w-4 text-destructive shrink-0" aria-label={done[index]?.error ?? 'Failed'} />
                  : <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" aria-label="Uploading" />
              ) : (
                <Button type="button" variant="ghost" size="icon" className="shrink-0 h-8 w-8" aria-label={`Remove ${item.file.name}`}
                  onClick={() => update(files.filter((_, i) => i !== index))}>
                  <X className="h-4 w-4" aria-hidden />
                </Button>
              )}
            </div>
          ))}

          {dealId && (
            <Button type="button" onClick={handleUpload} className="w-full" disabled={uploading}>
              {uploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden /> : <CheckCircle2 className="h-4 w-4 mr-2" aria-hidden />}
              {uploading ? 'Uploading…' : submitLabel ?? `Upload ${files.length} document${files.length === 1 ? '' : 's'}`}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
