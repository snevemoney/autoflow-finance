import { useState, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { AlertTriangle, CheckCircle2, Clock, FileWarning, Briefcase, GraduationCap, Hammer, Wrench, Leaf, Timer, UserX, Heart, Shield, FileSearch, ChevronDown, ChevronUp, Calculator, ClipboardCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { IncomeSourceActions } from './IncomeSourceActions';
import { IncomeCalculator, type CalcMethod } from './IncomeCalculator';
import { IncomeDocPreview } from './IncomeDocPreview';

export type IncomeSourceType = 'salaried' | 'part_time' | 'self_employed' | 'contractor' | 'seasonal' | 'education' | 'unemployed' | 'pension' | 'government_assistance';
export type IncomeVerificationStatus = 'unverified' | 'verified' | 'flagged' | 'insufficient_docs' | 'needs_review';

export interface IncomeSource {
  id: string;
  deal_id: string;
  customer_id: string;
  source_type: IncomeSourceType;
  employer_name: string;
  job_title: string | null;
  stated_monthly_income: number;
  calculated_monthly_income: number | null;
  pay_frequency: string | null;
  contract_months: number | null;
  hours_per_week: number | null;
  hourly_rate: number | null;
  is_primary: boolean;
  verification_status: IncomeVerificationStatus;
  flag_reasons: string[];
  verified_at: string | null;
  verified_by: string | null;
  created_at: string;
  updated_at: string;
  calc_method: CalcMethod;
  tip_percentage: number | null;
  ytd_gross: number | null;
  ytd_months: number | null;
  manual_override_amount: number | null;
  manual_override_reason: string | null;
  missed_days_flag: boolean;
  additional_docs_requested: string[];
  vehicle_for_work: boolean;
}

export interface LinkedExtraction {
  id: string;
  gross_pay: number | null;
  net_pay: number | null;
  pay_frequency: string | null;
  employer_name_on_doc: string | null;
  confidence: string;
  extracted_at: string;
}

const SOURCE_TYPE_CONFIG: Record<IncomeSourceType, { label: string; icon: typeof Briefcase; color: string }> = {
  salaried: { label: 'Salaried (W-2)', icon: Briefcase, color: 'bg-primary/10 text-primary border-primary/30' },
  part_time: { label: 'Part-Time / Hourly', icon: Timer, color: 'bg-info/10 text-info border-info/30' },
  self_employed: { label: 'Self-Employed', icon: Hammer, color: 'bg-warning/10 text-warning border-warning/30' },
  contractor: { label: 'Contractor (1099)', icon: Wrench, color: 'bg-accent/10 text-accent-foreground border-accent/30' },
  seasonal: { label: 'Seasonal', icon: Leaf, color: 'bg-success/10 text-success border-success/30' },
  education: { label: 'Education', icon: GraduationCap, color: 'bg-secondary text-secondary-foreground border-border' },
  unemployed: { label: 'Unemployed', icon: UserX, color: 'bg-destructive/10 text-destructive border-destructive/30' },
  pension: { label: 'Pension / Retirement', icon: Heart, color: 'bg-primary/10 text-primary border-primary/30' },
  government_assistance: { label: 'Gov. Assistance', icon: Shield, color: 'bg-info/10 text-info border-info/30' },
};

const STATUS_CONFIG: Record<IncomeVerificationStatus, { label: string; icon: typeof CheckCircle2; className: string }> = {
  unverified: { label: 'Unverified', icon: Clock, className: 'text-muted-foreground' },
  verified: { label: 'Verified', icon: CheckCircle2, className: 'text-success' },
  flagged: { label: 'Flagged', icon: AlertTriangle, className: 'text-warning' },
  insufficient_docs: { label: 'Insufficient Docs', icon: FileWarning, className: 'text-destructive' },
  needs_review: { label: 'Needs Review', icon: ClipboardCheck, className: 'text-info' },
};

const CALC_METHOD_LABELS: Record<CalcMethod, string> = {
  mi: 'MI',
  ytd: 'YTD',
  mi_plus_10: 'MI+10',
  mi_plus_20: 'MI+20',
  manual: 'Manual',
};

interface IncomeSourceCardProps {
  source: IncomeSource;
  linkedExtractions?: LinkedExtraction[];
  onUpdated?: () => void;
}

export function IncomeSourceCard({ source, linkedExtractions, onUpdated }: IncomeSourceCardProps) {
  const [calcOpen, setCalcOpen] = useState(false);
  const [fillHandler, setFillHandler] = useState<((field: string, value: string) => void) | null>(null);

  const handleFillFieldReady = useCallback((handler: (field: string, value: string) => void) => {
    setFillHandler(() => handler);
  }, []);
  const typeConfig = SOURCE_TYPE_CONFIG[source.source_type];
  const statusConfig = STATUS_CONFIG[source.verification_status];
  const TypeIcon = typeConfig.icon;
  const StatusIcon = statusConfig.icon;
  const showCalcBadge = source.calc_method && source.calc_method !== 'mi';

  const stated = source.stated_monthly_income;
  const calculated = source.calculated_monthly_income;
  const delta = calculated != null && stated > 0
    ? (((calculated - stated) / stated) * 100).toFixed(1)
    : null;

  const hasExtractions = linkedExtractions && linkedExtractions.length > 0;

  return (
    <Card className="border-l-4" style={{ borderLeftColor: 'hsl(var(--primary))' }}>
      <CardContent className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={cn('text-xs gap-1', typeConfig.color)}>
              <TypeIcon className="h-3 w-3" />
              {typeConfig.label}
            </Badge>
            {source.is_primary && (
              <Badge variant="secondary" className="text-xs">Primary</Badge>
            )}
            {(source as any).vehicle_for_work && (
              <Badge variant="destructive" className="text-xs">Rideshare/Commercial</Badge>
            )}
            {(source.source_type === 'government_assistance' || source.source_type === 'unemployed') && (
              <Badge variant="outline" className="text-xs text-info border-info/30">Benefits Review</Badge>
            )}
            {showCalcBadge && (
              <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-primary/30">
                {CALC_METHOD_LABELS[source.calc_method]}
              </Badge>
            )}
            {source.missed_days_flag && (
              <AlertTriangle className="h-3.5 w-3.5 text-warning" />
            )}
          </div>
          <div className={cn('flex items-center gap-1 text-xs', statusConfig.className)}>
            <StatusIcon className="h-3.5 w-3.5" />
            {statusConfig.label}
          </div>
        </div>

        {/* Employer */}
        <div className="text-sm">
          <p className="font-medium">{source.employer_name}</p>
          {source.job_title && <p className="text-muted-foreground text-xs">{source.job_title}</p>}
        </div>

        {/* Income figures */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-muted-foreground text-xs">Stated Income</p>
            <p className="font-medium">${stated.toLocaleString()}/mo</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Calculated Income</p>
            <p className="font-medium">
              {calculated != null ? `$${calculated.toLocaleString()}/mo` : 'Pending'}
            </p>
          </div>
        </div>

        {delta && (
          <p className={cn('text-xs', parseFloat(delta) >= 0 ? 'text-success' : 'text-warning')}>
            {parseFloat(delta) > 0 ? '+' : ''}{delta}% variance
          </p>
        )}

        {/* Extraction source info */}
        {hasExtractions && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1.5">
            <FileSearch className="h-3 w-3 shrink-0 text-success" />
            <span>
              Calculated from {linkedExtractions.length} extracted document{linkedExtractions.length !== 1 ? 's' : ''}
              {' '}({linkedExtractions[0].confidence} confidence)
            </span>
          </div>
        )}

        {/* Type-specific fields */}
        {(source.source_type === 'part_time') && source.hours_per_week != null && (
          <div className="text-xs text-muted-foreground">
            {source.hours_per_week} hrs/wk × ${source.hourly_rate?.toLocaleString()}/hr
          </div>
        )}
        {source.source_type === 'education' && source.contract_months != null && (
          <div className="text-xs text-muted-foreground">
            {source.contract_months}-month contract
          </div>
        )}

        {/* Flags */}
        {source.flag_reasons.length > 0 && (
          <div className="space-y-1">
            {source.flag_reasons.map((flag, i) => (
              <div key={i} className="flex items-center gap-1.5 text-xs text-warning">
                <AlertTriangle className="h-3 w-3 shrink-0" />
                {flag}
              </div>
            ))}
          </div>
        )}

        {/* Income Calculator */}
        {onUpdated && (
          <div className="border-t border-border pt-2 mt-2">
            <button
              onClick={() => setCalcOpen(!calcOpen)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
            >
              {calcOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              <Calculator className="h-3 w-3" />
              Income Calculator
            </button>
            {calcOpen && (
              <div className="mt-2">
                <IncomeCalculator
                  sourceId={source.id}
                  dealId={source.deal_id}
                  sourceType={source.source_type}
                  statedMonthlyIncome={source.stated_monthly_income}
                  calculatedMonthlyIncome={source.calculated_monthly_income}
                  currentCalcMethod={source.calc_method ?? 'mi'}
                  currentTipPercentage={source.tip_percentage}
                  currentYtdGross={source.ytd_gross}
                  currentYtdMonths={source.ytd_months}
                  currentManualAmount={source.manual_override_amount}
                  currentManualReason={source.manual_override_reason}
                  currentHourlyRate={source.hourly_rate}
                  currentHoursPerWeek={source.hours_per_week}
                  currentPayFrequency={source.pay_frequency}
                  missedDaysFlag={source.missed_days_flag ?? false}
                  additionalDocsRequested={source.additional_docs_requested ?? []}
                  vehicleForWork={(source as any).vehicle_for_work ?? false}
                  onUpdated={onUpdated}
                  onFillFieldReady={handleFillFieldReady}
                />
                <IncomeDocPreview dealId={source.deal_id} sourceId={source.id} onClickFill={fillHandler ?? undefined} />
              </div>
            )}
          </div>
        )}

        {/* Analyst actions */}
        {onUpdated && (
          <IncomeSourceActions
            sourceId={source.id}
            currentStatus={source.verification_status}
            onUpdated={onUpdated}
          />
        )}
      </CardContent>
    </Card>
  );
}
