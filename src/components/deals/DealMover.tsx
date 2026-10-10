import { useState, type ReactNode } from 'react';
import { ArrowRightLeft, Loader2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAdminMoveDeal, useDeclineDeal } from '@/hooks/use-autoflow';
import { toast } from '@/hooks/use-toast';
import { describeMove, planMove } from '@/lib/pipeline';
import { errorMessage } from '@/lib/rpc';
import { DEAL_FLOW, statusConfig, type DealStatus } from '@/types/deal';

export interface MovableDeal { id: string; dealNumber: string; status: string }

/** Stages an admin can pick in "Move to…". */
export const MOVE_TARGETS: DealStatus[] = [...DEAL_FLOW, 'incomplete'];

/**
 * Everything needed to move or decline a deal by hand: `request(deal, to)` decides whether to move
 * straight away, ask for confirmation (skipping, moving back, reopening) or open the decline form.
 * Render `dialogs` once.
 */
export function useDealMover(opts: { onMoved?: (deal: MovableDeal, to: DealStatus) => void; onSettled?: (deal: MovableDeal) => void } = {}) {
  const move = useAdminMoveDeal();
  const decline = useDeclineDeal();
  const [pending, setPending] = useState<{ deal: MovableDeal; to: DealStatus } | null>(null);
  const [declining, setDeclining] = useState<MovableDeal | null>(null);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [dealerMessage, setDealerMessage] = useState('');

  const run = async (deal: MovableDeal, to: DealStatus, moveNote?: string) => {
    opts.onMoved?.(deal, to);
    try {
      const result = await move.mutateAsync({ dealId: deal.id, status: to, note: moveNote });
      toast({ title: `${deal.dealNumber} → ${statusConfig(result ?? to).label}` });
    } catch (e) {
      toast({ title: 'Could not move the deal', description: errorMessage(e), variant: 'destructive' });
    } finally {
      opts.onSettled?.(deal);
    }
  };

  const request = (deal: MovableDeal, to: DealStatus) => {
    const plan = planMove(deal.status, to);
    if (plan.kind === 'same') return;
    if (plan.kind === 'invalid') {
      toast({ title: 'That move is not allowed', description: plan.reason, variant: 'destructive' });
      return;
    }
    if (plan.kind === 'decline') {
      setReason('');
      setDealerMessage('');
      setDeclining(deal);
      return;
    }
    if (plan.confirm) {
      setNote('');
      setPending({ deal, to });
      return;
    }
    void run(deal, to);
  };

  const confirmMove = () => {
    if (!pending) return;
    const { deal, to } = pending;
    setPending(null);
    void run(deal, to, note);
  };

  const confirmDecline = async () => {
    if (!declining || !reason.trim()) return;
    const deal = declining;
    try {
      await decline.mutateAsync({ dealId: deal.id, reason, dealerMessage });
      toast({ title: `${deal.dealNumber} declined`, description: dealerMessage.trim() ? 'The dealer has been told.' : 'The dealer has been notified.' });
      setDeclining(null);
    } catch (e) {
      toast({ title: 'Could not decline the deal', description: errorMessage(e), variant: 'destructive' });
    } finally {
      opts.onSettled?.(deal);
    }
  };

  const dialogs: ReactNode = (
    <>
      <AlertDialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Move {pending?.deal.dealNumber} to {pending ? statusConfig(pending.to).label : ''}?
            </AlertDialogTitle>
            <AlertDialogDescription>{pending ? describeMove(pending.deal.status, pending.to) : ''}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="move-note">Note for the timeline (optional)</Label>
            <Textarea id="move-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why the deal is being moved" className="min-h-[64px]" />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button onClick={confirmMove}>Move deal</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!declining} onOpenChange={(o) => !o && setDeclining(null)}>
        <AlertDialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Decline deal {declining?.dealNumber}?</AlertDialogTitle>
            <AlertDialogDescription>The dealer is notified and open document requests are cancelled.</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="decline-reason">Internal reason <span className="text-destructive">*</span></Label>
              <Textarea id="decline-reason" value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder="Staff only — kept in the deal history" className="min-h-[64px]" aria-required="true" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="decline-dealer-message">Message to the dealer</Label>
              <Textarea id="decline-dealer-message" value={dealerMessage} onChange={(e) => setDealerMessage(e.target.value)}
                placeholder="What the dealer sees in their portal (optional)" className="min-h-[64px]" />
              <p className="text-xs text-muted-foreground">The dealer never sees the internal reason.</p>
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button variant="destructive" onClick={confirmDecline} disabled={!reason.trim() || decline.isPending}>
              {decline.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden /> : <XCircle className="h-4 w-4 mr-2" aria-hidden />}
              Decline deal
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );

  return { request, dialogs, moving: move.isPending, declining: decline.isPending, openDecline: (deal: MovableDeal) => request(deal, 'declined') };
}

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
