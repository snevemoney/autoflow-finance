import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { FileText, Image, ChevronDown, ChevronUp, ExternalLink, File, Loader2, GripVertical } from 'lucide-react';
import { cn } from '@/lib/utils';

interface IncomeDocument {
  id: string;
  name: string;
  file_url: string;
  type: string;
  status: string;
  created_at: string;
}

interface ExtractedData {
  id: string;
  document_id: string;
  gross_pay: number | null;
  net_pay: number | null;
  pay_frequency: string | null;
  ytd_gross: number | null;
  employer_name_on_doc: string | null;
  confidence: string;
}

interface IncomeDocPreviewProps {
  dealId: string;
  sourceId: string;
  onClickFill?: (field: string, value: string) => void;
}

interface DraggableChipProps {
  label: string;
  value: string;
  field: string;
  onClickFill?: (field: string, value: string) => void;
}

function DraggableChip({ label, value, field, onClickFill }: DraggableChipProps) {
  const handleDragStart = (e: React.DragEvent) => {
    const payload = JSON.stringify({ field, value, label });
    e.dataTransfer.setData('application/x-income-field', payload);
    e.dataTransfer.setData('text/plain', value);
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <span
      draggable
      onDragStart={handleDragStart}
      onClick={() => onClickFill?.(field, value)}
      className={cn(
        "inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium",
        "bg-primary/10 text-primary border border-primary/20 cursor-grab active:cursor-grabbing",
        "hover:bg-primary/20 hover:border-primary/30 transition-colors select-none",
        onClickFill && "cursor-pointer"
      )}
      title={`${onClickFill ? 'Click or drag' : 'Drag'} "${label}: ${value}" into a calculator field`}
    >
      <GripVertical className="h-3 w-3 opacity-50 shrink-0" />
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-semibold">{value}</span>
    </span>
  );
}

const FREQ_LABELS: Record<string, string> = {
  weekly: 'Weekly',
  biweekly: 'Biweekly',
  semimonthly: 'Semimonthly',
  monthly: 'Monthly',
};

export function IncomeDocPreview({ dealId, sourceId, onClickFill }: IncomeDocPreviewProps) {
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

  // Fetch extracted data for this source's linked documents
  const { data: extractions } = useQuery({
    queryKey: ['income-extractions', sourceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('extracted_income_data')
        .select('id, document_id, gross_pay, net_pay, pay_frequency, ytd_gross, employer_name_on_doc, confidence')
        .eq('income_source_id', sourceId);
      if (error) throw error;
      return (data ?? []) as ExtractedData[];
    },
  });

  // Also fetch unlinked extractions for this deal
  const { data: unlinkedExtractions } = useQuery({
    queryKey: ['unlinked-extractions-for-drag', dealId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('extracted_income_data')
        .select('id, document_id, gross_pay, net_pay, pay_frequency, ytd_gross, employer_name_on_doc, confidence')
        .eq('deal_id', dealId)
        .is('income_source_id', null);
      if (error) throw error;
      return (data ?? []) as ExtractedData[];
    },
  });

  if (!incomeDocs || incomeDocs.length === 0) return null;

  const linkedDocs = incomeDocs.filter(d => linkedDocIds?.includes(d.id));
  const otherDocs = incomeDocs.filter(d => !linkedDocIds?.includes(d.id));
  const allDocs = [...linkedDocs, ...otherDocs];
  const previewDoc = allDocs.find(d => d.id === previewDocId) ?? null;

  const allExtractions = [...(extractions ?? []), ...(unlinkedExtractions ?? [])];

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

  const getExtractionForDoc = (docId: string) => allExtractions.find(e => e.document_id === docId);

  const renderExtractionChips = (extraction: ExtractedData) => {
    const chips: { label: string; value: string; field: string }[] = [];
    if (extraction.gross_pay != null) {
      chips.push({ label: 'Gross', value: extraction.gross_pay.toString(), field: 'grossPerPeriod' });
    }
    if (extraction.net_pay != null) {
      chips.push({ label: 'Net', value: extraction.net_pay.toString(), field: 'manualAmount' });
    }
    if (extraction.ytd_gross != null) {
      chips.push({ label: 'YTD', value: extraction.ytd_gross.toString(), field: 'ytdGross' });
    }
    if (extraction.pay_frequency) {
      chips.push({ label: 'Freq', value: extraction.pay_frequency, field: 'payFrequency' });
    }
    if (chips.length === 0) return null;

    return (
      <div className="flex flex-wrap gap-1 mt-1">
        {chips.map(chip => (
          <DraggableChip key={chip.field + extraction.id} {...chip} onClickFill={onClickFill} />
        ))}
      </div>
    );
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
          {/* Drag hint */}
          {allExtractions.length > 0 && (
            <p className="text-[10px] text-muted-foreground bg-muted/50 rounded px-2 py-1 flex items-center gap-1">
              <GripVertical className="h-3 w-3" />
              {onClickFill ? 'Click or drag extracted values into calculator fields above' : 'Drag extracted values into calculator fields above'}
            </p>
          )}

          <div className="space-y-1">
            {allDocs.map(doc => {
              const isLinked = linkedDocIds?.includes(doc.id);
              const extraction = getExtractionForDoc(doc.id);
              return (
                <div key={doc.id}>
                  <button
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
                  {/* Draggable extracted values */}
                  {extraction && (
                    <div className="pl-6 pb-1">
                      {renderExtractionChips(extraction)}
                    </div>
                  )}
                </div>
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
