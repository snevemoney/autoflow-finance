import type { ReactNode } from 'react';
import { Search, SlidersHorizontal } from 'lucide-react';
import { DealCard } from '@/components/deals/DealCard';
import { QueryError } from '@/components/QueryError';
import { CardsSkeleton, Pager } from '@/components/ListControls';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useDealPage, type DealExtra, type DealQuery, type DealSortKey } from '@/hooks/use-deals';
import { usePreferences } from '@/hooks/use-autoflow';
import { useUrlParams, useUrlSearch } from '@/hooks/use-url-state';
import { cn } from '@/lib/utils';
import type { DealStatus } from '@/types/deal';

export interface QueueSort { value: string; label: string; sort: DealSortKey; ascending?: boolean }
export interface QueueFilter { value: string; label: string; statuses: DealStatus[] }

interface QueueViewProps {
  id: string;
  statuses: DealStatus[];
  /** optional tabs within the queue (e.g. Funding review / Approved) */
  filters?: QueueFilter[];
  sorts: QueueSort[];
  extras?: DealExtra[];
  stats?: ReactNode;
  emptyText: string;
  pageSize?: number;
  /** extra filter merged into the query (e.g. only waiting on dealer) */
  query?: Partial<DealQuery>;
  toolbar?: ReactNode;
}

/** A department queue: server-side status filter, search, sort and paging; deal cards that open the deal. */
export function QueueView({ id, statuses, filters, sorts, extras = ['requests'], stats, emptyText, pageSize = 24, query, toolbar }: QueueViewProps) {
  const { get, set } = useUrlParams();
  const search = useUrlSearch('q');
  const { prefs } = usePreferences();
  const sortOpt = sorts.find((s) => s.value === get('sort')) ?? sorts[0];
  const filterOpt = filters?.find((f) => f.value === get('stage')) ?? null;
  const page = Math.max(0, (parseInt(get('page') || '1', 10) || 1) - 1);

  const q: DealQuery = {
    statuses: filterOpt?.statuses ?? statuses,
    search: search.value,
    sort: sortOpt.sort,
    ascending: sortOpt.ascending ?? false,
    page,
    pageSize,
    extras,
    ...query,
  };
  const { data, isLoading, isError, error, refetch, isFetching, isPlaceholderData } = useDealPage(q);
  const rows = data?.rows ?? [];

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin">
      {stats && <div className="p-4 lg:p-6 pb-0">{stats}</div>}

      <div className="px-4 lg:px-6 pt-4 pb-3 flex flex-wrap items-center gap-2 sm:gap-3">
        <div className="relative w-full sm:flex-1 sm:max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input type="search" aria-label="Search this queue" placeholder="Search deal #, customer or vehicle…"
            value={search.input} onChange={(e) => search.setInput(e.target.value)} className="pl-9" />
        </div>
        {filters && (
          <Select value={filterOpt?.value ?? 'all'} onValueChange={(v) => set({ stage: v === 'all' ? null : v })}>
            <SelectTrigger className="w-[calc(50%-4px)] sm:w-48" aria-label="Show stage"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All in this queue</SelectItem>
              {filters.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <div className="flex items-center gap-2 w-[calc(50%-4px)] sm:w-auto">
          <Label htmlFor={`${id}-sort`} className="sr-only">Sort by</Label>
          <Select value={sortOpt.value} onValueChange={(v) => set({ sort: v === sorts[0].value ? null : v })}>
            <SelectTrigger id={`${id}-sort`} className="w-full sm:w-48">
              <SlidersHorizontal className="h-4 w-4 mr-2 shrink-0" aria-hidden />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>{sorts.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {toolbar}
      </div>

      <div className="px-4 lg:px-6 pb-6 space-y-4">
        {isError ? (
          <QueryError what="this queue" error={error} onRetry={() => refetch()} retrying={isFetching} />
        ) : isLoading ? (
          <CardsSkeleton />
        ) : !rows.length ? (
          <p className="rounded-lg border py-12 px-4 text-center text-muted-foreground">
            {search.value || filterOpt || query ? 'No deals match.' : emptyText}
          </p>
        ) : (
          <>
            <ul className={cn('grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4', isPlaceholderData && 'opacity-60')}>
              {rows.map((deal) => (
                <li key={deal.id}><DealCard deal={deal} maxPti={prefs.max_pti} maxDti={prefs.max_dti} /></li>
              ))}
            </ul>
            <Pager page={page} pageSize={pageSize} total={data?.total} loading={isFetching} onPage={(p) => set({ page: p > 0 ? p + 1 : null })} />
          </>
        )}
      </div>
    </div>
  );
}
