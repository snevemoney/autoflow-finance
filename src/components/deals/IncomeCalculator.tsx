import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Calculator, AlertTriangle, FileText, Loader2, Ban, ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

export type CalcMethod = 'mi' | 'ytd' | 'mi_plus_10' | 'mi_plus_20' | 'manual';

interface IncomeCalculatorProps {
  sourceId: string;
  sourceType: string;
  statedMonthlyIncome: number;
  calculatedMonthlyIncome: number | null;
  currentCalcMethod: CalcMethod;
  currentTipPercentage: number | null;
  currentYtdGross: number | null;
  currentYtdMonths: number | null;
  currentManualAmount: number | null;
  currentManualReason: string | null;
  missedDaysFlag: boolean;
  additionalDocsRequested: string[];
  vehicleForWork: boolean;
  onUpdated: () => void;
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
  sourceType,
  statedMonthlyIncome,
  calculatedMonthlyIncome,
  currentCalcMethod,
  currentTipPercentage,
  currentYtdGross,
  currentYtdMonths,
  currentManualAmount,
  currentManualReason,
  missedDaysFlag,
  additionalDocsRequested,
  vehicleForWork,
  onUpdated,
}: IncomeCalculatorProps) {
  const [method, setMethod] = useState<CalcMethod>(currentCalcMethod);
  const [ytdGross, setYtdGross] = useState(currentYtdGross?.toString() ?? '');
  const [ytdMonths, setYtdMonths] = useState(currentYtdMonths?.toString() ?? '');
  const [manualAmount, setManualAmount] = useState(currentManualAmount?.toString() ?? '');
  const [manualReason, setManualReason] = useState(currentManualReason ?? '');
  const [saving, setSaving] = useState(false);

  const isBenefitType = sourceType === 'government_assistance' || sourceType === 'unemployed';
  const baseMI = calculatedMonthlyIncome ?? statedMonthlyIncome;

  // For benefit types, the available methods are limited
  const availableMethods = isBenefitType
    ? CALC_METHODS.filter(m => m.value === 'mi' || m.value === 'ytd' || m.value === 'manual')
    : CALC_METHODS;

  const computedResult = useMemo(() => {
    // For benefit types, always apply 50% cap (except manual override)
    if (isBenefitType && method !== 'manual') {
      if (method === 'ytd') {
        const gross = parseFloat(ytdGross);
        const months = parseInt(ytdMonths);
        if (!gross || !months || months < 1) return null;
        return Math.round((gross / months) * 0.5);
      }
      return Math.round(baseMI * 0.5);
    }

    switch (method) {
      case 'mi':
        return baseMI;
      case 'ytd': {
        const gross = parseFloat(ytdGross);
        const months = parseInt(ytdMonths);
        if (!gross || !months || months < 1) return null;
        return Math.round(gross / months);
      }
      case 'mi_plus_10':
        return Math.round(baseMI * 1.10);
      case 'mi_plus_20':
        return Math.round(baseMI * 1.20);
      case 'manual': {
        const amt = parseFloat(manualAmount);
        return amt > 0 ? amt : null;
      }
      default:
        return baseMI;
    }
  }, [method, baseMI, ytdGross, ytdMonths, manualAmount, isBenefitType]);

  const tipAmount = useMemo(() => {
    if (isBenefitType) return null;
    if (method === 'mi_plus_10') return Math.round(baseMI * 0.10);
    if (method === 'mi_plus_20') return Math.round(baseMI * 0.20);
    return null;
  }, [method, baseMI, isBenefitType]);

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

    setSaving(true);
    try {
      const tipPct = method === 'mi_plus_10' ? 10 : method === 'mi_plus_20' ? 20 : null;

      const updates: Record<string, unknown> = {
        calc_method: method,
        tip_percentage: tipPct,
        calculated_monthly_income: computedResult,
        benefit_cap_applied: isBenefitType && method !== 'manual',
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
      toast({ title: `Calculation applied: ${CALC_METHODS.find(m => m.value === method)?.short}` });
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
      : true;

  // Vehicle for work — show ineligible banner instead of calculator
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

  return (
    <div className="space-y-3 p-3 rounded-lg border border-border bg-muted/30">
      {/* Header */}
      <div className="flex items-center gap-2 text-sm font-medium">
        <Calculator className="h-4 w-4 text-primary" />
        Income Calculator
        {isBenefitType && (
          <Badge variant="outline" className="text-xs text-warning border-warning/30 ml-auto">
            <ShieldAlert className="h-3 w-3 mr-1" />
            50% Benefit Cap
          </Badge>
        )}
      </div>

      {/* Benefit cap info */}
      {isBenefitType && (
        <p className="text-xs text-warning bg-warning/10 rounded-md px-2 py-1.5 border border-warning/20">
          Benefits income capped at 50% per policy. Use Manual Override for documented exceptions.
        </p>
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

      {/* Base MI display */}
      <div className="text-xs text-muted-foreground">
        Base MI (from stubs): <span className="font-medium text-foreground">${baseMI.toLocaleString()}/mo</span>
      </div>

      {/* YTD inputs */}
      {method === 'ytd' && (
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">YTD Gross ($)</Label>
            <Input
              type="number"
              value={ytdGross}
              onChange={e => setYtdGross(e.target.value)}
              placeholder="25200"
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Months Elapsed</Label>
            <Input
              type="number"
              value={ytdMonths}
              onChange={e => setYtdMonths(e.target.value)}
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
            <Input
              type="number"
              value={manualAmount}
              onChange={e => setManualAmount(e.target.value)}
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
