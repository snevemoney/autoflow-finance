import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  DndContext, DragOverlay, MouseSensor, TouchSensor, closestCorners, useDraggable, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { AppHeader } from '@/components/layout/AppHeader';
import { DealCard } from '@/components/deals/DealCard';
import { MoveToMenu } from '@/components/deals/DealMover';
import { useDealMover, type MovableDeal } from '@/hooks/use-deal-mover';
import { QueryError } from '@/components/QueryError';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/AuthContext';
import { useDealPage, type DealQuery } from '@/hooks/use-deals';
import { qk } from '@/lib/query-keys';
import { cn } from '@/lib/utils';
import { statusConfig, type Deal, type DealStatus } from '@/types/deal';

const OPEN_LIMIT = 100;
const CLOSED_LIMIT = 25;

const COLUMNS: { status: DealStatus; closed?: boolean }[] = [
  { status: 'new_submission' }, { status: 'document_review' }, { status: 'credit_review' }, { status: 'income_verification' },
  { status: 'funding_review' }, { status: 'approved' }, { status: 'funded', closed: true }, { status: 'declined', closed: true },
];

const DOT: Record<string, string> = {
  new_submission: 'bg-info', document_review: 'bg-warning', credit_review: 'bg-warning', income_verification: 'bg-warning',
  funding_review: 'bg-info', approved: 'bg-success', funded: 'bg-accent', declined: 'bg-destructive',
};

function columnQuery(status: DealStatus, closed?: boolean): DealQuery {
  return {
    statuses: [status],
    pageSize: closed ? CLOSED_LIMIT : OPEN_LIMIT,
    sort: status === 'funded' ? 'funded_at' : closed ? 'status_changed_at' : 'created_at',
    ascending: false,
    extras: ['requests'],
  };
}

function DraggableCard({ deal, children }: { deal: Deal; children: ReactNode }) {
  const { setNodeRef, listeners, isDragging } = useDraggable({ id: deal.id, data: { deal } });
  // pointer/touch listeners only: no keyboard drag, so Enter on the card's link still opens the deal
  return <div ref={setNodeRef} {...listeners} className={cn('touch-pan-y', isDragging && 'opacity-40')}>{children}</div>;
}

interface ColumnProps {
  status: DealStatus;
  closed?: boolean;
  isAdmin: boolean;
  overrides: Record<string, DealStatus>;
  moved: Record<string, Deal>;
  onMove: (deal: MovableDeal, to: DealStatus) => void;
}

function Column({ status, closed, isAdmin, overrides, moved, onMove }: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: status, disabled: !isAdmin });
  const { data, isLoading, isError, error, refetch, isFetching } = useDealPage(columnQuery(status, closed));
  const config = statusConfig(status);
  const fromServer = (data?.rows ?? []).filter((d) => !overrides[d.id] || overrides[d.id] === status);
  const incoming = Object.values(moved).filter((d) => overrides[d.id] === status && !fromServer.some((x) => x.id === d.id));
  const deals = [...incoming.map((d) => ({ ...d, status })), ...fromServer.map((d) => (overrides[d.id] ? { ...d, status } : d))];
  const total = data?.total ?? 0;
  const hidden = Math.max(0, total - (data?.rows.length ?? 0));

  return (
    <section
      ref={setNodeRef}
      aria-label={`${config.label}: ${total} deal${total === 1 ? '' : 's'}`}
      className={cn('pipeline-column w-[85vw] max-w-80 sm:w-80 shrink-0 snap-start transition-colors', isOver && 'ring-2 ring-accent/40')}
    >
      <div className="pipeline-column-header">
        <div className="flex items-center gap-2">
          <span className={cn('h-2 w-2 rounded-full', DOT[status])} aria-hidden />
          <h2 className="font-medium text-sm">{config.label}</h2>
        </div>
        <span className="text-xs font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
          {isLoading ? '…' : closed && total > CLOSED_LIMIT ? `latest ${CLOSED_LIMIT}` : total}
        </span>
      </div>
      <div className="space-y-3 flex-1 overflow-y-auto scrollbar-thin pr-1">
        {isError ? (
          <QueryError compact what={config.label.toLowerCase()} error={error} onRetry={() => refetch()} retrying={isFetching} />
        ) : isLoading ? (
          <>{[0, 1, 2].map((i) => <Skeleton key={i} className="h-40 w-full rounded-lg" />)}</>
        ) : (
          <>
            {deals.map((deal) => {
              const card = (
                <DealCard
                  deal={deal}
                  compact
                  actions={isAdmin ? <MoveToMenu compact deal={deal} onPick={(to) => onMove(deal, to)} /> : undefined}
                />
              );
              return isAdmin ? <DraggableCard key={deal.id} deal={deal}>{card}</DraggableCard> : <div key={deal.id}>{card}</div>;
            })}
            {deals.length === 0 && <p className="text-center py-8 text-sm text-muted-foreground">No deals in this stage</p>}
            {hidden > 0 && (
              <Link to={`/deals?status=${status}`} className="block rounded-md border border-dashed py-2 text-center text-sm text-accent hover:bg-accent/5">
                {closed ? `See all ${total.toLocaleString('en-CA')}` : `${hidden.toLocaleString('en-CA')} more`} in All Deals →
              </Link>
            )}
          </>
        )}
      </div>
    </section>
  );
}

