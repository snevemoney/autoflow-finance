import { Badge } from '@/components/ui/badge';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { CheckCircle2, AlertTriangle, Minus, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ExtractedData {
  id: string;
  document_id: string;
  gross_pay: number | null;
  net_pay: number | null;
  pay_frequency: string | null;
  pay_date: string | null;
  employer_name_on_doc: string | null;
  ytd_gross: number | null;
  confidence: 'high' | 'medium' | 'low';
  extracted_at: string;
}

interface ExtractedDataBadgeProps {
  extraction: ExtractedData | null | undefined;
  isIncomeDoc: boolean;
  isExtracting?: boolean;
}

export function ExtractedDataBadge({ extraction, isIncomeDoc, isExtracting }: ExtractedDataBadgeProps) {
  if (isExtracting) {
    return (
      <Badge variant="outline" className="gap-1 text-xs">
        <Loader2 className="h-3 w-3 animate-spin" />
        Extracting...
      </Badge>
    );
  }

  if (!isIncomeDoc) {
    return (
      <Badge variant="outline" className="gap-1 text-xs text-muted-foreground">
        <Minus className="h-3 w-3" />
        N/A
      </Badge>
    );
  }

  if (!extraction) {
    return (
      <Badge variant="outline" className="gap-1 text-xs text-muted-foreground">
        Not Processed
      </Badge>
    );
  }

  const isLowConfidence = extraction.confidence === 'low';

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Badge
          variant="outline"
          className={cn(
            'gap-1 text-xs cursor-pointer hover:opacity-80 transition-opacity',
            isLowConfidence
              ? 'border-warning/50 text-warning bg-warning/5'
              : 'border-success/50 text-success bg-success/5'
          )}
        >
          {isLowConfidence ? (
            <AlertTriangle className="h-3 w-3" />
          ) : (
            <CheckCircle2 className="h-3 w-3" />
          )}
          {isLowConfidence ? 'Low Confidence' : 'Data Extracted'}
        </Badge>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3" align="end">
        <div className="space-y-2 text-sm">
          <p className="font-medium">Extracted Income Data</p>
          {extraction.gross_pay != null && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Gross Pay</span>
              <span className="font-medium">${extraction.gross_pay.toLocaleString()}</span>
            </div>
          )}
          {extraction.net_pay != null && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Net Pay</span>
              <span className="font-medium">${extraction.net_pay.toLocaleString()}</span>
            </div>
          )}
          {extraction.pay_frequency && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Frequency</span>
              <span className="capitalize">{extraction.pay_frequency}</span>
            </div>
          )}
          {extraction.employer_name_on_doc && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Employer</span>
              <span className="truncate ml-2">{extraction.employer_name_on_doc}</span>
            </div>
          )}
          {extraction.pay_date && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Pay Date</span>
              <span>{extraction.pay_date}</span>
            </div>
          )}
          {extraction.ytd_gross != null && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">YTD Gross</span>
              <span className="font-medium">${extraction.ytd_gross.toLocaleString()}</span>
            </div>
          )}
          <div className="flex justify-between pt-1 border-t">
            <span className="text-muted-foreground">Confidence</span>
            <Badge
              variant="outline"
              className={cn(
                'text-xs',
                extraction.confidence === 'high' && 'text-success',
                extraction.confidence === 'medium' && 'text-info',
                extraction.confidence === 'low' && 'text-warning'
              )}
            >
              {extraction.confidence}
            </Badge>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
