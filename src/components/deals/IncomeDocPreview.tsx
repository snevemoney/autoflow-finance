import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { FileText, Image, ChevronDown, ChevronUp, ExternalLink, File } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

interface IncomeDocument {
  id: string;
  name: string;
  file_url: string;
  type: string;
  status: string;
  created_at: string;
}

interface IncomeDocPreviewProps {
  dealId: string;
  sourceId: string;
}

function isMockUrl(url: string) {
  return !url.startsWith('http') && !url.startsWith('blob:');
}

export function IncomeDocPreview({ dealId, sourceId }: IncomeDocPreviewProps) {
  const [expanded, setExpanded] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<IncomeDocument | null>(null);

  // Get document IDs linked to this income source via extracted_income_data
  const { data: linkedDocIds } = useQuery({
    queryKey: ['income-doc-ids', sourceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('extracted_income_data')
        .select('document_id')
        .eq('income_source_id', sourceId);
      if (error) throw error;
      return (data ?? []).map(d => d.document_id);
    },
  });

  // Get all income-type documents for this deal
  const { data: incomeDocs } = useQuery({
    queryKey: ['income-docs', dealId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('documents')
        .select('*')
        .eq('deal_id', dealId)
        .in('type', ['pay_stub', 'bank_statement', 'income_verification']);
      if (error) throw error;
      return (data ?? []) as IncomeDocument[];
    },
  });

  if (!incomeDocs || incomeDocs.length === 0) return null;

  // Show linked docs first, then other income docs
  const linkedDocs = incomeDocs.filter(d => linkedDocIds?.includes(d.id));
  const otherDocs = incomeDocs.filter(d => !linkedDocIds?.includes(d.id));
  const allDocs = [...linkedDocs, ...otherDocs];

  const isImage = (name: string) => /\.(jpg|jpeg|png|gif|webp)$/i.test(name);
  const isPdf = (name: string) => /\.pdf$/i.test(name);

  const getIcon = (name: string) => {
    if (isImage(name)) return <Image className="h-3 w-3 text-info" />;
    if (isPdf(name)) return <FileText className="h-3 w-3 text-destructive" />;
    return <File className="h-3 w-3 text-muted-foreground" />;
  };

  return (
    <div className="space-y-2 border-t border-border pt-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
      >
        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        <FileText className="h-3 w-3" />
        Income Documents ({allDocs.length})
        {linkedDocs.length > 0 && (
          <span className="text-success ml-1">({linkedDocs.length} linked)</span>
        )}
      </button>

      {expanded && (
        <div className="space-y-2">
          {/* Doc list */}
          <div className="space-y-1">
            {allDocs.map(doc => {
              const isLinked = linkedDocIds?.includes(doc.id);
              const mock = isMockUrl(doc.file_url);
              return (
                <button
                  key={doc.id}
                  onClick={() => !mock && setPreviewDoc(previewDoc?.id === doc.id ? null : doc)}
                  className={cn(
                    'flex items-center gap-2 w-full text-left px-2 py-1.5 rounded-md text-xs transition-colors',
                    previewDoc?.id === doc.id
                      ? 'bg-primary/10 border border-primary/20'
                      : 'hover:bg-muted/50',
                    mock && 'opacity-50 cursor-not-allowed'
                  )}
                >
                  {getIcon(doc.name)}
                  <span className="flex-1 truncate">{doc.name}</span>
                  {isLinked && (
                    <span className="text-[10px] text-success bg-success/10 px-1.5 py-0.5 rounded">linked</span>
                  )}
                  {!mock && <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0" />}
                </button>
              );
            })}
          </div>

          {/* Inline preview */}
          {previewDoc && !isMockUrl(previewDoc.file_url) && (
            <div className="rounded-md border border-border overflow-hidden bg-background">
              <div className="flex items-center justify-between px-2 py-1 bg-muted/50 border-b border-border">
                <span className="text-[10px] font-medium truncate">{previewDoc.name}</span>
                <a
                  href={previewDoc.file_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] text-primary hover:underline shrink-0 ml-2"
                >
                  Open full
                </a>
              </div>
              {isImage(previewDoc.name) ? (
                <img
                  src={previewDoc.file_url}
                  alt={previewDoc.name}
                  className="w-full max-h-[300px] object-contain"
                />
              ) : isPdf(previewDoc.name) ? (
                <iframe
                  src={previewDoc.file_url}
                  className="w-full h-[300px]"
                  title={previewDoc.name}
                />
              ) : (
                <div className="flex items-center justify-center p-6 text-xs text-muted-foreground">
                  Preview not available for this file type
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
