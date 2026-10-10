import { ArrowRightLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MOVE_TARGETS, type MovableDeal } from '@/hooks/use-deal-mover';
import { statusConfig, type DealStatus } from '@/types/deal';

/** Keyboard-friendly "Move to…" menu (the alternative to dragging). */
export function MoveToMenu({ deal, onPick, compact, triggerLabel = 'Move to…' }: {
  deal: MovableDeal; onPick: (to: DealStatus) => void; compact?: boolean; triggerLabel?: string;
}) {
  const terminal = deal.status === 'declined';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {compact ? (
          <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Move deal ${deal.dealNumber} to another stage`}>
            <ArrowRightLeft className="h-3.5 w-3.5" aria-hidden />
          </Button>
        ) : (
          <Button variant="outline" size="sm" className="h-8">
            <ArrowRightLeft className="h-3.5 w-3.5 mr-1.5" aria-hidden />{triggerLabel}
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Move {deal.dealNumber} to</DropdownMenuLabel>
        {MOVE_TARGETS.filter((s) => s !== deal.status).map((s) => (
          <DropdownMenuItem key={s} onSelect={() => onPick(s)} disabled={s === 'funded' && deal.status !== 'approved'}>
            {statusConfig(s).label}
          </DropdownMenuItem>
        ))}
        {!terminal && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" onSelect={() => onPick('declined')}>Decline…</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
