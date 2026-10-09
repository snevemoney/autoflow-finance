import { useState } from 'react';
import { AppHeader } from '@/components/layout/AppHeader';
import { DealCard } from '@/components/deals/DealCard';
import { useDeals } from '@/hooks/use-deals';
import { Deal, DealStatus, DEAL_STATUS_CONFIG } from '@/types/deal';
import { cn } from '@/lib/utils';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  useDroppable,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Loader2 } from 'lucide-react';
import { useSetDealStatus, useOpenRequestCounts } from '@/hooks/use-autoflow';
import { toast } from '@/hooks/use-toast';
import type { ReactNode } from 'react';

const PIPELINE_STAGES: DealStatus[] = [
  'new_submission',
  'document_review',
  'credit_review',
  'income_verification',
  'funding_review',
  'approved',
  'funded',
];

const DOT: Record<string, string> = {
  new_submission: 'bg-info', document_review: 'bg-warning', credit_review: 'bg-warning',
  income_verification: 'bg-warning', funding_review: 'bg-info', approved: 'bg-success', funded: 'bg-accent',
};

function Column({ status, children }: { status: DealStatus; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <div ref={setNodeRef} id={status} className={cn('pipeline-column w-80 transition-colors', isOver && 'ring-2 ring-accent/40')}>
      {children}
    </div>
  );
}

function SortableDealCard({ deal, openRequests }: { deal: Deal; openRequests?: number }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: deal.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <DealCard deal={deal} compact dragging={isDragging} openRequests={openRequests} />
    </div>
  );
}

export default function Pipeline() {
  const { data: dbDeals = [], isLoading } = useDeals();
  const setStatus = useSetDealStatus();
  const { data: requestCounts } = useOpenRequestCounts();
  const [localOverrides, setLocalOverrides] = useState<Record<string, DealStatus>>({});
  const [activeDeal, setActiveDeal] = useState<Deal | null>(null);

  // Apply local drag overrides on top of DB data
  const deals = dbDeals.map(d => localOverrides[d.id] ? { ...d, status: localOverrides[d.id] } : d);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const getDealsByStatus = (status: DealStatus) =>
    deals.filter((deal) => deal.status === status);

  const handleDragStart = (event: DragStartEvent) => {
    const deal = deals.find((d) => d.id === event.active.id);
    if (deal) setActiveDeal(deal);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDeal(null);
    const { active, over } = event;
    if (!over) return;
    const overId = over.id as string;
    const target = PIPELINE_STAGES.includes(overId as DealStatus)
      ? (overId as DealStatus)
      : deals.find((d) => d.id === overId)?.status;
    const deal = deals.find((d) => d.id === active.id);
    if (!deal || !target || target === deal.status || !PIPELINE_STAGES.includes(target)) return;
    if (target === 'funded' && !deal.fundedAt && deal.status !== 'approved') {
      toast({ title: 'Only approved deals can be funded', description: 'Approve funding first.', variant: 'destructive' });
      return;
    }
    setLocalOverrides(prev => ({ ...prev, [deal.id]: target }));
    setStatus.mutate({ dealId: deal.id, status: target }, {
      onSuccess: () => toast({ title: `${deal.dealNumber} → ${DEAL_STATUS_CONFIG[target].label}` }),
      onError: (e) => {
        toast({ title: 'Could not move deal', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
      },
      onSettled: () => setLocalOverrides(prev => { const next = { ...prev }; delete next[deal.id]; return next; }),
    });
  };

  if (isLoading) {
    return (
      <div className="flex flex-col h-full">
        <AppHeader title="Deal Pipeline" subtitle="Deals move on their own as each step completes — drag to override" />
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <AppHeader title="Deal Pipeline" subtitle="Deals move on their own as each step completes — drag to override" />
      <div className="flex-1 overflow-x-auto p-6">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="flex gap-4 h-full min-w-max">
            {PIPELINE_STAGES.map((status) => {
              const stageDeals = getDealsByStatus(status);
              const config = DEAL_STATUS_CONFIG[status];
              return (
                <Column key={status} status={status}>
                  <div className="pipeline-column-header">
                    <div className="flex items-center gap-2">
                      <span className={cn('h-2 w-2 rounded-full', DOT[status])} />
                      <h3 className="font-medium text-sm">{config.label}</h3>
                    </div>
                    <span className="text-xs font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                      {stageDeals.length}
                    </span>
                  </div>
                  <SortableContext items={stageDeals.map(d => d.id)} strategy={verticalListSortingStrategy}>
                    <div className="space-y-3 flex-1 overflow-y-auto scrollbar-thin pr-1">
                      {stageDeals.map(deal => <SortableDealCard key={deal.id} deal={deal} openRequests={requestCounts?.get(deal.id)} />)}
                      {stageDeals.length === 0 && (
                        <div className="text-center py-8 text-sm text-muted-foreground">No deals in this stage</div>
                      )}
                    </div>
                  </SortableContext>
                </Column>
              );
            })}
          </div>
          <DragOverlay>{activeDeal && <DealCard deal={activeDeal} compact dragging />}</DragOverlay>
        </DndContext>
      </div>
    </div>
  );
}
