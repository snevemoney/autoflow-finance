import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/** "21–40 of 312" with previous / next buttons. */
export function Pager({ page, pageSize, total, onPage, loading, className }: {
  page: number; pageSize: number; total: number | undefined; onPage: (p: number) => void; loading?: boolean; className?: string;
}) {
  if (!total) return null;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);
  return (
    <nav className={cn('flex items-center justify-between gap-3 text-sm', className)} aria-label="Pages">
      <p className="text-muted-foreground" aria-live="polite">{from.toLocaleString('en-CA')}–{to.toLocaleString('en-CA')} of {total.toLocaleString('en-CA')}</p>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => onPage(page - 1)} disabled={page <= 0 || loading} aria-label="Previous page">
          <ChevronLeft className="h-4 w-4" aria-hidden /><span className="hidden sm:inline ml-1">Previous</span>
        </Button>
        <span className="text-muted-foreground tabular-nums">{page + 1} / {pages}</span>
        <Button variant="outline" size="sm" onClick={() => onPage(page + 1)} disabled={page >= pages - 1 || loading} aria-label="Next page">
          <span className="hidden sm:inline mr-1">Next</span><ChevronRight className="h-4 w-4" aria-hidden />
        </Button>
      </div>
    </nav>
  );
}

/** A table header that sorts on the server; announces its state with aria-sort. */
export function SortHeader({ label, column, sort, ascending, onSort, className }: {
  label: string; column: string; sort: string; ascending: boolean; onSort: (column: string) => void; className?: string;
}) {
  const active = sort === column;
  const Icon = !active ? ArrowUpDown : ascending ? ArrowUp : ArrowDown;
  return (
    <th aria-sort={active ? (ascending ? 'ascending' : 'descending') : 'none'} className={className}>
      <button type="button" onClick={() => onSort(column)}
        className={cn('inline-flex items-center gap-1 hover:text-foreground', active && 'text-foreground')}>
        {label}<Icon className="h-3 w-3" aria-hidden />
      </button>
    </th>
  );
}

export function RowsSkeleton({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-12 w-full" />)}
    </div>
  );
}

export function CardsSkeleton({ count = 6, className }: { count?: number; className?: string }) {
  return (
    <div className={cn('grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4', className)} aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => <Skeleton key={i} className="h-48 w-full rounded-lg" />)}
    </div>
  );
}

/** Small metric tile; shows a skeleton (never a zero) while loading. */
export function StatTile({ label, value, loading, tone, hint }: {
  label: string; value: React.ReactNode; loading?: boolean; tone?: 'success' | 'warning' | 'destructive' | 'accent'; hint?: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-3 sm:p-4 min-w-0">
      <p className="text-xs sm:text-sm text-muted-foreground truncate" title={label}>{label}</p>
      {loading ? <Skeleton className="h-7 w-16 mt-1" /> : (
        <p className={cn('text-xl sm:text-2xl font-bold truncate',
          tone === 'success' && 'text-success', tone === 'warning' && 'text-warning',
          tone === 'destructive' && 'text-destructive', tone === 'accent' && 'text-accent')}>{value}</p>
      )}
      {hint && !loading && <p className="text-[11px] text-muted-foreground truncate">{hint}</p>}
    </div>
  );
}
