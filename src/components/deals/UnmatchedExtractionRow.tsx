import { useId, useState } from 'react';
import { Link2, FileText, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { updateIncomeSource, type ExtractedIncome } from '@/hooks/use-income';
import { errorMessage } from '@/lib/rpc';
import type { IncomeSource } from './IncomeSourceCard';

interface UnmatchedExtractionRowProps {
  extraction: ExtractedIncome;
  incomeSources: IncomeSource[];
  onLinked: () => void;
}

const sameEmployer = (a: string, b: string) => {
  const x = a.toLowerCase().trim();
  const y = b.toLowerCase().trim();
  return !!x && !!y && (x.includes(y) || y.includes(x));
};

/**
 * An analyst attaches a read pay document to an income source (explicit action). Linking only adds
 * the evidence and review flags — the figures are applied from the calculator, which locks them.
 */
export function UnmatchedExtractionRow({ extraction, incomeSources, onLinked }: UnmatchedExtractionRowProps) {
  const ids = useId();
  const [selectedSourceId, setSelectedSourceId] = useState('');
  const [linking, setLinking] = useState(false);

  const handleLink = async () => {
    const source = incomeSources.find((s) => s.id === selectedSourceId);
    if (!source) return;
    setLinking(true);
    try {
      const { error } = await supabase.from('extracted_income_data').update({ income_source_id: source.id }).eq('id', extraction.id);
      if (error) throw error;
      const flags = [...(source.flag_reasons ?? [])];
      if (extraction.employer_name_on_doc && !sameEmployer(extraction.employer_name_on_doc, source.employer_name) && !flags.includes('Employer name mismatch')) {
        flags.push('Employer name mismatch');
      }
      if (extraction.pay_date && (Date.now() - new Date(extraction.pay_date).getTime()) / 86_400_000 > 60 && !flags.includes('Document > 60 days old')) {
        flags.push('Document > 60 days old');
      }
      if (flags.length !== (source.flag_reasons ?? []).length) await updateIncomeSource(source.id, { flag_reasons: flags });
      toast({ title: 'Document linked', description: 'Open the income calculator to apply its figures.' });
      onLinked();
    } catch (err) {
      toast({ title: 'Could not link the document', description: errorMessage(err), variant: 'destructive' });
    } finally {
      setLinking(false);
    }
  };

  const confidenceColor = {
    high: 'text-success border-success/30',
    medium: 'text-warning border-warning/30',
    low: 'text-destructive border-destructive/30',
  }[extraction.confidence] ?? 'text-muted-foreground border-border';

  return (
    <div className="flex flex-col gap-2 p-3 rounded-lg border border-dashed border-warning/40 bg-warning/5">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <FileText className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden />
        <span className="font-medium truncate">{extraction.employer_name_on_doc ?? 'Unknown employer'}</span>
        <span className="text-muted-foreground">${extraction.gross_pay?.toLocaleString('en-CA')} / {extraction.pay_frequency ?? '?'}</span>
        <Badge variant="outline" className={`text-xs ${confidenceColor}`}>{extraction.confidence}</Badge>
      </div>
      <div className="flex items-center gap-2">
        <Label htmlFor={`${ids}-source`} className="sr-only">Income source for this document</Label>
        <Select value={selectedSourceId} onValueChange={setSelectedSourceId}>
          <SelectTrigger id={`${ids}-source`} className="h-8 text-xs flex-1"><SelectValue placeholder="Choose the income source…" /></SelectTrigger>
          <SelectContent>
            {incomeSources.map((src) => <SelectItem key={src.id} value={src.id}>{src.employer_name} ({src.source_type.replace('_', ' ')})</SelectItem>)}
          </SelectContent>
        </Select>
        <Button type="button" size="sm" variant="outline" className="h-8 text-xs" disabled={!selectedSourceId || linking} onClick={handleLink}>
          {linking ? <Loader2 className="h-3 w-3 mr-1 animate-spin" aria-hidden /> : <Link2 className="h-3 w-3 mr-1" aria-hidden />} Link
        </Button>
      </div>
    </div>
  );
}
