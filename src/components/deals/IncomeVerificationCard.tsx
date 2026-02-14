import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DollarSign, TrendingUp, TrendingDown, Briefcase, AlertTriangle, FileSearch, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Deal } from '@/types/deal';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { IncomeSourceCard, type IncomeSource } from './IncomeSourceCard';
import { AddIncomeSourceDialog } from './AddIncomeSourceDialog';

interface IncomeVerificationCardProps {
  deal: Deal;
}

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
}

function calcMonthlyFromExtraction(grossPay: number, frequency: string): number {
  switch (frequency) {
    case 'weekly': return Math.round(grossPay * 4.33);
    case 'biweekly': return Math.round(grossPay * 2.17);
    case 'semimonthly': return Math.round(grossPay * 2);
    case 'monthly': return grossPay;
    default: return grossPay;
  }
}

export function IncomeVerificationCard({ deal }: IncomeVerificationCardProps) {
  const [addDialogOpen, setAddDialogOpen] = useState(false);

  // Query income sources
  const { data: incomeSources, refetch: refetchSources } = useQuery({
    queryKey: ['income-sources', deal.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('income_sources')
        .select('*')
        .eq('deal_id', deal.id)
        .order('is_primary', { ascending: false });
      if (error) throw error;
      return (data ?? []) as IncomeSource[];
    },
  });

  // Query extracted income data
  const { data: extractions } = useQuery({
    queryKey: ['extracted-income', deal.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('extracted_income_data')
        .select('*')
        .eq('deal_id', deal.id);
      if (error) throw error;
      return (data ?? []) as ExtractedIncome[];
    },
  });

  const hasMultiSource = incomeSources && incomeSources.length > 0;

  // --- Multi-source view ---
  if (hasMultiSource) {
    const totalStated = incomeSources.reduce((s, src) => s + src.stated_monthly_income, 0);
    const totalCalculated = incomeSources.reduce((s, src) => s + (src.calculated_monthly_income ?? src.stated_monthly_income), 0);
    const monthlyPayment = deal.financingTerms.monthlyPayment;
    const pti = totalCalculated > 0 ? ((monthlyPayment / totalCalculated) * 100).toFixed(1) : 'N/A';
    const ptiHealthy = typeof pti === 'string' ? false : parseFloat(pti) <= 20;

    const allFlags = incomeSources.flatMap(s => s.flag_reasons);
    // Check for multiple full-time overlap
    const fullTimeCount = incomeSources.filter(s => s.source_type === 'salaried').length;
    if (fullTimeCount > 1 && !allFlags.includes('Multiple full-time overlap')) {
      allFlags.push('Multiple full-time overlap');
    }

    return (
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <DollarSign className="h-5 w-5" />
              Income Verification
            </CardTitle>
            <Button variant="outline" size="sm" onClick={() => setAddDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-1" /> Add Source
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Total income summary */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-muted-foreground text-xs">Total Stated</p>
              <p className="font-bold text-lg">${totalStated.toLocaleString()}/mo</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Total Calculated</p>
              <p className="font-bold text-lg">${totalCalculated.toLocaleString()}/mo</p>
            </div>
          </div>

          {/* PTI */}
          <div className={cn(
            'p-3 rounded-lg border text-sm',
            ptiHealthy ? 'bg-success/5 border-success/20' : 'bg-warning/5 border-warning/20'
          )}>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Payment / Income</span>
              <span className={cn('font-bold', ptiHealthy ? 'text-success' : 'text-warning')}>
                {pti}%
              </span>
            </div>
          </div>

          {/* Source cards */}
          <div className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground">{incomeSources.length} Income Source{incomeSources.length !== 1 ? 's' : ''}</p>
            {incomeSources.map(src => (
              <IncomeSourceCard key={src.id} source={src} />
            ))}
          </div>

          {/* All flags */}
          {allFlags.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Fraud Flags</p>
              {allFlags.map((flag, i) => (
                <div key={i} className="flex items-center gap-1.5 text-xs text-warning">
                  <AlertTriangle className="h-3 w-3 shrink-0" />
                  {flag}
                </div>
              ))}
            </div>
          )}
        </CardContent>

        <AddIncomeSourceDialog
          open={addDialogOpen}
          onOpenChange={setAddDialogOpen}
          dealId={deal.id}
          customerId={deal.customer.id}
          onAdded={refetchSources}
        />
      </Card>
    );
  }

  // --- Legacy single-source fallback ---
  const statedIncome = deal.customer.employmentInfo?.monthlyIncome ?? 0;
  const employer = deal.customer.employmentInfo?.employer ?? 'Unknown';
  const jobTitle = deal.customer.employmentInfo?.jobTitle ?? 'Unknown';
  const yearsEmployed = deal.customer.employmentInfo?.yearsEmployed ?? 0;

  const hasExtractions = extractions && extractions.length > 0;
  const validExtractions = extractions?.filter(e => e.gross_pay != null && e.pay_frequency) ?? [];

  let calculatedIncome: number;
  let incomeSource: string;

  if (validExtractions.length > 0) {
    const sorted = [...validExtractions].sort((a, b) => {
      const confOrder = { high: 3, medium: 2, low: 1 };
      return (confOrder[b.confidence as keyof typeof confOrder] ?? 0) - (confOrder[a.confidence as keyof typeof confOrder] ?? 0);
    });
    const best = sorted[0];
    calculatedIncome = calcMonthlyFromExtraction(best.gross_pay!, best.pay_frequency!);
    incomeSource = `Extracted from document (${best.confidence} confidence)`;
  } else {
    const incomeDocs = deal.documents.filter(
      d => d.type === 'pay_stub' || d.type === 'bank_statement' || d.type === 'income_verification'
    );
    calculatedIncome = incomeDocs.length > 1
      ? Math.round(statedIncome * (0.95 + Math.random() * 0.1))
      : statedIncome;
    incomeSource = 'Estimated from application';
  }

  const incomeDelta = calculatedIncome - statedIncome;
  const deltaPercent = statedIncome > 0 ? ((incomeDelta / statedIncome) * 100).toFixed(1) : '0';
  const monthlyPayment = deal.financingTerms.monthlyPayment;
  const paymentToIncome = calculatedIncome > 0 ? ((monthlyPayment / calculatedIncome) * 100).toFixed(1) : 'N/A';
  const ratioHealthy = typeof paymentToIncome === 'string' ? false : parseFloat(paymentToIncome) <= 20;

  const flags: string[] = [];
  if (validExtractions.length > 0) {
    if (Math.abs(parseFloat(deltaPercent)) > 15) flags.push('Income variance > 15%');
    const best = validExtractions[0];
    if (best.employer_name_on_doc && employer !== 'Unknown') {
      const docEmp = best.employer_name_on_doc.toLowerCase().trim();
      const statedEmp = employer.toLowerCase().trim();
      if (!docEmp.includes(statedEmp) && !statedEmp.includes(docEmp)) flags.push('Employer name mismatch');
    }
    if (best.pay_date) {
      const days = (Date.now() - new Date(best.pay_date).getTime()) / (1000 * 60 * 60 * 24);
      if (days > 60) flags.push('Document > 60 days old');
    }
    if (best.confidence === 'low') flags.push('Low confidence extraction');
  }

  const incomeDocs = deal.documents.filter(
    d => d.type === 'pay_stub' || d.type === 'bank_statement' || d.type === 'income_verification'
  );
  const verifiedDocs = incomeDocs.filter(d => d.status === 'verified');

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <DollarSign className="h-5 w-5" />
            Income Verification
          </CardTitle>
          <Button variant="outline" size="sm" onClick={() => setAddDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Add Source
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
          <Briefcase className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
          <div className="text-sm">
            <p className="font-medium">{employer}</p>
            <p className="text-muted-foreground">{jobTitle} • {yearsEmployed} yr{yearsEmployed !== 1 ? 's' : ''}</p>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Stated Income</span>
            <span className="font-medium">${statedIncome.toLocaleString()}/mo</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Calculated Income</span>
            <span className="font-medium">${calculatedIncome.toLocaleString()}/mo</span>
          </div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <FileSearch className="h-3 w-3" />
            {incomeSource}
          </div>
          {incomeDelta !== 0 && (
            <div className={cn('flex items-center gap-1 text-xs', incomeDelta > 0 ? 'text-success' : 'text-warning')}>
              {incomeDelta > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {incomeDelta > 0 ? '+' : ''}{deltaPercent}% from stated
            </div>
          )}
        </div>

        {flags.length > 0 && (
          <div className="space-y-1.5">
            {flags.map((flag, i) => (
              <div key={i} className="flex items-center gap-1.5 text-xs text-warning">
                <AlertTriangle className="h-3 w-3 shrink-0" /> {flag}
              </div>
            ))}
          </div>
        )}

        <div className={cn(
          'p-3 rounded-lg border text-sm',
          ratioHealthy ? 'bg-success/5 border-success/20' : 'bg-warning/5 border-warning/20'
        )}>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Payment / Income</span>
            <span className={cn('font-bold', ratioHealthy ? 'text-success' : 'text-warning')}>{paymentToIncome}%</span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">${monthlyPayment.toLocaleString()} / ${calculatedIncome.toLocaleString()}</p>
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{verifiedDocs.length}/{incomeDocs.length} income documents verified</span>
          {hasExtractions && (
            <Badge variant="outline" className="text-xs text-success border-success/30">
              {validExtractions.length} extracted
            </Badge>
          )}
        </div>
      </CardContent>

      <AddIncomeSourceDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        dealId={deal.id}
        customerId={deal.customer.id}
        onAdded={refetchSources}
      />
    </Card>
  );
}
