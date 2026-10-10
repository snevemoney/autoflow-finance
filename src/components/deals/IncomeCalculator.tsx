import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Calculator, AlertTriangle, FileText, Loader2, Ban, ShieldAlert, FileDown, TrendingUp, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DroppableInput } from './DroppableInput';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { addTimelineNote, updateIncomeSource } from '@/hooks/use-income';
import { errorMessage } from '@/lib/rpc';
import { cn } from '@/lib/utils';
import { diagnoseGap } from '@/lib/income-diagnosis';
import {
  computeMonthlyIncome, DEFAULT_BENEFIT_PERCENT, formatMoney, FREQUENCY_FORMULA, FREQUENCY_LABELS, isBenefitType, isPayFrequency,
  miValue, miYtdGapPercent, PAY_FREQUENCIES, parseAmount, ytdValue, type CalcMethod, type IncomeInputs, type MiInputMode, type PayFrequency,
} from '@/lib/income-math';

export type { CalcMethod };

interface IncomeCalculatorProps {
  sourceId: string;
  dealId: string;
  sourceType: string;
  statedMonthlyIncome: number;
  calculatedMonthlyIncome: number | null;
  currentCalcMethod: CalcMethod;
  currentTipPercentage: number | null;
  currentYtdGross: number | null;
  currentYtdMonths: number | null;
  currentManualAmount: number | null;
  currentManualReason: string | null;
  currentHourlyRate: number | null;
  currentHoursPerWeek: number | null;
  currentPayFrequency: string | null;
  /** gross pay per period, pre-filled by the income auto-fill */
  currentGrossPerPeriod?: number | null;
  missedDaysFlag: boolean;
  additionalDocsRequested: string[];
  vehicleForWork: boolean;
  contractMonths?: number | null;
  /** an analyst already applied a figure; auto-fill leaves it alone */
  calcLocked?: boolean;
  sourceCreatedAt?: string | null;
  onUpdated: () => void;
  onFillFieldReady?: (handler: (field: string, value: string) => void) => void;
}

const CALC_METHODS: { value: CalcMethod; label: string; short: string }[] = [
  { value: 'mi', label: 'Monthly income from the current pay stub', short: 'MI' },
  { value: 'ytd', label: 'Year-to-date average', short: 'YTD' },
  { value: 'lower_of', label: 'Lower of MI and YTD', short: 'Lower' },
  { value: 'mi_plus_10', label: 'MI plus 10% tips', short: 'MI+10' },
  { value: 'mi_plus_20', label: 'MI plus 20% tips', short: 'MI+20' },
  { value: 'manual', label: 'Manual override', short: 'Manual' },
];

const str = (n: number | null | undefined) => (n == null ? '' : String(n));
const GAP_FLAG = 'MI vs YTD gap:';

