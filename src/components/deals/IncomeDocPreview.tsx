import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { FileText, Image, ChevronDown, ChevronUp, ExternalLink, File, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

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

export function IncomeDocPreview({ dealId, sourceId }: IncomeDocPreviewProps) {
  const [expanded, setExpanded] = useState(false);
  const [previewDocId, setPreviewDocId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

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

  const linkedDocs = incomeDocs.filter(d => linkedDocIds?.includes(d.id));
  const otherDocs = incomeDocs.filter(d => !linkedDocIds?.includes(d.id));
  const allDocs = [...linkedDocs, ...otherDocs];
  const previewDoc = allDocs.find(d => d.id === previewDocId) ?? null;

  const isImage = (name: string) => /\.(jpg|jpeg|png|gif|webp)$/i.test(name);
  const isPdf = (name: string) => /\.pdf$/i.test(name);

  const getIcon = (name: string) => {
    if (isImage(name)) return <Image className="h-3 w-3 text-info" />;
    if (isPdf(name)) return <FileText className="h-3 w-3 text-destructive" />;
    return <File className="h-3 w-3 text-muted-foreground" />;
  };

  const handleDocClick = async (doc: IncomeDocument) => {
    if (previewDocId === doc.id) {
      setPreviewDocId(null);
      setPreviewUrl(null);
      return;
    }
    setPreviewDocId(doc.id);
    setPreviewUrl(null);
    setLoadingPreview(true);

    let url: string | null = null;
    if (doc.file_url.startsWith('http') || doc.file_url.startsWith('blob:')) {
      url = doc.file_url;
    } else {
      const path = doc.file_url.replace(/^documents\//, '');
      const { data, error } = await supabase.storage.from('documents').createSignedUrl(path, 3600);
      if (!error && data?.signedUrl) url = data.signedUrl;
    }

    setPreviewUrl(url);
    setLoadingPreview(false);
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
          <div className="space-y-1">
            {allDocs.map(doc => {
              const isLinked = linkedDocIds?.includes(doc.id);
              return (
                <button
                  key={doc.id}
                  onClick={() => handleDocClick(doc)}
                  className={cn(
                    'flex items-center gap-2 w-full text-left px-2 py-1.5 rounded-md text-xs transition-colors',
                    previewDocId === doc.id
                      ? 'bg-primary/10 border border-primary/20'
                      : 'hover:bg-muted/50'
                  )}
                >
                  {getIcon(doc.name)}
                  <span className="flex-1 truncate">{doc.name}</span>
                  {isLinked && (
                    <span className="text-[10px] text-success bg-success/10 px-1.5 py-0.5 rounded">linked</span>
                  )}
                  <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0" />
                </button>
              );
            })}
          </div>

          {/* Inline preview */}
          {previewDocId && (
            <div className="rounded-md border border-border overflow-hidden bg-background">
              {loadingPreview ? (
                <div className="flex items-center justify-center p-6">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : previewUrl && previewDoc ? (
                <>
                  <div className="flex items-center justify-between px-2 py-1 bg-muted/50 border-b border-border">
                    <span className="text-[10px] font-medium truncate">{previewDoc.name}</span>
                    <a
                      href={previewUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] text-primary hover:underline shrink-0 ml-2"
                    >
                      Open full
                    </a>
                  </div>
                  {isImage(previewDoc.name) ? (
                    <img
                      src={previewUrl}
                      alt={previewDoc.name}
                      className="w-full max-h-[300px] object-contain"
                    />
                  ) : isPdf(previewDoc.name) ? (
                    <iframe
                      src={previewUrl}
                      className="w-full h-[300px]"
                      title={previewDoc.name}
                    />
                  ) : (
                    <div className="flex items-center justify-center p-6 text-xs text-muted-foreground">
                      Preview not available for this file type
                    </div>
                  )}
                </>
              ) : (
                <div className="flex items-center justify-center p-6 text-xs text-muted-foreground">
                  Unable to load preview
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
