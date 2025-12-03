import { useState } from 'react';
import { AppHeader } from '@/components/layout/AppHeader';
import { DealCard } from '@/components/deals/DealCard';
import { mockDeals } from '@/data/mockData';
import { Deal, DealStatus, DEAL_STATUS_CONFIG } from '@/types/deal';
import { cn } from '@/lib/utils';
import {
  DndContext,
  DragOverlay,
  closestCorners,
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

const PIPELINE_STAGES: DealStatus[] = [
  'new_submission',
  'document_review',
  'credit_review',
  'income_verification',
  'funding_review',
  'approved',
];

function SortableDealCard({ deal }: { deal: Deal }) {
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
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
    >
      <DealCard deal={deal} compact dragging={isDragging} />
    </div>
  );
}

export default function Pipeline() {
  const [deals, setDeals] = useState<Deal[]>(mockDeals);
  const [activeDeal, setActiveDeal] = useState<Deal | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
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

    const activeId = active.id as string;
    const overId = over.id as string;

    // Check if dropped on a column
    if (PIPELINE_STAGES.includes(overId as DealStatus)) {
      setDeals((prev) =>
        prev.map((deal) =>
          deal.id === activeId ? { ...deal, status: overId as DealStatus } : deal
        )
      );
    }
  };

  return (
    <div className="flex flex-col h-full">
      <AppHeader
        title="Deal Pipeline"
        subtitle="Drag and drop deals between stages"
      />

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
                <div
                  key={status}
                  id={status}
                  className="pipeline-column w-80"
                >
                  <div className="pipeline-column-header">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          'h-2 w-2 rounded-full',
                          status === 'new_submission' && 'bg-info',
                          status === 'document_review' && 'bg-warning',
                          status === 'credit_review' && 'bg-warning',
                          status === 'income_verification' && 'bg-warning',
                          status === 'funding_review' && 'bg-info',
                          status === 'approved' && 'bg-success'
                        )}
                      />
                      <h3 className="font-medium text-sm">{config.label}</h3>
                    </div>
                    <span className="text-xs font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                      {stageDeals.length}
                    </span>
                  </div>

                  <SortableContext
                    items={stageDeals.map((d) => d.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="space-y-3 flex-1 overflow-y-auto scrollbar-thin pr-1">
                      {stageDeals.map((deal) => (
                        <SortableDealCard key={deal.id} deal={deal} />
                      ))}
                      {stageDeals.length === 0 && (
                        <div className="text-center py-8 text-sm text-muted-foreground">
                          No deals in this stage
                        </div>
                      )}
                    </div>
                  </SortableContext>
                </div>
              );
            })}
          </div>

          <DragOverlay>
            {activeDeal && <DealCard deal={activeDeal} compact dragging />}
          </DragOverlay>
        </DndContext>
      </div>
    </div>
  );
}
