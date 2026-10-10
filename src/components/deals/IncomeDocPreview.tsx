import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { FileText, Image, ChevronDown, ChevronUp, Eye, File, GripVertical } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { qk } from '@/lib/query-keys';
import { isImageDoc, isPdfDoc } from '@/lib/documents';
import { cn } from '@/lib/utils';
import { DocumentPreview } from './DocumentPreview';

interface IncomeDocument {
  id: string;
  name: string;
  mime_type: string | null;
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
    <button
      type="button"
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
    </button>
  );
}

const FREQ_LABELS: Record<string, string> = {
  weekly: 'Weekly',
  biweekly: 'Biweekly',
  semimonthly: 'Semimonthly',
  monthly: 'Monthly',
};

export function IncomeDocPreview({ dealId, sourceId, onClickFill }: IncomeDocPreviewProps) {
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const [expanded, setExpanded] = useState(false);
  const [previewDocId, setPreviewDocId] = useState<string | null>(null);

  const { data: incomeDocs } = useQuery({
    queryKey: qk.incomeDocs(uid, dealId),
    enabled: !!uid,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('documents')
        .select('id, name, mime_type, type, status, created_at')
        .eq('deal_id', dealId)
        .in('type', ['pay_stub', 'bank_statement', 'income_verification']);
      if (error) throw error;
      return (data ?? []) as IncomeDocument[];
    },
  });

  // every extraction on the deal: linked to this source, or not linked to any source yet
  const { data: extractions } = useQuery({
    queryKey: [...qk.extractions(uid, dealId), 'for-source', sourceId],
    enabled: !!uid,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('extracted_income_data')
        .select('id, document_id, gross_pay, net_pay, pay_frequency, ytd_gross, employer_name_on_doc, confidence, income_source_id')
        .eq('deal_id', dealId);
      if (error) throw error;
      return ((data ?? []) as (ExtractedData & { income_source_id: string | null })[])
        .filter((e) => e.income_source_id === sourceId || e.income_source_id == null);
    },
  });

  if (!incomeDocs || incomeDocs.length === 0) return null;

  const linkedIds = new Set((extractions ?? []).filter((e) => e.income_source_id === sourceId).map((e) => e.document_id));
  const allDocs = [...incomeDocs.filter((d) => linkedIds.has(d.id)), ...incomeDocs.filter((d) => !linkedIds.has(d.id))];
  const previewDoc = allDocs.find((d) => d.id === previewDocId) ?? null;
  const extractionFor = (docId: string) => (extractions ?? []).find((e) => e.document_id === docId);

  const icon = (d: IncomeDocument) => {
    const doc = { id: d.id, name: d.name, mimeType: d.mime_type };
    if (isImageDoc(doc)) return <Image className="h-3 w-3 text-info" aria-hidden />;
    if (isPdfDoc(doc)) return <FileText className="h-3 w-3 text-destructive" aria-hidden />;
    return <File className="h-3 w-3 text-muted-foreground" aria-hidden />;
  };

  const chips = (e: ExtractedData) => {
    const list: { label: string; value: string; field: string }[] = [];
    if (e.gross_pay != null) list.push({ label: 'Gross', value: String(e.gross_pay), field: 'grossPerPeriod' });
    if (e.net_pay != null) list.push({ label: 'Net', value: String(e.net_pay), field: 'manualAmount' });
    if (e.ytd_gross != null) list.push({ label: 'YTD', value: String(e.ytd_gross), field: 'ytdGross' });
    if (e.pay_frequency) list.push({ label: 'Freq', value: e.pay_frequency, field: 'payFrequency' });
    if (!list.length) return null;
    return (
      <div className="flex flex-wrap gap-1 mt-1">
        {list.map((c) => <DraggableChip key={c.field + e.id} {...c} onClickFill={onClickFill} />)}
      </div>
    );
  };

  return (
    <div className="space-y-2 border-t border-border pt-2">
      <button type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full">
        {expanded ? <ChevronUp className="h-3 w-3" aria-hidden /> : <ChevronDown className="h-3 w-3" aria-hidden />}
        <FileText className="h-3 w-3" aria-hidden />
        Income documents ({allDocs.length})
        {linkedIds.size > 0 && <span className="text-success ml-1">({linkedIds.size} linked)</span>}
      </button>

      {expanded && (
        <div className="space-y-2">
          {(extractions ?? []).length > 0 && (
            <p className="text-[10px] text-muted-foreground bg-muted/50 rounded px-2 py-1 flex items-center gap-1">
              <GripVertical className="h-3 w-3" aria-hidden />
              {onClickFill ? 'Click or drag a value into the calculator above' : 'Drag a value into the calculator above'}
            </p>
          )}
          <ul className="space-y-1">
            {allDocs.map((doc) => {
              const extraction = extractionFor(doc.id);
              return (
                <li key={doc.id}>
                  <button type="button" onClick={() => setPreviewDocId(previewDocId === doc.id ? null : doc.id)} aria-expanded={previewDocId === doc.id}
                    className={cn('flex items-center gap-2 w-full text-left px-2 py-1.5 rounded-md text-xs transition-colors',
                      previewDocId === doc.id ? 'bg-primary/10 border border-primary/20' : 'hover:bg-muted/50')}>
                    {icon(doc)}
                    <span className="flex-1 truncate">{doc.name}</span>
                    {linkedIds.has(doc.id) && <span className="text-[10px] text-success bg-success/10 px-1.5 py-0.5 rounded">linked</span>}
                    <Eye className="h-3 w-3 text-muted-foreground shrink-0" aria-hidden />
                  </button>
                  {extraction && <div className="pl-6 pb-1">{chips(extraction)}</div>}
                </li>
              );
            })}
          </ul>
          {previewDoc && (
            <DocumentPreview key={previewDoc.id} doc={{ id: previewDoc.id, name: previewDoc.name, mimeType: previewDoc.mime_type }} maxHeight="320px" />
          )}
        </div>
      )}
    </div>
  );
}
