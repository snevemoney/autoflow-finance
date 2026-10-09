import { useState } from 'react';
import { format } from 'date-fns';
import { FileText, Loader2, Sparkles, AlertTriangle, RotateCw, Check, X, MoreHorizontal } from 'lucide-react';
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
import { processDocuments } from '@/lib/uploads';
import { toast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';

const INCOME_DOC_TYPES: DocumentType[] = ['pay_stub', 'bank_statement', 'income_verification'];

interface DocumentListProps {
  dealId: string;
  documents: Document[];
  staff: boolean;
  extractions?: Record<string, ExtractedData>;
  onView: (doc: Document) => void;
}

function ProcessingBadge({ doc, staff }: { doc: Document; staff: boolean }) {
  const stale = doc.processingStatus === 'pending' && Date.now() - new Date(doc.uploadedAt).getTime() > 3 * 60_000;
  if (doc.processingStatus === 'pending' || doc.processingStatus === 'processing') {
    return (
      <Badge variant="outline" className={cn('gap-1 text-xs', stale ? 'text-warning border-warning/40' : 'text-muted-foreground')}>
        {stale ? <AlertTriangle className="h-3 w-3" /> : <Loader2 className="h-3 w-3 animate-spin" />}
        {stale ? 'Waiting to be read' : 'Reading…'}
      </Badge>
    );
  }
  if (doc.processingStatus === 'failed' || doc.processingStatus === 'skipped') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className="gap-1 text-xs text-warning border-warning/40">
            <AlertTriangle className="h-3 w-3" /> {staff ? 'Not read' : 'Received'}
          </Badge>
        </TooltipTrigger>
        {staff && <TooltipContent className="max-w-xs text-xs">{doc.processingError ?? 'Could not be read automatically'}</TooltipContent>}
      </Tooltip>
    );
  }
  if (doc.typeSource === 'auto' || doc.typeSource === 'rule') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className="gap-1 text-xs text-accent border-accent/30 bg-accent/5">
            <Sparkles className="h-3 w-3" /> Auto-sorted
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
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['deal', dealId] });
    qc.invalidateQueries({ queryKey: ['checklist', dealId] });
  };

  const setType = async (doc: Document, type: DocumentType) => {
    setBusy(doc.id);
    const { error } = await supabase.from('documents').update({ type, type_source: 'manual' }).eq('id', doc.id);
    setBusy(null);
    if (error) toast({ title: 'Could not change type', description: error.message, variant: 'destructive' });
    else refresh();
  };

  const setStatus = async (doc: Document, status: 'verified' | 'rejected' | 'pending') => {
    setBusy(doc.id);
    const { error } = await supabase.from('documents').update({ status }).eq('id', doc.id);
    setBusy(null);
    if (error) toast({ title: 'Could not update document', description: error.message, variant: 'destructive' });
    else refresh();
  };

  const reread = async (doc: Document) => {
    setBusy(doc.id);
    await processDocuments([doc.id], true);
    setBusy(null);
    toast({ title: 'Reading again', description: doc.name });
    refresh();
  };

  if (!documents.length) {
    return <p className="text-sm text-muted-foreground py-6 text-center">No documents yet.</p>;
  }

  return (
    <div className="space-y-2">
      {documents.map((doc) => (
        <div key={doc.id} className="document-item" onClick={() => onView(doc)}>
          <div className="flex h-10 w-10 items-center justify-center rounded bg-muted shrink-0">
            <FileText className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm truncate">{doc.name}</p>
            <p className="text-xs text-muted-foreground">
              {doc.type === 'other' && doc.processingStatus !== 'done' && doc.processingStatus !== 'manual'
                ? 'Sorting…'
                : DOCUMENT_TYPE_CONFIG[doc.type]?.label ?? doc.type}
              {' · '}{format(new Date(doc.uploadedAt), 'MMM d, yyyy')}
              {staff && doc.uploadedBy ? ` · ${doc.uploadedBy}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap justify-end" onClick={(e) => e.stopPropagation()}>
            <ProcessingBadge doc={doc} staff={staff} />
            <span className={cn('status-badge',
              doc.status === 'verified' && 'bg-success/10 text-success',
              doc.status === 'pending' && 'bg-warning/10 text-warning',
              doc.status === 'rejected' && 'bg-destructive/10 text-destructive')}>
              {doc.status === 'pending' ? 'In review' : doc.status}
            </span>
            {staff && INCOME_DOC_TYPES.includes(doc.type) && (
              <ExtractedDataBadge extraction={extractions?.[doc.id] ?? null} isIncomeDoc />
            )}
            {staff && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8" disabled={busy === doc.id} aria-label={`Actions for ${doc.name}`}>
                    {busy === doc.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem onClick={() => setStatus(doc, 'verified')}><Check className="h-4 w-4 mr-2 text-success" /> Mark verified</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setStatus(doc, 'rejected')}><X className="h-4 w-4 mr-2 text-destructive" /> Reject</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => reread(doc)}><RotateCw className="h-4 w-4 mr-2" /> Sort &amp; read again</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-xs text-muted-foreground">Change type</DropdownMenuLabel>
                  {(Object.keys(DOCUMENT_TYPE_CONFIG) as DocumentType[]).map((t) => (
                    <DropdownMenuItem key={t} onClick={() => setType(doc, t)} className={cn(t === doc.type && 'font-semibold')}>
                      {DOCUMENT_TYPE_CONFIG[t].label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
