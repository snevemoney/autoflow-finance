import { useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DollarSign, TrendingUp, TrendingDown, Briefcase, AlertTriangle, FileSearch, Plus, ClipboardCheck, Ban, ChevronDown, ChevronUp, Calculator } from 'lucide-react';
import { IncomeCalculator } from './IncomeCalculator';
import { IncomeDocPreview } from './IncomeDocPreview';
import { cn } from '@/lib/utils';
import type { Deal } from '@/types/deal';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { IncomeSourceCard, type IncomeSource } from './IncomeSourceCard';
import { AddIncomeSourceDialog } from './AddIncomeSourceDialog';
import { UnmatchedExtractionRow } from './UnmatchedExtractionRow';
import type { ApplicantDebt } from './ApplicantDebtsCard';

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
  income_source_id: string | null;
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

/** Try to match an extraction to an income source by employer name similarity */
function findMatchingSource(extraction: ExtractedIncome, sources: IncomeSource[]): IncomeSource | null {
  if (!extraction.employer_name_on_doc) return null;
  const docEmp = extraction.employer_name_on_doc.toLowerCase().trim();
  
  for (const source of sources) {
    const srcEmp = source.employer_name.toLowerCase().trim();
    if (docEmp.includes(srcEmp) || srcEmp.includes(docEmp)) {
      return source;
    }
  }
  return null;
}