export function IncomeCalculator({
  sourceId, dealId, sourceType, statedMonthlyIncome, currentCalcMethod, currentTipPercentage, currentYtdGross, currentYtdMonths,
  currentManualAmount, currentManualReason, currentHourlyRate, currentHoursPerWeek, currentPayFrequency, currentGrossPerPeriod,
  missedDaysFlag, additionalDocsRequested, vehicleForWork, contractMonths, calcLocked, onUpdated, onFillFieldReady,
}: IncomeCalculatorProps) {
  const benefit = isBenefitType(sourceType);
  const isBusiness = sourceType === 'self_employed' || sourceType === 'contractor';
  const [method, setMethod] = useState<CalcMethod>(currentCalcMethod ?? 'mi');
  const [ytdGross, setYtdGross] = useState(str(currentYtdGross));
  const [ytdMonths, setYtdMonths] = useState(str(currentYtdMonths));
  const [manualAmount, setManualAmount] = useState(str(currentManualAmount));
  const [manualReason, setManualReason] = useState(currentManualReason ?? '');
  const [benefitPercent, setBenefitPercent] = useState(benefit && currentTipPercentage != null ? String(currentTipPercentage) : String(DEFAULT_BENEFIT_PERCENT));
  const [miMode, setMiMode] = useState<MiInputMode>(currentHourlyRate ? 'hourly' : 'salary');
  const [grossPerPeriod, setGrossPerPeriod] = useState(str(currentGrossPerPeriod));
  const [payFrequency, setPayFrequency] = useState<PayFrequency>(isPayFrequency(currentPayFrequency) ? currentPayFrequency : 'biweekly');
  const [hourlyRate, setHourlyRate] = useState(str(currentHourlyRate));
  const [hoursPerWeek, setHoursPerWeek] = useState(str(currentHoursPerWeek));
  const [saving, setSaving] = useState(false);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout>>();

  const fillField = useCallback((field: string, value: string) => {
    switch (field) {
      case 'grossPerPeriod': setGrossPerPeriod(value); setMiMode('salary'); setMethod((m) => (m === 'manual' || m === 'ytd' ? 'mi' : m)); break;
      case 'hourlyRate': setHourlyRate(value); setMiMode('hourly'); break;
      case 'hoursPerWeek': setHoursPerWeek(value); setMiMode('hourly'); break;
      case 'ytdGross': setYtdGross(value); setMethod((m) => (m === 'mi' || m === 'manual' ? 'lower_of' : m)); break;
      case 'ytdMonths': setYtdMonths(value); break;
      case 'manualAmount': setManualAmount(value); setMethod('manual'); break;
      case 'payFrequency': if (isPayFrequency(value)) setPayFrequency(value); break;
    }
    setHighlighted(field);
    clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlighted(null), 700);
  }, []);

  useEffect(() => { onFillFieldReady?.(fillField); }, [fillField, onFillFieldReady]);
  useEffect(() => () => clearTimeout(highlightTimer.current), []);

  const inputs: IncomeInputs = useMemo(() => ({
    method,
    sourceType,
    miMode,
    grossPerPeriod: parseAmount(grossPerPeriod),
    payFrequency,
    hourlyRate: parseAmount(hourlyRate),
    hoursPerWeek: parseAmount(hoursPerWeek),
    ytdGross: parseAmount(ytdGross),
    ytdMonths: parseAmount(ytdMonths), // fractional months (8.8) are fine
    manualAmount: parseAmount(manualAmount),
    benefitPercent: parseAmount(benefitPercent),
  }), [method, sourceType, miMode, grossPerPeriod, payFrequency, hourlyRate, hoursPerWeek, ytdGross, ytdMonths, manualAmount, benefitPercent]);

  const result = computeMonthlyIncome(inputs);
  const mi = miValue(inputs);
  const ytd = ytdValue(inputs);
  const gap = mi != null && ytd != null ? miYtdGapPercent(mi, ytd) : null;
  const diagnosis = gap != null && gap > 10 && mi != null && ytd != null
    ? diagnoseGap({ sourceType, mi, ytd, ytdMonths: inputs.ytdMonths ?? 0, payFrequency, contractMonths })
    : null;

  const availableMethods = benefit ? CALC_METHODS.filter((m) => ['mi', 'ytd', 'lower_of', 'manual'].includes(m.value)) : CALC_METHODS;
  const showMi = method === 'mi' || method === 'mi_plus_10' || method === 'mi_plus_20' || method === 'lower_of';
  const showYtd = method === 'ytd' || method === 'lower_of';
  const id = (k: string) => `calc-${sourceId}-${k}`;
  const canApply = result != null && (method !== 'manual' || manualReason.trim().length > 0);

  const handleApply = async () => {
    if (method === 'manual' && !manualReason.trim()) {
      toast({ title: 'A manual override needs a reason', variant: 'destructive' });
      return;
    }
    if (result == null) {
      toast({ title: 'Enter the pay figures first', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const pct = benefit && method !== 'manual' ? Math.round(Math.max(0, Math.min(100, inputs.benefitPercent ?? DEFAULT_BENEFIT_PERCENT))) : null;
      const tips = method === 'mi_plus_10' ? 10 : method === 'mi_plus_20' ? 20 : null;
      const { data: current } = await supabase.from('income_sources').select('flag_reasons, verification_status').eq('id', sourceId).maybeSingle();
      let flags: string[] = (current?.flag_reasons as string[] | null) ?? [];
      const variance = statedMonthlyIncome > 0 ? Math.abs(result - statedMonthlyIncome) / statedMonthlyIncome : 0;
      if (variance > 0.15 && !flags.includes('Income variance > 15%')) flags = [...flags, 'Income variance > 15%'];
      flags = flags.filter((f) => !f.startsWith(GAP_FLAG));
      if (gap != null && gap > 20) flags = [...flags, `${GAP_FLAG} ${gap}%`];

      await updateIncomeSource(sourceId, {
        calc_method: method,
        tip_percentage: benefit ? pct : tips,
        calculated_monthly_income: result,
        benefit_cap_applied: benefit && method !== 'manual',
        pay_frequency: payFrequency,
        gross_per_period: miMode === 'salary' && Number.isFinite(inputs.grossPerPeriod) ? inputs.grossPerPeriod : null,
        hourly_rate: miMode === 'hourly' && Number.isFinite(inputs.hourlyRate) ? inputs.hourlyRate : null,
        hours_per_week: miMode === 'hourly' && Number.isFinite(inputs.hoursPerWeek) ? inputs.hoursPerWeek : null,
        ytd_gross: Number.isFinite(inputs.ytdGross) ? inputs.ytdGross : null,
        ytd_months: Number.isFinite(inputs.ytdMonths) ? inputs.ytdMonths : null,
        manual_override_amount: method === 'manual' ? result : null,
        manual_override_reason: method === 'manual' ? manualReason.trim() : null,
        flag_reasons: flags,
        ...(gap != null && gap > 20 && current?.verification_status === 'unverified' ? { verification_status: 'flagged' } : {}),
        // an analyst's figure is final: auto-fill must not overwrite it
        calc_locked: true,
      });

      const label = CALC_METHODS.find((m) => m.value === method)?.short ?? method;
      await addTimelineNote(dealId, `Income calculation applied: ${label} → ${formatMoney(result, { cents: true })}/mo`, {
        action: 'income_calculation', method, calculated_amount: result, stated_amount: statedMonthlyIncome,
        ...(gap != null ? { mi_value: mi, ytd_value: ytd, gap_percent: gap } : {}),
        ...(diagnosis && gap != null && gap > 20 ? { diagnosis_reasons: diagnosis.reasons } : {}),
      });
      toast({
        title: `Calculation applied: ${label}`,
        description: variance > 0.15 ? `${Math.round(variance * 100)}% different from the stated income` : 'Within 15% of the stated income',
      });
      onUpdated();
    } catch (err) {
      toast({ title: 'Could not apply the calculation', description: errorMessage(err), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const requestDocs = async (docs: string[], reason: 'missed_days' | 'gap') => {
    setSaving(true);
    try {
      const all = [...new Set([...(additionalDocsRequested ?? []), ...docs])];
      await updateIncomeSource(sourceId, reason === 'missed_days'
        ? { missed_days_flag: true, additional_docs_requested: all, verification_status: 'needs_review' }
        : { additional_docs_requested: all });
      const { error } = await supabase.rpc('request_document', { _deal_id: dealId, _doc_type: 'bank_statement', _message: docs.join(', ') });
      await addTimelineNote(dealId, `Documents requested for income: ${docs.join(', ')}`, { action: 'income_doc_request', requested_docs: docs, gap_percent: gap });
      toast({ title: 'Documents requested', description: error ? docs.join(', ') : 'The dealer has been asked in their portal.' });
      onUpdated();
    } catch (err) {
      toast({ title: 'Could not request the documents', description: errorMessage(err), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  if (vehicleForWork) {
    return (
      <div className="space-y-2 p-3 rounded-lg border border-destructive bg-destructive/5">
        <div className="flex items-center gap-2 text-sm font-medium text-destructive"><Ban className="h-4 w-4" aria-hidden /> Not eligible — vehicle used for rideshare/commercial work</div>
        <p className="text-xs text-muted-foreground">The applicant uses the financed vehicle for rideshare or commercial work, which policy does not allow.</p>
      </div>
    );
  }

  const hl = (field: string) => (highlighted === field ? 'animate-fill-highlight' : '');
  const already = additionalDocsRequested ?? [];

  return (
    <div className="space-y-3 p-3 rounded-lg border border-border bg-muted/30">
      <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
        <Calculator className="h-4 w-4 text-primary" aria-hidden /> Income calculator
        {calcLocked && (
          <Badge variant="outline" className="text-xs gap-1" title="Auto-fill won't change an applied figure">
            <Lock className="h-3 w-3" aria-hidden /> Applied by an analyst
          </Badge>
        )}
        {benefit && (
          <Badge variant="outline" className="text-xs text-warning border-warning/30 ml-auto"><ShieldAlert className="h-3 w-3 mr-1" aria-hidden /> Benefits review</Badge>
        )}
      </div>

      {benefit && method !== 'manual' && (
        <div className="space-y-1.5">
          <p className="text-xs text-info bg-info/10 rounded-md px-2 py-1.5 border border-info/20">
            Benefit income: only a share counts toward qualifying income{method === 'lower_of' ? ' (applied to the lower of MI and YTD)' : ''}.
          </p>
          <div className="flex items-center gap-2">
            <Label htmlFor={id('benefit')} className="text-xs whitespace-nowrap">Share that counts (%)</Label>
            <Input id={id('benefit')} inputMode="decimal" value={benefitPercent} onChange={(e) => setBenefitPercent(e.target.value)} className="h-8 text-xs w-20" />
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Calculation method">
        {availableMethods.map((m) => (
          <button key={m.value} type="button" onClick={() => setMethod(m.value)} aria-pressed={method === m.value} title={m.label}
            className={cn('px-2.5 py-1 text-xs rounded-md border transition-colors',
              method === m.value ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border text-muted-foreground hover:text-foreground hover:border-foreground/30')}>
            {m.short}<span className="sr-only"> — {m.label}</span>
          </button>
        ))}
      </div>

      {showMi && (
        <div className="space-y-2">
          <div className="flex gap-1" role="group" aria-label="Pay basis">
            {(['salary', 'hourly'] as const).map((mode) => (
              <button key={mode} type="button" onClick={() => setMiMode(mode)} aria-pressed={miMode === mode}
                className={cn('px-2 py-0.5 text-xs rounded border transition-colors',
                  miMode === mode ? 'bg-secondary text-secondary-foreground border-border' : 'bg-background border-border text-muted-foreground hover:text-foreground')}>
                {mode === 'salary' ? 'Pay per period' : 'Hourly'}
              </button>
            ))}
          </div>
          {miMode === 'salary' ? (
            <div className="grid grid-cols-1 min-[380px]:grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor={id('gross')} className="text-xs">Gross per period ($)</Label>
                <DroppableInput id={id('gross')} acceptField="grossPerPeriod" inputMode="decimal" value={grossPerPeriod}
                  onChange={(e) => setGrossPerPeriod(e.target.value)} onDropValue={(v) => fillField('grossPerPeriod', v)}
                  placeholder="2100" className={cn('h-8 text-xs', hl('grossPerPeriod'))} />
              </div>
              <div className="space-y-1">
                <Label htmlFor={id('freq')} className="text-xs">Pay frequency</Label>
                <Select value={payFrequency} onValueChange={(v) => setPayFrequency(v as PayFrequency)}>
                  <SelectTrigger id={id('freq')} className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{PAY_FREQUENCIES.map((f) => <SelectItem key={f} value={f} className="text-xs">{FREQUENCY_LABELS[f]}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {mi != null && (
                <p className="col-span-full text-xs text-muted-foreground">
                  {formatMoney(inputs.grossPerPeriod, { cents: true })} {FREQUENCY_FORMULA[payFrequency]} = <span className="font-medium text-foreground">{formatMoney(mi, { cents: true })}/mo</span>
                </p>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 min-[380px]:grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor={id('rate')} className="text-xs">Hourly rate ($)</Label>
                <DroppableInput id={id('rate')} acceptField="hourlyRate" inputMode="decimal" value={hourlyRate}
                  onChange={(e) => setHourlyRate(e.target.value)} onDropValue={(v) => fillField('hourlyRate', v)}
                  placeholder="18.50" className={cn('h-8 text-xs', hl('hourlyRate'))} />
              </div>
              <div className="space-y-1">
                <Label htmlFor={id('hours')} className="text-xs">Hours per week</Label>
                <DroppableInput id={id('hours')} acceptField="hoursPerWeek" inputMode="decimal" value={hoursPerWeek}
                  onChange={(e) => setHoursPerWeek(e.target.value)} onDropValue={(v) => fillField('hoursPerWeek', v)}
                  placeholder="40" className={cn('h-8 text-xs', hl('hoursPerWeek'))} />
              </div>
              {mi != null && (
                <p className="col-span-full text-xs text-muted-foreground">
                  {formatMoney(inputs.hourlyRate, { cents: true })}/hr × {inputs.hoursPerWeek} hrs × 52 ÷ 12 = <span className="font-medium text-foreground">{formatMoney(mi, { cents: true })}/mo</span>
                </p>
              )}
            </div>
          )}
        </div>
      )}

      <p className="text-xs text-muted-foreground">Stated income: <span className="font-medium text-foreground">{formatMoney(statedMonthlyIncome)}/mo</span></p>

      {showYtd && (
        <div className="grid grid-cols-1 min-[380px]:grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor={id('ytd')} className="text-xs">YTD gross ($)</Label>
            <DroppableInput id={id('ytd')} acceptField="ytdGross" inputMode="decimal" value={ytdGross}
              onChange={(e) => setYtdGross(e.target.value)} onDropValue={(v) => fillField('ytdGross', v)}
              placeholder="25200" className={cn('h-8 text-xs', hl('ytdGross'))} />
          </div>
          <div className="space-y-1">
            <Label htmlFor={id('months')} className="text-xs">Months covered</Label>
            <DroppableInput id={id('months')} acceptField="ytdMonths" inputMode="decimal" value={ytdMonths}
              onChange={(e) => setYtdMonths(e.target.value)} onDropValue={(v) => fillField('ytdMonths', v)}
              placeholder="8.8" className={cn('h-8 text-xs', hl('ytdMonths'))} />
          </div>
          {ytd != null && (
            <p className="col-span-full text-xs text-muted-foreground">
              {formatMoney(inputs.ytdGross, { cents: true })} ÷ {inputs.ytdMonths} months = <span className="font-medium text-foreground">{formatMoney(ytd, { cents: true })}/mo</span>
            </p>
          )}
        </div>
      )}

      {(method === 'mi_plus_10' || method === 'mi_plus_20') && mi != null && result != null && (
        <p className="text-xs text-muted-foreground">Tips: <span className="font-medium text-foreground">+{method === 'mi_plus_10' ? 10 : 20}% = {formatMoney(result - mi, { cents: true })}</span></p>
      )}

      {method === 'manual' && (
        <div className="space-y-2">
          <div className="space-y-1">
            <Label htmlFor={id('manual')} className="text-xs">Override amount ($/mo)</Label>
            <DroppableInput id={id('manual')} acceptField="manualAmount" inputMode="decimal" value={manualAmount}
              onChange={(e) => setManualAmount(e.target.value)} onDropValue={(v) => fillField('manualAmount', v)}
              placeholder="4500" className={cn('h-8 text-xs', hl('manualAmount'))} />
          </div>
          <div className="space-y-1">
            <Label htmlFor={id('reason')} className="text-xs">Reason (required)</Label>
            <Textarea id={id('reason')} value={manualReason} onChange={(e) => setManualReason(e.target.value)}
              placeholder="Why the calculated figure doesn't apply…" className="text-xs min-h-[50px] resize-none" />
          </div>
        </div>
      )}

      {gap != null && mi != null && ytd != null && (
        <div className={cn('p-2.5 rounded-md border space-y-1.5',
          gap <= 10 ? 'bg-success/5 border-success/20' : gap <= 20 ? 'bg-warning/10 border-warning/30' : 'bg-destructive/5 border-destructive/20')}>
          <div className="flex items-center justify-between text-xs font-medium">
            <span className={gap <= 10 ? 'text-success' : gap <= 20 ? 'text-warning' : 'text-destructive'}>MI vs YTD cross-check</span>
            <span className={cn('font-mono', gap <= 10 ? 'text-success' : gap <= 20 ? 'text-warning' : 'text-destructive')}>{gap}% gap</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
            <span>MI: <span className="font-medium text-foreground">{formatMoney(mi, { cents: true })}/mo</span></span>
            <span>YTD: <span className="font-medium text-foreground">{formatMoney(ytd, { cents: true })}/mo</span></span>
          </div>
          {diagnosis && (
            <>
              <ul className="space-y-1 pt-0.5 text-xs text-muted-foreground">
                {diagnosis.reasons.map((r) => <li key={r} className="flex gap-1.5"><span className="text-warning" aria-hidden>•</span>{r}</li>)}
              </ul>
              <div className="flex items-start gap-2 pt-1 border-t border-border/50 text-xs">
                <TrendingUp className="h-3.5 w-3.5 shrink-0 text-primary mt-0.5" aria-hidden />
                <div className="flex-1 space-y-1.5">
                  <p><span className="font-medium text-primary">Suggested: {diagnosis.method === 'mi' ? 'MI' : 'YTD'}</span><span className="text-muted-foreground"> — {diagnosis.why}</span></p>
                  {method !== diagnosis.method && (
                    <Button type="button" variant="outline" size="sm" className="h-6 text-xs" onClick={() => setMethod(diagnosis.method)}>Switch to {diagnosis.method === 'mi' ? 'MI' : 'YTD'}</Button>
                  )}
                </div>
              </div>
              <div className="space-y-1.5 pt-1 border-t border-border/50">
                <p className="text-xs font-medium text-muted-foreground flex items-center gap-1"><FileDown className="h-3 w-3" aria-hidden /> Documents that settle it</p>
                <div className="flex flex-wrap gap-1">
                  {diagnosis.docs.map((d) => (
                    <Badge key={d} variant="outline" className={cn('text-xs', already.includes(d) && 'bg-success/10 text-success border-success/30')}>{already.includes(d) ? '✓ ' : ''}{d}</Badge>
                  ))}
                </div>
                {diagnosis.docs.some((d) => !already.includes(d)) ? (
                  <Button type="button" variant="outline" size="sm" className="h-7 text-xs w-full" disabled={saving}
                    onClick={() => requestDocs(diagnosis.docs.filter((d) => !already.includes(d)), 'gap')}>
                    {saving ? <Loader2 className="h-3 w-3 mr-1 animate-spin" aria-hidden /> : <FileDown className="h-3 w-3 mr-1" aria-hidden />}
                    Request {diagnosis.docs.filter((d) => !already.includes(d)).length} document(s)
                  </Button>
                ) : <p className="text-xs text-success flex items-center gap-1"><FileText className="h-3 w-3" aria-hidden /> All already requested</p>}
              </div>
            </>
          )}
        </div>
      )}

      {result != null && (
        <div className="p-2.5 rounded-md bg-primary/5 border border-primary/20 text-center space-y-1" aria-live="polite">
          <p className="text-xs text-muted-foreground">{method === 'lower_of' ? 'Lower of MI and YTD' : 'Calculated income'}{benefit && method !== 'manual' ? ` × ${inputs.benefitPercent ?? DEFAULT_BENEFIT_PERCENT}%` : ''}</p>
          <p className="text-lg font-bold text-primary">{formatMoney(result, { cents: true })}/mo</p>
          {method === 'lower_of' && (mi == null || ytd == null) && <p className="text-xs text-muted-foreground">Enter both MI and YTD to compare.</p>}
        </div>
      )}

      {missedDaysFlag ? (
        <div className="p-2.5 rounded-md bg-warning/10 border border-warning/30 space-y-2">
          <p className="flex items-center gap-1.5 text-xs text-warning font-medium"><AlertTriangle className="h-3.5 w-3.5" aria-hidden /> Possible missed work days</p>
          {already.length > 0
            ? <p className="flex items-center gap-1 text-xs text-success"><FileText className="h-3 w-3" aria-hidden /> Requested: {already.join(', ')}</p>
            : <Button type="button" variant="outline" size="sm" className="h-7 text-xs w-full" disabled={saving}
                onClick={() => requestDocs([isBusiness ? '12 months bank statements' : '3 months bank statements'], 'missed_days')}>Request bank statements</Button>}
        </div>
      ) : (
        <button type="button" disabled={saving} className="text-xs text-muted-foreground hover:text-warning transition-colors flex items-center gap-1"
          onClick={() => requestDocs([isBusiness ? '12 months bank statements' : '3 months bank statements'], 'missed_days')}>
          <AlertTriangle className="h-3 w-3" aria-hidden /> Flag missed work days
        </button>
      )}

      <Button type="button" size="sm" className="w-full h-8 text-xs" onClick={handleApply} disabled={saving || !canApply}>
        {saving && <Loader2 className="h-3 w-3 animate-spin mr-1" aria-hidden />}
        {saving ? 'Applying…' : method === 'manual' ? 'Save manual amount' : 'Apply calculation'}
      </Button>
    </div>
  );
}
