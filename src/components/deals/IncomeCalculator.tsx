import { useState, useMemo, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DroppableInput } from './DroppableInput';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calculator, AlertTriangle, FileText, Loader2, Ban, ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

export type CalcMethod = 'mi' | 'ytd' | 'mi_plus_10' | 'mi_plus_20' | 'manual';
type MiInputMode = 'salary' | 'hourly';
type PayFrequency = 'weekly' | 'biweekly' | 'semimonthly' | 'monthly';

const FREQUENCY_MULTIPLIERS: Record<PayFrequency, number> = {
  weekly: 4.33,
  biweekly: 2.17,
  semimonthly: 2.00,
  monthly: 1.00,
};

const FREQUENCY_LABELS: Record<PayFrequency, string> = {
  weekly: 'Weekly',
  biweekly: 'Biweekly',
  semimonthly: 'Semimonthly',
  monthly: 'Monthly',
};

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
  missedDaysFlag: boolean;
  additionalDocsRequested: string[];
  vehicleForWork: boolean;
  onUpdated: () => void;
  onFillFieldReady?: (handler: (field: string, value: string) => void) => void;
}

const CALC_METHODS: { value: CalcMethod; label: string; short: string }[] = [
  { value: 'mi', label: 'Monthly Income', short: 'MI' },
  { value: 'ytd', label: 'Year-to-Date', short: 'YTD' },
  { value: 'mi_plus_10', label: 'MI + 10% Tips', short: 'MI+10' },
  { value: 'mi_plus_20', label: 'MI + 20% Tips', short: 'MI+20' },
  { value: 'manual', label: 'Manual Override', short: 'Manual' },
];

