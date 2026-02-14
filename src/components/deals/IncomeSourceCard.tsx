import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { AlertTriangle, CheckCircle2, Clock, FileWarning, Briefcase, GraduationCap, Hammer, Wrench, Leaf, Timer } from 'lucide-react';
import { cn } from '@/lib/utils';

export type IncomeSourceType = 'salaried' | 'part_time' | 'self_employed' | 'contractor' | 'seasonal' | 'education';
export type IncomeVerificationStatus = 'unverified' | 'verified' | 'flagged' | 'insufficient_docs';

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
}

const SOURCE_TYPE_CONFIG: Record<IncomeSourceType, { label: string; icon: typeof Briefcase; color: string }> = {
  salaried: { label: 'Salaried (W-2)', icon: Briefcase, color: 'bg-primary/10 text-primary border-primary/30' },
  part_time: { label: 'Part-Time / Hourly', icon: Timer, color: 'bg-info/10 text-info border-info/30' },
  self_employed: { label: 'Self-Employed', icon: Hammer, color: 'bg-warning/10 text-warning border-warning/30' },
  contractor: { label: 'Contractor (1099)', icon: Wrench, color: 'bg-accent/10 text-accent-foreground border-accent/30' },
  seasonal: { label: 'Seasonal', icon: Leaf, color: 'bg-success/10 text-success border-success/30' },
  education: { label: 'Education', icon: GraduationCap, color: 'bg-secondary text-secondary-foreground border-border' },
};

const STATUS_CONFIG: Record<IncomeVerificationStatus, { label: string; icon: typeof CheckCircle2; className: string }> = {
  unverified: { label: 'Unverified', icon: Clock, className: 'text-muted-foreground' },
  verified: { label: 'Verified', icon: CheckCircle2, className: 'text-success' },
  flagged: { label: 'Flagged', icon: AlertTriangle, className: 'text-warning' },
  insufficient_docs: { label: 'Insufficient Docs', icon: FileWarning, className: 'text-destructive' },
};

interface IncomeSourceCardProps {
  source: IncomeSource;
}

export function IncomeSourceCard({ source }: IncomeSourceCardProps) {
  const typeConfig = SOURCE_TYPE_CONFIG[source.source_type];
  const statusConfig = STATUS_CONFIG[source.verification_status];
  const TypeIcon = typeConfig.icon;
  const StatusIcon = statusConfig.icon;

  const stated = source.stated_monthly_income;
  const calculated = source.calculated_monthly_income;
  const delta = calculated != null && stated > 0
    ? (((calculated - stated) / stated) * 100).toFixed(1)
    : null;

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
      </CardContent>
    </Card>
  );
}
