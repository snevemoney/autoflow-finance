import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Link2, FileText } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { calcMonthlyFromExtraction } from '@/lib/income';
import type { IncomeSource } from './IncomeSourceCard';

interface ExtractedIncome {
  id: string;
  document_id: string;
  gross_pay: number | null;
  net_pay: number | null;
  pay_frequency: string | null;
  pay_date: string | null;
  employer_name_on_doc: string | null;
  ytd_gross: number | null;
  confidence: string;
  extracted_at: string;
  income_source_id: string | null;
}

interface UnmatchedExtractionRowProps {
  extraction: ExtractedIncome;
  incomeSources: IncomeSource[];
  onLinked: () => void;
}

export function UnmatchedExtractionRow({ extraction, incomeSources, onLinked }: UnmatchedExtractionRowProps) {
  const [selectedSourceId, setSelectedSourceId] = useState<string>('');
  const [linking, setLinking] = useState(false);

  const handleLink = async () => {
    if (!selectedSourceId) return;
    const source = incomeSources.find(s => s.id === selectedSourceId);
    if (!source) return;

    setLinking(true);
    try {
      // Link extraction to chosen source
      const { error: linkError } = await supabase
        .from('extracted_income_data')
        .update({ income_source_id: selectedSourceId })
        .eq('id', extraction.id);
      if (linkError) throw linkError;

      // Recalculate income and fraud flags
      const calculatedMonthly = calcMonthlyFromExtraction(extraction.gross_pay!, extraction.pay_frequency!);
      const flags = [...(source.flag_reasons || [])];

      const variance = source.stated_monthly_income > 0
        ? Math.abs((calculatedMonthly - source.stated_monthly_income) / source.stated_monthly_income) * 100
        : 0;
      if (variance > 15 && !flags.includes('Income variance > 15%')) {
        flags.push('Income variance > 15%');
      }
      if (extraction.employer_name_on_doc) {
        const docEmp = extraction.employer_name_on_doc.toLowerCase().trim();
        const srcEmp = source.employer_name.toLowerCase().trim();
        if (!docEmp.includes(srcEmp) && !srcEmp.includes(docEmp) && !flags.includes('Employer name mismatch')) {
          flags.push('Employer name mismatch');
        }
      }
      if (extraction.pay_date) {
        const days = (Date.now() - new Date(extraction.pay_date).getTime()) / (1000 * 60 * 60 * 24);
        if (days > 60 && !flags.includes('Document > 60 days old')) {
          flags.push('Document > 60 days old');
        }
      }

      const { error: updateError } = await supabase
        .from('income_sources')
        .update({ calculated_monthly_income: calculatedMonthly, flag_reasons: flags })
        .eq('id', selectedSourceId);
      if (updateError) throw updateError;

      toast({ title: 'Extraction linked to income source' });
      onLinked();
    } catch (err) {
      console.error(err);
      toast({ title: 'Failed to link extraction', variant: 'destructive' });
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
      <div className="flex items-center gap-2 text-sm">
        <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="font-medium truncate">
          {extraction.employer_name_on_doc ?? 'Unknown employer'}
        </span>
        <span className="text-muted-foreground">
          ${extraction.gross_pay?.toLocaleString()} / {extraction.pay_frequency ?? '?'}
        </span>
        <Badge variant="outline" className={`text-xs ${confidenceColor}`}>
          {extraction.confidence}
        </Badge>
      </div>
      <div className="flex items-center gap-2">
        <Select value={selectedSourceId} onValueChange={setSelectedSourceId}>
          <SelectTrigger className="h-8 text-xs flex-1">
            <SelectValue placeholder="Select income source..." />
          </SelectTrigger>
          <SelectContent>
            {incomeSources.map(src => (
              <SelectItem key={src.id} value={src.id}>
                {src.employer_name} ({src.source_type})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs"
          disabled={!selectedSourceId || linking}
          onClick={handleLink}
        >
          <Link2 className="h-3 w-3 mr-1" />
          {linking ? 'Linking...' : 'Link'}
        </Button>
      </div>
    </div>
  );
}