export default function Pipeline() {
  const { isAdmin, user } = useAuth();
  const qc = useQueryClient();
  const [overrides, setOverrides] = useState<Record<string, DealStatus>>({});
  const [moved, setMoved] = useState<Record<string, Deal>>({});
  const [active, setActive] = useState<Deal | null>(null);

  const clear = (dealId: string) => {
    setOverrides((o) => { const n = { ...o }; delete n[dealId]; return n; });
    setMoved((m) => { const n = { ...m }; delete n[dealId]; return n; });
  };

  const mover = useDealMover({
    onMoved: (deal, to) => setOverrides((o) => ({ ...o, [deal.id]: to })),
    onSettled: async (deal) => {
      await qc.refetchQueries({ queryKey: qk.deals(user?.id) });
      clear(deal.id);
    },
  });

  const requestMove = (deal: MovableDeal, to: DealStatus) => {
    setMoved((m) => ({ ...m, [deal.id]: deal as Deal }));
    mover.request(deal, to);
  };

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
  );

  const onDragStart = (e: DragStartEvent) => setActive((e.active.data.current as { deal: Deal } | undefined)?.deal ?? null);
  const onDragEnd = (e: DragEndEvent) => {
    setActive(null);
    const deal = (e.active.data.current as { deal: Deal } | undefined)?.deal;
    const to = e.over?.id as DealStatus | undefined;
    if (!deal || !to || to === deal.status) return;
    requestMove(deal, to);
  };

  const subtitle = isAdmin
    ? 'Deals move on their own as each step completes — drag a card or use its move button to override'
    : 'Deals move on their own as each step completes';

  const board = (
    <div className="flex gap-4 h-full min-w-max snap-x snap-mandatory sm:snap-none">
      {COLUMNS.map((c) => (
        <Column key={c.status} {...c} isAdmin={isAdmin} overrides={overrides} moved={moved} onMove={requestMove} />
      ))}
    </div>
  );

  return (
    <div className="flex flex-col h-full">
      <AppHeader title="Deal Pipeline" subtitle={subtitle} />
      <div className="flex-1 overflow-x-auto overscroll-x-contain p-4 lg:p-6 snap-x snap-mandatory sm:snap-none scroll-px-4">
        {isAdmin ? (
          <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActive(null)}>
            {board}
            <DragOverlay>{active && <DealCard deal={active} compact dragging />}</DragOverlay>
          </DndContext>
        ) : board}
      </div>
      {mover.dialogs}
    </div>
  );
}
