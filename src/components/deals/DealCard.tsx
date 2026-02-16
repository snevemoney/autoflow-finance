import { Deal, DEAL_STATUS_CONFIG } from '@/types/deal';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { AlertCircle, Clock, FileText, Gavel, User } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export interface DebtSummary {
  totalMonthlyDebts: number;
  hasGarnishments: boolean;
  dti: number | null;
}

interface DealCardProps {
  deal: Deal;
  compact?: boolean;
  dragging?: boolean;
  debtSummary?: DebtSummary;
}

export function DealCard({ deal, compact = false, dragging = false, debtSummary }: DealCardProps) {
  const navigate = useNavigate();
  const statusConfig = DEAL_STATUS_CONFIG[deal.status];

  const getCreditTierColor = (tier: string) => {
    switch (tier) {
      case 'prime':
        return 'text-success';
      case 'near_prime':
        return 'text-info';
      case 'subprime':
        return 'text-warning';
      case 'deep_subprime':
        return 'text-destructive';
      default:
        return 'text-muted-foreground';
    }
  };

  const getPriorityIndicator = () => {
    if (deal.priority === 'urgent') {
      return <span className="h-1.5 w-1.5 rounded-full bg-destructive animate-pulse-slow" />;
    }
    if (deal.priority === 'high') {
      return <span className="h-1.5 w-1.5 rounded-full bg-warning" />;
    }
    return null;
  };

  return (
    <div
      onClick={() => navigate(`/deals/${deal.id}`)}
      className={cn(
        'deal-card cursor-pointer animate-fade-in',
        dragging && 'opacity-50 shadow-lg rotate-2',
        deal.priority === 'urgent' && 'border-l-2 border-l-destructive',
        deal.priority === 'high' && 'border-l-2 border-l-warning'
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          {getPriorityIndicator()}
          <span className="font-mono text-xs text-muted-foreground">
            {deal.dealNumber}
          </span>
        </div>
        {!compact && (
          <span className={cn('status-badge', statusConfig.bgColor, statusConfig.color)}>
            {statusConfig.label}
          </span>
        )}
      </div>

      {/* Customer & Vehicle */}
      <div className="space-y-1 mb-3">
        <p className="font-medium text-sm">
          {deal.customer.firstName} {deal.customer.lastName}
        </p>
        <p className="text-sm text-muted-foreground">
          {deal.vehicle.year} {deal.vehicle.make} {deal.vehicle.model}
        </p>
      </div>

      {/* Amount */}
      <div className="flex items-baseline gap-1 mb-3">
        <span className="text-lg font-semibold">
          ${deal.financingTerms.loanAmount.toLocaleString()}
        </span>
        <span className="text-xs text-muted-foreground">
          @ {deal.financingTerms.apr}% / {deal.financingTerms.termMonths}mo
        </span>
      </div>

      {/* Credit Score */}
      {deal.creditInfo && (
        <div className="flex items-center gap-2 mb-3">
          <div className={cn('text-sm font-medium', getCreditTierColor(deal.creditInfo.tier))}>
            {deal.creditInfo.score}
          </div>
          <span className="text-xs text-muted-foreground capitalize">
            ({deal.creditInfo.tier.replace('_', ' ')})
          </span>
        </div>
      )}

      {/* Debt Risk Badges */}
      {(debtSummary?.dti != null && debtSummary.dti > 45 || debtSummary?.hasGarnishments) && (
        <div className="flex flex-wrap gap-1 mb-3">
          {debtSummary?.dti != null && debtSummary.dti > 45 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-destructive/10 text-destructive font-medium">
              DTI: {Math.round(debtSummary.dti)}%
            </span>
          )}
          {debtSummary?.hasGarnishments && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-warning/10 text-warning font-medium">
              <Gavel className="h-3 w-3" />
              Garnishment
            </span>
          )}
        </div>
      )}

      {/* Flags */}
      {deal.flags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {deal.flags.map((flag, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-destructive/10 text-destructive"
            >
              <AlertCircle className="h-3 w-3" />
              {flag}
            </span>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-3 border-t text-xs text-muted-foreground">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <FileText className="h-3 w-3" />
            {deal.documents.length}
          </span>
          <span className="flex items-center gap-1">
            <User className="h-3 w-3" />
            {deal.dealerName.split(' ')[0]}
          </span>
        </div>
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {formatDistanceToNow(new Date(deal.createdAt), { addSuffix: true })}
        </span>
      </div>
    </div>
  );
}