export function IncomeVerificationCard({ deal }: IncomeVerificationCardProps) {
  // Query applicant debts for DTI calculation
  const { data: debts = [] } = useQuery({
    queryKey: ['applicant-debts', deal.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('applicant_debts')
        .select('*')
        .eq('deal_id', deal.id);
      if (error) throw error;
      return (data ?? []) as ApplicantDebt[];
    },
  });
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [legacyCalcOpen, setLegacyCalcOpen] = useState(false);
  const [legacyFillHandler, setLegacyFillHandler] = useState<((field: string, value: string) => void) | null>(null);
  const handleLegacyFillReady = useCallback((handler: (field: string, value: string) => void) => {
    setLegacyFillHandler(() => handler);
  }, []);
  const matchedRef = useRef<Set<string>>(new Set());

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

  // Auto-create income source from deal employment info when none exist
  const autoCreatedRef = useRef(false);
  useEffect(() => {
    if (autoCreatedRef.current) return;
    if (incomeSources === undefined) return; // still loading
    if (incomeSources.length > 0) return; // already have sources
    if (!deal.customer.employmentInfo) return; // no employment data to seed

    autoCreatedRef.current = true;
    const emp = deal.customer.employmentInfo;
    supabase.from('income_sources').insert({
      deal_id: deal.id,
      customer_id: deal.customer.id,
      employer_name: emp.employer,
      job_title: emp.jobTitle ?? null,
      source_type: 'salaried' as any,
      stated_monthly_income: emp.monthlyIncome,
      calculated_monthly_income: emp.monthlyIncome,
      is_primary: true,
      verification_status: 'unverified' as any,
      calc_method: 'mi',
    }).then(({ error }) => {
      if (!error) refetchSources();
    });
  }, [incomeSources, deal.id, deal.customer]);

  // Auto-match unlinked extractions to income sources and update calculated income
  useEffect(() => {
    if (!extractions || !incomeSources || incomeSources.length === 0) return;

    const unlinked = extractions.filter(
      e => !e.income_source_id && e.gross_pay != null && e.pay_frequency && !matchedRef.current.has(e.id)
    );

    for (const extraction of unlinked) {
      const match = findMatchingSource(extraction, incomeSources);
      if (!match) continue;

      matchedRef.current.add(extraction.id);
      const calculatedMonthly = calcMonthlyFromExtraction(extraction.gross_pay!, extraction.pay_frequency!);

      // Link extraction to income source
      supabase.from('extracted_income_data')
        .update({ income_source_id: match.id })
        .eq('id', extraction.id)
        .then(() => {});

      // Update income source calculated income + fraud flags
      const flags = [...(match.flag_reasons || [])];
      const variance = match.stated_monthly_income > 0
        ? Math.abs((calculatedMonthly - match.stated_monthly_income) / match.stated_monthly_income) * 100
        : 0;
      if (variance > 15 && !flags.includes('Income variance > 15%')) {
        flags.push('Income variance > 15%');
      }
      if (extraction.employer_name_on_doc) {
        const docEmp = extraction.employer_name_on_doc.toLowerCase().trim();
        const srcEmp = match.employer_name.toLowerCase().trim();
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

      supabase.from('income_sources')
        .update({
          calculated_monthly_income: calculatedMonthly,
          flag_reasons: flags,
        })
        .eq('id', match.id)
        .then(() => refetchSources());
    }
  }, [extractions, incomeSources]);

  // Build a map of income_source_id → extractions for display
  const extractionsBySource: Record<string, ExtractedIncome[]> = {};
  if (extractions) {
    for (const e of extractions) {
      if (e.income_source_id) {
        if (!extractionsBySource[e.income_source_id]) extractionsBySource[e.income_source_id] = [];
        extractionsBySource[e.income_source_id].push(e);
      }
    }
  }

  const hasMultiSource = incomeSources && incomeSources.length > 0;

  // --- Multi-source view ---
  if (hasMultiSource) {
    const totalStated = incomeSources.reduce((s, src) => s + src.stated_monthly_income, 0);
    // Use analyst-set calculated income; for benefit types pending review, show stated as pending
    const totalCalculated = incomeSources.reduce((s, src) => s + (src.calculated_monthly_income ?? src.stated_monthly_income), 0);
    const hasMissedDays = incomeSources.some(s => s.missed_days_flag);
    const hasNeedsReview = incomeSources.some(s => s.verification_status === 'needs_review');
    const hasVehicleForWork = incomeSources.some(s => (s as any).vehicle_for_work);
    const monthlyPayment = deal.financingTerms.monthlyPayment;
    const pti = totalCalculated > 0 ? ((monthlyPayment / totalCalculated) * 100).toFixed(1) : 'N/A';
    const ptiHealthy = typeof pti === 'string' ? false : parseFloat(pti) <= 20;

    const allFlags = incomeSources.flatMap(s => s.flag_reasons);
    const fullTimeCount = incomeSources.filter(s => s.source_type === 'salaried').length;
    if (fullTimeCount > 1 && !allFlags.includes('Multiple full-time overlap')) {
      allFlags.push('Multiple full-time overlap');
    }

    // Count linked extractions
    const linkedCount = extractions?.filter(e => e.income_source_id).length ?? 0;
    const unlinkedCount = extractions?.filter(e => !e.income_source_id && e.gross_pay != null).length ?? 0;

    return (
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <DollarSign className="h-4 w-4" />
              Income Verification
            </CardTitle>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setAddDialogOpen(true)}>
              <Plus className="h-3 w-3 mr-1" /> Add Source
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 px-4 pb-4 pt-0">
          {/* Review required banner */}
          {hasNeedsReview && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-info/10 border border-info/30 text-sm">
              <ClipboardCheck className="h-4 w-4 text-info shrink-0" />
              <span className="text-info font-medium">Review Required — one or more income sources need additional documentation</span>
            </div>
          )}

          {/* Vehicle for work ineligible banner */}
          {hasVehicleForWork && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-sm">
              <Ban className="h-4 w-4 text-destructive shrink-0" />
              <span className="text-destructive font-medium">INELIGIBLE — Vehicle cannot be used for rideshare/commercial work. Deal should be declined.</span>
            </div>
          )}


          {hasMissedDays && (
            <div className="flex items-center gap-2 text-xs">
              <Badge variant="outline" className="text-warning border-warning/30">
                <AlertTriangle className="h-3 w-3 mr-1" />
                Missed work days detected
              </Badge>
            </div>
          )}

          {/* Total income summary */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-muted-foreground text-xs">Total Stated</p>
              <p className="font-bold text-base">${totalStated.toLocaleString()}/mo</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Total Calculated</p>
              <p className="font-bold text-base">${totalCalculated.toLocaleString()}/mo</p>
            </div>
          </div>

          {/* PTI */}
          <div className={cn(
            'p-2 rounded-md border text-xs',
            ptiHealthy ? 'bg-success/5 border-success/20' : 'bg-warning/5 border-warning/20'
          )}>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Payment / Income</span>
              <span className={cn('font-semibold', ptiHealthy ? 'text-success' : 'text-warning')}>
                {pti}%
              </span>
            </div>
          </div>

          {/* DTI (including debts) */}
          {debts.length > 0 && (() => {
            const totalDebtPayments = debts.reduce((s, d) => s + d.monthly_payment, 0);
            const dti = totalCalculated > 0
              ? (((monthlyPayment + totalDebtPayments) / totalCalculated) * 100).toFixed(1)
              : 'N/A';
            const dtiHealthy = typeof dti === 'string' ? false : parseFloat(dti) <= 45;
            return (
              <div className={cn(
                'p-2 rounded-md border text-xs',
                dtiHealthy ? 'bg-success/5 border-success/20' : 'bg-destructive/5 border-destructive/20'
              )}>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">DTI (Payment + Debts)</span>
                  <span className={cn('font-semibold', dtiHealthy ? 'text-success' : 'text-destructive')}>
                    {dti}%
                  </span>
                </div>
              </div>
            );
          })()}

          {/* OCR linkage summary */}
          {(linkedCount > 0 || unlinkedCount > 0) && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <FileSearch className="h-3 w-3" />
              {linkedCount > 0 && (
                <Badge variant="outline" className="text-xs text-success border-success/30">
                  {linkedCount} extraction{linkedCount !== 1 ? 's' : ''} linked
                </Badge>
              )}
              {unlinkedCount > 0 && (
                <Badge variant="outline" className="text-xs text-warning border-warning/30">
                  {unlinkedCount} unmatched
                </Badge>
              )}
            </div>
          )}

          {/* Unmatched extractions - manual linking */}
          {(() => {
            const unmatchedExtractions = extractions?.filter(
              e => !e.income_source_id && e.gross_pay != null
            ) ?? [];
            if (unmatchedExtractions.length === 0) return null;
            return (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Unmatched Extractions — assign manually</p>
                {unmatchedExtractions.map(ext => (
                  <UnmatchedExtractionRow
                    key={ext.id}
                    extraction={ext}
                    incomeSources={incomeSources}
                    onLinked={() => { refetchSources(); }}
                  />
                ))}
              </div>
            );
          })()}

          {/* Source cards */}
          <div className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground">{incomeSources.length} Income Source{incomeSources.length !== 1 ? 's' : ''}</p>
            {incomeSources.map(src => (
              <IncomeSourceCard
                key={src.id}
                source={src}
                linkedExtractions={extractionsBySource[src.id]}
                onUpdated={refetchSources}
              />
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

        {/* Income Calculator toggle */}
        <div className="border-t border-border pt-3">
          <button
            onClick={() => setLegacyCalcOpen(!legacyCalcOpen)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
          >
            {legacyCalcOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            <Calculator className="h-3 w-3" />
            Income Calculator
          </button>
          {legacyCalcOpen && (
            <div className="mt-2">
              <IncomeCalculator
                sourceId={`legacy-${deal.id}`}
                dealId={deal.id}
                sourceType="salaried"
                statedMonthlyIncome={statedIncome}
                calculatedMonthlyIncome={calculatedIncome}
                currentCalcMethod="mi"
                currentTipPercentage={null}
                currentYtdGross={null}
                currentYtdMonths={null}
                currentManualAmount={null}
                currentManualReason={null}
                currentHourlyRate={null}
                currentHoursPerWeek={null}
                currentPayFrequency={null}
                missedDaysFlag={false}
                additionalDocsRequested={[]}
                vehicleForWork={false}
                contractMonths={null}
                sourceCreatedAt={deal.createdAt}
                onUpdated={() => {}}
                onFillFieldReady={handleLegacyFillReady}
              />
              <IncomeDocPreview dealId={deal.id} sourceId={`legacy-${deal.id}`} onClickFill={legacyFillHandler ?? undefined} />
            </div>
          )}
        </div>

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
