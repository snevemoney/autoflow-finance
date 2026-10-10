import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, Briefcase, Clock, CreditCard, Car, Gavel, Home, User, Send } from 'lucide-react';
import { statusConfig, type Deal } from '@/types/deal';
import { ago, cn } from '@/lib/utils';
import { DEFAULT_PREFERENCES, ratioTone, TONE_TEXT } from '@/lib/preferences';
import { summarizeDebts } from '@/lib/deal-ratios';

const TIER_COLOR: Record<string, string> = {
  prime: 'text-success', near_prime: 'text-info', subprime: 'text-warning', deep_subprime: 'text-destructive',
};

interface DealCardProps {
  deal: Deal;
  compact?: boolean;
  dragging?: boolean;
  /** open document requests waiting on the dealer (defaults to the count embedded in the row) */
  openRequests?: number;
  /** where the card links to (dealer portal uses its own route) */
  href?: string;
  /** limits from Settings */
  maxPti?: number;
  maxDti?: number;
  /** e.g. the admin "Move to…" menu; rendered above the stretched link */
  actions?: ReactNode;
}

export function DealCard({
  deal, compact = false, dragging = false, openRequests, href, maxPti = DEFAULT_PREFERENCES.max_pti, maxDti = DEFAULT_PREFERENCES.max_dti, actions,
}: DealCardProps) {
  const config = statusConfig(deal.status);
  const summary = summarizeDebts(deal);
  const requests = openRequests ?? deal.openRequests ?? 0;
  const employment = deal.customer.employmentInfo;
  const ptiTone = summary ? ratioTone(summary.pti, maxPti) : null;
  const dtiTone = summary ? ratioTone(summary.dti, maxDti) : null;
  const customer = `${deal.customer.firstName} ${deal.customer.lastName}`.trim() || 'Customer';

  return (
    <div
      className={cn(
        'deal-card relative animate-fade-in focus-within:ring-2 focus-within:ring-ring',
        dragging && 'opacity-50 shadow-lg rotate-2',
        deal.priority === 'urgent' && 'border-l-2 border-l-destructive',
        deal.priority === 'high' && 'border-l-2 border-l-warning',
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          {deal.priority === 'urgent' && <span className="h-1.5 w-1.5 rounded-full bg-destructive animate-pulse-slow" aria-label="Urgent" />}
          {deal.priority === 'high' && <span className="h-1.5 w-1.5 rounded-full bg-warning" aria-label="High priority" />}
          <span className="font-mono text-xs text-muted-foreground">{deal.dealNumber}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {!compact && <span className={cn('status-badge', config.bgColor, config.color)}>{config.label}</span>}
          {actions && <div className="relative z-10">{actions}</div>}
        </div>
      </div>

      {/* Customer & Vehicle — the customer name is the link; it stretches over the whole card */}
      <div className="space-y-1 mb-3 min-w-0">
        <Link
          to={href ?? `/deals/${deal.id}`}
          className="font-medium text-sm block truncate focus:outline-none after:absolute after:inset-0 after:content-['']"
          aria-label={`Open deal ${deal.dealNumber}, ${customer}`}
          draggable={false}
        >
          {customer}
        </Link>
        <p className="text-sm text-muted-foreground truncate">
          {deal.vehicle.year || ''} {deal.vehicle.make} {deal.vehicle.model}
        </p>
      </div>

      {/* Amount */}
      <div className="flex flex-wrap items-baseline gap-1 mb-3">
        <span className="text-lg font-semibold">${deal.financingTerms.loanAmount.toLocaleString('en-CA')}</span>
        <span className="text-xs text-muted-foreground">@ {deal.financingTerms.apr}% / {deal.financingTerms.termMonths}mo</span>
      </div>

      {deal.creditInfo && (
        <div className="flex items-center gap-2 mb-3">
          <div className={cn('text-sm font-medium', TIER_COLOR[deal.creditInfo.tier] ?? 'text-muted-foreground')}>{deal.creditInfo.score}</div>
          <span className="text-xs text-muted-foreground capitalize">({deal.creditInfo.tier.replace('_', ' ')})</span>
        </div>
      )}

      {/* Financial snapshot (credit queue) */}
      {summary && (
        <div className="space-y-1.5 mb-3 text-xs">
          {summary.pti != null && ptiTone && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Payment / Income</span>
              <span className={cn('font-medium text-right', TONE_TEXT[ptiTone])}>
                ${deal.financingTerms.monthlyPayment.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/mo ({Math.round(summary.pti)}% PTI)
              </span>
            </div>
          )}
          {summary.rentPayment > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground flex items-center gap-1"><Home className="h-3 w-3" aria-hidden /> Rent/Housing</span>
              <span className="font-medium">${summary.rentPayment.toLocaleString('en-CA')}/mo</span>
            </div>
          )}
          {employment && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground flex items-center gap-1"><Briefcase className="h-3 w-3" aria-hidden /> Employment</span>
              <span className="font-medium truncate max-w-[60%] text-right">
                {employment.yearsEmployed ? `${employment.yearsEmployed} yrs` : ''}
                {employment.employer ? `${employment.yearsEmployed ? ' at ' : ''}${employment.employer}` : ''}
              </span>
            </div>
          )}
          {summary.debtCount > 0 && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Debts</span>
              <span className="font-medium text-right">{summary.debtCount} obligations · ${summary.totalMonthlyDebts.toLocaleString('en-CA')}/mo</span>
            </div>
          )}
          {summary.debtTypes.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {summary.debtTypes.map((type) => (
                <span key={type} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] bg-muted text-muted-foreground border">
                  {type === 'auto_loan' && <Car className="h-2.5 w-2.5" aria-hidden />}
                  {type === 'credit_card' && <CreditCard className="h-2.5 w-2.5" aria-hidden />}
                  {(type === 'garnishment' || type === 'child_support') && <Gavel className="h-2.5 w-2.5" aria-hidden />}
                  {type.replace('_', ' ')}
                </span>
              ))}
            </div>
          )}
          {summary.dti != null && dtiTone && dtiTone !== 'ok' && (
            <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium',
              dtiTone === 'bad' ? 'bg-destructive/10 text-destructive' : 'bg-warning/10 text-warning')}>
              DTI: {Math.round(summary.dti)}% (limit {maxDti}%)
            </span>
          )}
          {summary.hasGarnishments && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-warning/10 text-warning font-medium ml-1">
              <Gavel className="h-3 w-3" aria-hidden /> Garnishment
            </span>
          )}
        </div>
      )}

      {deal.flags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {deal.flags.map((flag, i) => (
            <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-destructive/10 text-destructive">
              <AlertCircle className="h-3 w-3" aria-hidden />{flag}
            </span>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 pt-3 border-t text-xs text-muted-foreground">
        <div className="flex items-center gap-3 min-w-0">
          <span className="flex items-center gap-1 truncate">
            <User className="h-3 w-3 shrink-0" aria-hidden />
            <span className="truncate">{deal.dealerName}</span>
          </span>
          {requests > 0 && (
            <span className="flex items-center gap-1 text-warning font-medium shrink-0" title="Documents requested from the dealer">
              <Send className="h-3 w-3" aria-hidden />{requests}<span className="sr-only"> open document request{requests === 1 ? '' : 's'}</span>
            </span>
          )}
        </div>
        <span className="flex items-center gap-1 shrink-0" title="Time in this stage">
          <Clock className="h-3 w-3" aria-hidden />
          {deal.statusChangedAt || deal.createdAt ? ago(deal.statusChangedAt || deal.createdAt, { addSuffix: false }) : '—'}
        </span>
      </div>
    </div>
  );
}
