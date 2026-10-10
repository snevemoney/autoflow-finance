import { useState } from 'react';
import { format } from 'date-fns';
import { FileText, Loader2, Sparkles, AlertTriangle, RotateCw, Check, X, MoreHorizontal, Clock } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ExtractedDataBadge, type ExtractedData } from './ExtractedDataBadge';
import { DOCUMENT_TYPE_CONFIG, type Document, type DocumentType } from '@/types/deal';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { errorMessage, processDocuments, retryDocument } from '@/lib/rpc';
import { isSlow } from '@/lib/documents';
import { qk } from '@/lib/query-keys';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';

const INCOME_DOC_TYPES: DocumentType[] = ['pay_stub', 'bank_statement', 'income_verification'];

interface DocumentListProps {
  dealId: string;
  documents: Document[];
  staff: boolean;
  extractions?: Record<string, ExtractedData>;
  onView: (doc: Document) => void;
}

function ProcessingBadge({ doc }: { doc: Document }) {
  if (doc.processingStatus === 'pending' || doc.processingStatus === 'processing') {
    const slow = isSlow(doc);
    return (
      <Badge variant="outline" className={cn('gap-1 text-xs', slow ? 'text-warning border-warning/40' : 'text-muted-foreground')}>
        {slow ? <Clock className="h-3 w-3" aria-hidden /> : <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
        {slow ? 'Taking longer than usual' : 'Reading…'}
      </Badge>
    );
  }
  if (doc.processingStatus === 'failed') {
    return (
      <Badge variant="outline" className="gap-1 text-xs text-warning border-warning/40">
        <AlertTriangle className="h-3 w-3" aria-hidden /> Not read
      </Badge>
    );
  }
  if (doc.processingStatus === 'skipped') {
    return <Badge variant="outline" className="gap-1 text-xs text-muted-foreground">Not read automatically</Badge>;
  }
  if (doc.typeSource === 'auto' || doc.typeSource === 'rule') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" tabIndex={0} className="gap-1 text-xs text-accent border-accent/30 bg-accent/5">
            <Sparkles className="h-3 w-3" aria-hidden /> Auto-sorted
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="text-xs">
          {doc.typeSource === 'rule' ? 'Sorted from the file name' : `Sorted by AI${doc.classificationConfidence ? ` (${doc.classificationConfidence} confidence)` : ''}`}
        </TooltipContent>
      </Tooltip>
    );
  }
  return null;
}

