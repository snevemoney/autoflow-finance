import { Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DEAL_FLOW, DEAL_STATUS_CONFIG, statusConfig, type DealStatus } from '@/types/deal';

/** Where a deal is in the flow from dealer submission to funded. */
export function StatusTracker({ status, className }: { status: DealStatus | string; className?: string }) {
  const declined = status === 'declined' || status === 'incomplete';
  const current = DEAL_FLOW.indexOf(status as DealStatus);

  return (
    <ol className={cn('flex items-center gap-1 overflow-x-auto scrollbar-thin', className)} aria-label="Deal progress">
      {DEAL_FLOW.map((step, i) => {
        const done = !declined && (i < current || status === 'funded');
        const active = !declined && i === current && status !== 'funded';
        return (
          <li key={step} className="flex items-center gap-1 shrink-0">
            <span
              className={cn(
                'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap border',
                done && 'bg-success/10 text-success border-success/20',
                active && 'bg-accent/10 text-accent border-accent/30 ring-2 ring-accent/20',
                !done && !active && 'text-muted-foreground border-border',
              )}
              aria-current={active ? 'step' : undefined}
            >
              {done && <Check className="h-3 w-3" />}
              {DEAL_STATUS_CONFIG[step].label}
            </span>
            {i < DEAL_FLOW.length - 1 && <span className={cn('h-px w-3', done ? 'bg-success/40' : 'bg-border')} />}
          </li>
        );
      })}
      {declined && (
        <li className="flex items-center gap-1 shrink-0">
          <span className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium bg-destructive/10 text-destructive border border-destructive/20">
            <X className="h-3 w-3" aria-hidden /> {statusConfig(status).label}
          </span>
        </li>
      )}
    </ol>
  );
}