export function IncomeCalculator({
  sourceId,
  dealId,
  sourceType,
  statedMonthlyIncome,
  calculatedMonthlyIncome,
  currentCalcMethod,
  currentTipPercentage,
  currentYtdGross,
  currentYtdMonths,
  currentManualAmount,
  currentManualReason,
  currentHourlyRate,
  currentHoursPerWeek,
  currentPayFrequency,
  missedDaysFlag,
  additionalDocsRequested,
  vehicleForWork,
  onUpdated,
  onFillFieldReady,
}: IncomeCalculatorProps) {
  const [method, setMethod] = useState<CalcMethod>(currentCalcMethod);
  const [ytdGross, setYtdGross] = useState(currentYtdGross?.toString() ?? '');
  const [ytdMonths, setYtdMonths] = useState(currentYtdMonths?.toString() ?? '');
  const [manualAmount, setManualAmount] = useState(currentManualAmount?.toString() ?? '');
  const [manualReason, setManualReason] = useState(currentManualReason ?? '');
  const [benefitPercent, setBenefitPercent] = useState(currentTipPercentage?.toString() ?? '50');
  const [saving, setSaving] = useState(false);

  // MI sub-mode state
  const [miInputMode, setMiInputMode] = useState<MiInputMode>(currentHourlyRate ? 'hourly' : 'salary');
  const [grossPerPeriod, setGrossPerPeriod] = useState('');
  const [payFrequency, setPayFrequency] = useState<PayFrequency>((currentPayFrequency as PayFrequency) ?? 'biweekly');
  const [hourlyRate, setHourlyRate] = useState(currentHourlyRate?.toString() ?? '');
  const [hoursPerWeek, setHoursPerWeek] = useState(currentHoursPerWeek?.toString() ?? '');

  const fillField = useCallback((field: string, value: string) => {
    switch (field) {
      case 'grossPerPeriod': setGrossPerPeriod(value); break;
      case 'hourlyRate': setHourlyRate(value); break;
      case 'hoursPerWeek': setHoursPerWeek(value); break;
      case 'ytdGross': setYtdGross(value); setMethod('ytd'); break;
      case 'manualAmount': setManualAmount(value); setMethod('manual'); break;
      case 'payFrequency': setPayFrequency(value as PayFrequency); break;
    }
  }, []);

  useEffect(() => {
    onFillFieldReady?.(fillField);
  }, [fillField, onFillFieldReady]);

  const isBenefitType = sourceType === 'government_assistance' || sourceType === 'unemployed';
  const baseMI = calculatedMonthlyIncome ?? statedMonthlyIncome;

  const availableMethods = isBenefitType
    ? CALC_METHODS.filter(m => m.value === 'mi' || m.value === 'ytd' || m.value === 'manual')
    : CALC_METHODS;

  const computedResult = useMemo(() => {
    if (isBenefitType && method !== 'manual') {
      const pct = parseInt(benefitPercent) || 50;
      const clampedPct = Math.max(0, Math.min(100, pct));
      if (method === 'ytd') {
        const gross = parseFloat(ytdGross);
        const months = parseInt(ytdMonths);
        if (!gross || !months || months < 1) return null;
        return Math.round((gross / months) * (clampedPct / 100));
      }
      // For MI benefit mode, use the sub-mode inputs
      if (method === 'mi') {
        let miBase: number | null = null;
        if (miInputMode === 'salary') {
          const gpp = parseFloat(grossPerPeriod);
          if (gpp > 0) miBase = Math.round(gpp * FREQUENCY_MULTIPLIERS[payFrequency]);
        } else {
          const rate = parseFloat(hourlyRate);
          const hrs = parseFloat(hoursPerWeek);
          if (rate > 0 && hrs > 0) miBase = Math.round(rate * hrs * 4.33);
        }
        if (miBase == null) return null;
        return Math.round(miBase * (clampedPct / 100));
      }
      return Math.round(baseMI * (clampedPct / 100));
    }

    switch (method) {
      case 'mi': {
        if (miInputMode === 'salary') {
          const gpp = parseFloat(grossPerPeriod);
          if (!gpp || gpp <= 0) return null;
          return Math.round(gpp * FREQUENCY_MULTIPLIERS[payFrequency]);
        } else {
          const rate = parseFloat(hourlyRate);
          const hrs = parseFloat(hoursPerWeek);
          if (!rate || !hrs || rate <= 0 || hrs <= 0) return null;
          return Math.round(rate * hrs * 4.33);
        }
      }
      case 'ytd': {
        const gross = parseFloat(ytdGross);
        const months = parseInt(ytdMonths);
        if (!gross || !months || months < 1) return null;
        return Math.round(gross / months);
      }
      case 'mi_plus_10': {
        const miVal = getMiBase();
        return miVal != null ? Math.round(miVal * 1.10) : null;
      }
      case 'mi_plus_20': {
        const miVal = getMiBase();
        return miVal != null ? Math.round(miVal * 1.20) : null;
      }
      case 'manual': {
        const amt = parseFloat(manualAmount);
        return amt > 0 ? amt : null;
      }
      default:
        return baseMI;
    }
  }, [method, baseMI, ytdGross, ytdMonths, manualAmount, isBenefitType, benefitPercent, miInputMode, grossPerPeriod, payFrequency, hourlyRate, hoursPerWeek]);

  function getMiBase(): number | null {
    if (miInputMode === 'salary') {
      const gpp = parseFloat(grossPerPeriod);
      return gpp > 0 ? Math.round(gpp * FREQUENCY_MULTIPLIERS[payFrequency]) : null;
    }
    const rate = parseFloat(hourlyRate);
    const hrs = parseFloat(hoursPerWeek);
    return rate > 0 && hrs > 0 ? Math.round(rate * hrs * 4.33) : null;
  }

  const tipAmount = useMemo(() => {
    if (isBenefitType) return null;
    const miVal = getMiBase();
    if (miVal == null) return null;
    if (method === 'mi_plus_10') return Math.round(miVal * 0.10);
    if (method === 'mi_plus_20') return Math.round(miVal * 0.20);
    return null;
  }, [method, isBenefitType, miInputMode, grossPerPeriod, payFrequency, hourlyRate, hoursPerWeek]);

  const isBusinessType = sourceType === 'self_employed' || sourceType === 'contractor';

  const handleApply = async () => {
    if (method === 'manual' && !manualReason.trim()) {
      toast({ title: 'Manual override requires a reason', variant: 'destructive' });
      return;
    }
    if (method === 'ytd' && (!parseFloat(ytdGross) || !parseInt(ytdMonths) || parseInt(ytdMonths) < 1)) {
      toast({ title: 'YTD requires valid gross amount and months', variant: 'destructive' });
      return;
    }
    if ((method === 'mi' || method === 'mi_plus_10' || method === 'mi_plus_20') && computedResult == null) {
      toast({ title: 'Enter pay stub data to calculate income', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      const benefitPct = isBenefitType && method !== 'manual' ? parseInt(benefitPercent) || 50 : null;
      const tipPct = method === 'mi_plus_10' ? 10 : method === 'mi_plus_20' ? 20 : null;

      const updates: Record<string, unknown> = {
        calc_method: method,
        tip_percentage: isBenefitType ? benefitPct : tipPct,
        calculated_monthly_income: computedResult,
        benefit_cap_applied: isBenefitType && method !== 'manual',
        pay_frequency: payFrequency,
        hourly_rate: miInputMode === 'hourly' ? (parseFloat(hourlyRate) || null) : null,
        hours_per_week: miInputMode === 'hourly' ? (parseFloat(hoursPerWeek) || null) : null,
        updated_at: new Date().toISOString(),
      };

      if (method === 'ytd') {
        updates.ytd_gross = parseFloat(ytdGross);
        updates.ytd_months = parseInt(ytdMonths);
      }

      if (method === 'manual') {
        updates.manual_override_amount = parseFloat(manualAmount);
        updates.manual_override_reason = manualReason.trim();
      }

      const { error } = await supabase
        .from('income_sources')
        .update(updates)
        .eq('id', sourceId);

      if (error) throw error;

      const methodLabel = CALC_METHODS.find(m => m.value === method)?.short ?? method;

      // Timeline entry for calculation applied
      const { data: { user } } = await supabase.auth.getUser();
      await supabase.from('deal_timeline').insert({
        deal_id: dealId,
        type: 'note_added' as any,
        description: `Income calculation applied: ${methodLabel} → $${computedResult?.toLocaleString()}/mo`,
        created_by: user?.id ?? null,
        metadata: {
          action: 'income_calculation',
          method,
          mi_input_mode: showMiInputs ? miInputMode : null,
          calculated_amount: computedResult,
          stated_amount: statedMonthlyIncome,
        },
      });

      // Variance check
      if (computedResult != null && statedMonthlyIncome > 0) {
        const variance = Math.abs(computedResult - statedMonthlyIncome) / statedMonthlyIncome;
        if (variance > 0.15) {
          const varianceFlag = 'Income variance > 15%';
          const { data: current } = await supabase
            .from('income_sources')
            .select('flag_reasons')
            .eq('id', sourceId)
            .single();

          const existing: string[] = (current?.flag_reasons as string[]) ?? [];
          if (!existing.includes(varianceFlag)) {
            await supabase
              .from('income_sources')
              .update({ flag_reasons: [...existing, varianceFlag] })
              .eq('id', sourceId);
          }

          // Timeline entry for variance flag
          await supabase.from('deal_timeline').insert({
            deal_id: dealId,
            type: 'note_added' as any,
            description: `⚠️ Income variance flagged: ${(variance * 100).toFixed(0)}% difference (calculated $${computedResult.toLocaleString()} vs stated $${statedMonthlyIncome.toLocaleString()})`,
            created_by: user?.id ?? null,
            metadata: {
              action: 'income_variance_flag',
              variance_percent: Math.round(variance * 100),
              calculated_amount: computedResult,
              stated_amount: statedMonthlyIncome,
            },
          });

          toast({
            title: `Calculation applied: ${methodLabel}`,
            description: `⚠️ ${(variance * 100).toFixed(0)}% variance detected between calculated and stated income`,
          });
        } else {
          toast({ title: `Calculation applied: ${methodLabel}`, description: 'Variance within acceptable range ✓' });
        }
      } else {
        toast({ title: `Calculation applied: ${methodLabel}` });
      }

      onUpdated();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleRequestDocs = async () => {
    const docType = isBusinessType ? '12 months bank statements' : '3 months bank statements';
    setSaving(true);
    try {
      const { error } = await supabase
        .from('income_sources')
        .update({
          missed_days_flag: true,
          additional_docs_requested: [docType],
          verification_status: 'needs_review' as any,
          updated_at: new Date().toISOString(),
        })
        .eq('id', sourceId);

      if (error) throw error;
      toast({ title: `Requested: ${docType}` });
      onUpdated();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const canApply = method === 'manual'
    ? (parseFloat(manualAmount) > 0 && manualReason.trim().length > 0)
    : method === 'ytd'
      ? (parseFloat(ytdGross) > 0 && parseInt(ytdMonths) >= 1)
      : computedResult != null;

  if (vehicleForWork) {
    return (
      <div className="space-y-3 p-3 rounded-lg border border-destructive bg-destructive/5">
        <div className="flex items-center gap-2 text-sm font-medium text-destructive">
          <Ban className="h-4 w-4" />
          INELIGIBLE — Vehicle Used for Rideshare/Commercial Work
        </div>
        <p className="text-xs text-muted-foreground">
          This income source has been flagged because the applicant uses the financed vehicle for rideshare or commercial work. This deal is not eligible per policy.
        </p>
      </div>
    );
  }

  const showMiInputs = method === 'mi' || method === 'mi_plus_10' || method === 'mi_plus_20';

  return (
    <div className="space-y-3 p-3 rounded-lg border border-border bg-muted/30">
      {/* Header */}
      <div className="flex items-center gap-2 text-sm font-medium">
        <Calculator className="h-4 w-4 text-primary" />
        Income Calculator
        {isBenefitType && (
          <Badge variant="outline" className="text-xs text-warning border-warning/30 ml-auto">
            <ShieldAlert className="h-3 w-3 mr-1" />
            Benefits Review
          </Badge>
        )}
      </div>

      {/* Benefit percentage input */}
      {isBenefitType && method !== 'manual' && (
        <div className="space-y-1.5">
          <p className="text-xs text-info bg-info/10 rounded-md px-2 py-1.5 border border-info/20">
            Benefits income requires analyst review. Set the percentage of stated benefits to count toward qualifying income.
          </p>
          <div className="flex items-center gap-2">
            <Label className="text-xs whitespace-nowrap">Count %</Label>
            <Input
              type="number"
              value={benefitPercent}
              onChange={e => setBenefitPercent(e.target.value)}
              min="0"
              max="100"
              className="h-8 text-xs w-20"
            />
            <span className="text-xs text-muted-foreground">of stated benefits</span>
          </div>
        </div>
      )}

      {/* Method selector */}
      <div className="flex flex-wrap gap-1.5">
        {availableMethods.map(m => (
          <button
            key={m.value}
            onClick={() => setMethod(m.value)}
            className={cn(
              'px-2.5 py-1 text-xs rounded-md border transition-colors',
              method === m.value
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background border-border text-muted-foreground hover:text-foreground hover:border-foreground/30'
            )}
          >
            {m.short}
          </button>
        ))}
      </div>

      {/* MI sub-mode inputs */}
      {showMiInputs && (
        <div className="space-y-2">
          {/* Salary / Hourly toggle */}
          <div className="flex gap-1">
            <button
              onClick={() => setMiInputMode('salary')}
              className={cn(
                'px-2 py-0.5 text-xs rounded border transition-colors',
                miInputMode === 'salary'
                  ? 'bg-secondary text-secondary-foreground border-border'
                  : 'bg-background border-border text-muted-foreground hover:text-foreground'
              )}
            >
              Salary
            </button>
            <button
              onClick={() => setMiInputMode('hourly')}
              className={cn(
                'px-2 py-0.5 text-xs rounded border transition-colors',
                miInputMode === 'hourly'
                  ? 'bg-secondary text-secondary-foreground border-border'
                  : 'bg-background border-border text-muted-foreground hover:text-foreground'
              )}
            >
              Hourly
            </button>
          </div>

          {miInputMode === 'salary' ? (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Gross Per Period ($)</Label>
                <DroppableInput
                  acceptField="grossPerPeriod"
                  type="number"
                  value={grossPerPeriod}
                  onChange={e => setGrossPerPeriod(e.target.value)}
                  onDropValue={v => setGrossPerPeriod(v)}
                  placeholder="2100"
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Pay Frequency</Label>
                <Select value={payFrequency} onValueChange={(v) => setPayFrequency(v as PayFrequency)}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(FREQUENCY_LABELS) as PayFrequency[]).map(f => (
                      <SelectItem key={f} value={f} className="text-xs">{FREQUENCY_LABELS[f]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {parseFloat(grossPerPeriod) > 0 && (
                <p className="col-span-2 text-xs text-muted-foreground">
                  ${parseFloat(grossPerPeriod).toLocaleString()} {FREQUENCY_LABELS[payFrequency].toLowerCase()} × {FREQUENCY_MULTIPLIERS[payFrequency]} = <span className="font-medium text-foreground">${computedResult?.toLocaleString()}/mo</span>
                </p>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Hourly Rate ($)</Label>
                <DroppableInput
                  acceptField="hourlyRate"
                  type="number"
                  value={hourlyRate}
                  onChange={e => setHourlyRate(e.target.value)}
                  onDropValue={v => setHourlyRate(v)}
                  placeholder="18.50"
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Hours / Week</Label>
                <DroppableInput
                  acceptField="hoursPerWeek"
                  type="number"
                  value={hoursPerWeek}
                  onChange={e => setHoursPerWeek(e.target.value)}
                  onDropValue={v => setHoursPerWeek(v)}
                  placeholder="40"
                  className="h-8 text-xs"
                />
              </div>
              {parseFloat(hourlyRate) > 0 && parseFloat(hoursPerWeek) > 0 && (
                <p className="col-span-2 text-xs text-muted-foreground">
                  ${parseFloat(hourlyRate).toLocaleString()}/hr × {parseFloat(hoursPerWeek)} hrs/wk × 4.33 = <span className="font-medium text-foreground">${computedResult?.toLocaleString()}/mo</span>
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Stated income reference */}
      <div className="text-xs text-muted-foreground">
        Stated Income: <span className="font-medium text-foreground">${statedMonthlyIncome.toLocaleString()}/mo</span>
      </div>

      {/* YTD inputs */}
      {method === 'ytd' && (
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">YTD Gross ($)</Label>
            <DroppableInput
              acceptField="ytdGross"
              type="number"
              value={ytdGross}
              onChange={e => setYtdGross(e.target.value)}
              onDropValue={v => setYtdGross(v)}
              placeholder="25200"
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Months Elapsed</Label>
            <DroppableInput
              acceptField="ytdMonths"
              type="number"
              value={ytdMonths}
              onChange={e => setYtdMonths(e.target.value)}
              onDropValue={v => setYtdMonths(v)}
              placeholder="6"
              min="1"
              className="h-8 text-xs"
            />
          </div>
          {parseFloat(ytdGross) > 0 && parseInt(ytdMonths) >= 1 && (
            <p className="col-span-2 text-xs text-muted-foreground">
              ${parseFloat(ytdGross).toLocaleString()} / {ytdMonths} mo = <span className="font-medium text-foreground">${computedResult?.toLocaleString()}/mo</span>
            </p>
          )}
        </div>
      )}

      {/* Tip display */}
      {tipAmount != null && (
        <div className="text-xs text-muted-foreground">
          Tip Adjustment: <span className="font-medium text-foreground">+{method === 'mi_plus_10' ? '10' : '20'}% = ${tipAmount.toLocaleString()}</span>
        </div>
      )}

      {/* Manual override */}
      {method === 'manual' && (
        <div className="space-y-2">
          <div className="space-y-1">
            <Label className="text-xs">Override Amount ($/mo)</Label>
            <DroppableInput
              acceptField="manualAmount"
              type="number"
              value={manualAmount}
              onChange={e => setManualAmount(e.target.value)}
              onDropValue={v => setManualAmount(v)}
              placeholder="4500"
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Reason (required)</Label>
            <Textarea
              value={manualReason}
              onChange={e => setManualReason(e.target.value)}
              placeholder="Explain why manual override is needed..."
              className="text-xs min-h-[50px] resize-none"
            />
          </div>
        </div>
      )}

      {/* Computed result */}
      {computedResult != null && (
        <div className="p-2.5 rounded-md bg-primary/5 border border-primary/20 text-center">
          <p className="text-xs text-muted-foreground">Calculated Total</p>
          <p className="text-lg font-bold text-primary">${computedResult.toLocaleString()}/mo</p>
        </div>
      )}

      {/* Missed days alert */}
      {missedDaysFlag && (
        <div className="p-2.5 rounded-md bg-warning/10 border border-warning/30 space-y-2">
          <div className="flex items-center gap-1.5 text-xs text-warning font-medium">
            <AlertTriangle className="h-3.5 w-3.5" />
            Possible missed work days detected
          </div>
          <p className="text-xs text-muted-foreground">
            Request: {isBusinessType ? '12 months' : '3 months'} bank statements
          </p>
          {additionalDocsRequested.length > 0 && (
            <div className="flex items-center gap-1 text-xs text-success">
              <FileText className="h-3 w-3" />
              Already requested: {additionalDocsRequested.join(', ')}
            </div>
          )}
          {additionalDocsRequested.length === 0 && (
            <Button variant="outline" size="sm" className="h-7 text-xs w-full" onClick={handleRequestDocs} disabled={saving}>
              Request Documents
            </Button>
          )}
        </div>
      )}

      {/* Flag missed days manually */}
      {!missedDaysFlag && (
        <button
          onClick={handleRequestDocs}
          className="text-xs text-muted-foreground hover:text-warning transition-colors flex items-center gap-1"
          disabled={saving}
        >
          <AlertTriangle className="h-3 w-3" />
          Flag missed work days
        </button>
      )}

      {/* Apply */}
      <Button
        size="sm"
        className="w-full h-8 text-xs"
        onClick={handleApply}
        disabled={saving || !canApply}
      >
        {saving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
        {saving ? 'Applying...' : 'Apply Calculation'}
      </Button>
    </div>
  );
}