export function DocumentList({ dealId, documents, staff, extractions, onView }: DocumentListProps) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: qk.deal(user?.id, dealId) });
    qc.invalidateQueries({ queryKey: qk.checklist(user?.id, dealId) });
  };

  const setType = async (doc: Document, type: DocumentType) => {
    setBusy(doc.id);
    const { error } = await supabase.from('documents').update({ type, type_source: 'manual' }).eq('id', doc.id);
    setBusy(null);
    if (error) toast({ title: 'Could not change the type', description: error.message, variant: 'destructive' });
    else refresh();
  };

  const setStatus = async (doc: Document, status: 'verified' | 'rejected' | 'pending') => {
    setBusy(doc.id);
    const { error } = await supabase.from('documents').update({ status }).eq('id', doc.id);
    setBusy(null);
    if (error) toast({ title: 'Could not update the document', description: error.message, variant: 'destructive' });
    else refresh();
  };

  /** staff only: sort and read again even if it was read before */
  const reread = async (doc: Document) => {
    setBusy(doc.id);
    const { failed } = await processDocuments([doc.id], { force: true });
    setBusy(null);
    if (failed.length) toast({ title: 'Reading didn’t start', description: 'Try again in a minute.', variant: 'destructive' });
    else toast({ title: 'Reading again', description: doc.name });
    refresh();
  };

  /** owner dealer or staff: a failed document goes back in the queue */
  const retry = async (doc: Document) => {
    setBusy(doc.id);
    try {
      const { queued, started } = await retryDocument(doc.id);
      if (!queued) toast({ title: 'This document can’t be retried again', description: 'Please upload it again.', variant: 'destructive' });
      else if (!started) toast({ title: 'Queued — reading will start shortly', description: 'AutoFlow retries on its own every few minutes.' });
      else toast({ title: 'Reading again', description: doc.name });
    } catch (e) {
      toast({ title: 'Could not retry', description: errorMessage(e), variant: 'destructive' });
    } finally {
      setBusy(null);
      refresh();
    }
  };

  if (!documents.length) {
    return <p className="text-sm text-muted-foreground py-6 text-center">No documents yet.</p>;
  }

  return (
    <ul className="space-y-2">
      {documents.map((doc) => {
        const failed = doc.processingStatus === 'failed';
        return (
          <li key={doc.id} className="rounded-lg border bg-card">
            <div className="flex flex-wrap sm:flex-nowrap items-center gap-3 p-3">
              <button type="button" onClick={() => onView(doc)}
                className="flex flex-1 min-w-0 items-center gap-3 text-left rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`View ${doc.name}`}>
                <span className="flex h-10 w-10 items-center justify-center rounded bg-muted shrink-0">
                  <FileText className="h-5 w-5 text-muted-foreground" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block font-medium text-sm truncate hover:underline">{doc.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {doc.type === 'other' && doc.processingStatus !== 'done' && doc.processingStatus !== 'manual'
                      ? 'Sorting…'
                      : DOCUMENT_TYPE_CONFIG[doc.type]?.label ?? doc.type}
                    {' · '}{doc.uploadedAt ? format(new Date(doc.uploadedAt), 'MMM d, yyyy') : ''}
                    {staff && doc.uploadedBy ? ` · ${doc.uploadedBy}` : ''}
                  </span>
                </span>
              </button>
              <div className="flex items-center gap-1.5 flex-wrap justify-end">
                <ProcessingBadge doc={doc} />
                {/* staff see their own review state; a dealer just needs to know the file arrived (or must be resent) */}
                <span className={cn('status-badge',
                  doc.status === 'verified' && 'bg-success/10 text-success',
                  doc.status === 'pending' && (staff ? 'bg-warning/10 text-warning' : 'bg-muted text-muted-foreground'),
                  doc.status === 'rejected' && 'bg-destructive/10 text-destructive')}>
                  {doc.status === 'pending' ? (staff ? 'In review' : 'Received')
                    : doc.status === 'verified' ? (staff ? 'Verified' : 'Accepted')
                    : staff ? 'Rejected' : 'Please resend'}
                </span>
                {staff && INCOME_DOC_TYPES.includes(doc.type) && (
                  <ExtractedDataBadge extraction={extractions?.[doc.id] ?? null} isIncomeDoc />
                )}
                {staff && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8" disabled={busy === doc.id} aria-label={`Actions for ${doc.name}`}>
                        {busy === doc.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <MoreHorizontal className="h-4 w-4" aria-hidden />}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      <DropdownMenuItem onSelect={() => setStatus(doc, 'verified')}><Check className="h-4 w-4 mr-2 text-success" aria-hidden /> Mark verified</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setStatus(doc, 'rejected')}><X className="h-4 w-4 mr-2 text-destructive" aria-hidden /> Reject</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => reread(doc)}><RotateCw className="h-4 w-4 mr-2" aria-hidden /> Sort &amp; read again</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel className="text-xs text-muted-foreground">Change type</DropdownMenuLabel>
                      {(Object.keys(DOCUMENT_TYPE_CONFIG) as DocumentType[]).map((t) => (
                        <DropdownMenuItem key={t} onSelect={() => setType(doc, t)} className={cn(t === doc.type && 'font-semibold')}>
                          {DOCUMENT_TYPE_CONFIG[t].label}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </div>
            {failed && (
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 border-t bg-warning/5 px-3 py-2 text-xs">
                <span className="flex-1 text-muted-foreground">
                  {doc.processingError || 'This document couldn’t be read automatically.'}
                </span>
                <Button size="sm" variant="outline" className="h-7 self-start sm:self-auto" disabled={busy === doc.id} onClick={() => retry(doc)}>
                  {busy === doc.id ? <Loader2 className="h-3 w-3 mr-1 animate-spin" aria-hidden /> : <RotateCw className="h-3 w-3 mr-1" aria-hidden />} Retry
                </Button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
