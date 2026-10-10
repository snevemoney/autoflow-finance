import { Link, useNavigate } from 'react-router-dom';
import { Search, Filter, Download, Loader2, Plus, AlertTriangle, X } from 'lucide-react';
import { AppHeader } from '@/components/layout/AppHeader';
import { StatusBadge } from '@/components/deals/StatusBadge';
import { QueryError } from '@/components/QueryError';
import { Pager, RowsSkeleton, SortHeader } from '@/components/ListControls';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useDealCount, useDealPage, useDealers, type DealQuery, type DealSortKey } from '@/hooks/use-deals';
import { usePreferences } from '@/hooks/use-autoflow';
import { useUrlParams, useUrlSearch } from '@/hooks/use-url-state';
import { useDealExport } from '@/hooks/use-deal-export';
import { ALL_DEAL_STATUSES, DEAL_STATUS_CONFIG, isDealStatus } from '@/types/deal';
import { ago, cn } from '@/lib/utils';

const PAGE_SIZE = 25;
const SORTS: DealSortKey[] = ['created_at', 'deal_number', 'loan_amount', 'credit_score', 'ltv', 'status'];

const scoreColor = (score?: number) => {
  if (!score) return 'text-muted-foreground';
  if (score >= 720) return 'text-success';
  if (score >= 660) return 'text-info';
  if (score >= 600) return 'text-warning';
  return 'text-destructive';
};

export default function DealsList() {
  const navigate = useNavigate();
  const { get, set } = useUrlParams();
  const search = useUrlSearch('q');
  const { prefs } = usePreferences();
  const { data: dealers = [] } = useDealers();
  const exporter = useDealExport();

  const statusParam = get('status');
  const status = isDealStatus(statusParam) ? statusParam : null;
  const dealerId = get('dealer') || null;
  const sort = (SORTS as string[]).includes(get('sort')) ? (get('sort') as DealSortKey) : 'created_at';
  const ascending = get('dir') === 'asc';
  const page = Math.max(0, parseInt(get('page') || '1', 10) - 1) || 0;
  const attention = get('attention') === '1';
  const staleDays = prefs.stale_days;

  const filters: DealQuery = {
    statuses: status ? [status] : undefined,
    dealerId,
    search: search.value,
    stuckDays: attention ? staleDays : null,
  };
  const query: DealQuery = { ...filters, sort, ascending, page, pageSize: PAGE_SIZE, extras: ['requests'] };
  const { data, isLoading, isError, error, refetch, isFetching, isPlaceholderData } = useDealPage(query);
  const stuck = useDealCount({ stuckDays: staleDays });
  const rows = data?.rows ?? [];
  const total = data?.total;
  const filtered = !!(status || dealerId || search.value || attention);

  const onSort = (column: string) => {
    if (column === sort) set({ dir: ascending ? 'desc' : 'asc' });
    else set({ sort: column === 'created_at' ? null : column, dir: column === 'deal_number' ? 'asc' : null });
  };

  const clearFilters = () => {
    search.setInput('');
    set({ status: null, dealer: null, attention: null, q: null });
  };

  return (
    <div className="flex flex-col h-full">
      <AppHeader
        title="All Deals"
        subtitle={isLoading ? 'Loading…' : total != null ? `${total.toLocaleString('en-CA')} deal${total === 1 ? '' : 's'}${filtered ? ' match' : ''}` : undefined}
      />

      <div className="flex-1 overflow-hidden flex flex-col">
        {/* Filters */}
        <div className="p-4 lg:p-6 pb-4 border-b bg-card">
          <div className="flex flex-wrap items-center gap-2 lg:gap-3">
            <div className="relative w-full sm:w-auto sm:flex-1 sm:min-w-[220px] sm:max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                type="search"
                placeholder="Search deal #, customer or vehicle…"
                aria-label="Search deals"
                value={search.input}
                onChange={(e) => search.setInput(e.target.value)}
                className="pl-9"
              />
            </div>

            <Select value={status ?? 'all'} onValueChange={(v) => set({ status: v === 'all' ? null : v })}>
              <SelectTrigger className="w-[calc(50%-4px)] sm:w-44" aria-label="Filter by status">
                <Filter className="h-4 w-4 mr-2 shrink-0" aria-hidden />
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {ALL_DEAL_STATUSES.map((s) => <SelectItem key={s} value={s}>{DEAL_STATUS_CONFIG[s].label}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={dealerId ?? 'all'} onValueChange={(v) => set({ dealer: v === 'all' ? null : v })}>
              <SelectTrigger className="w-[calc(50%-4px)] sm:w-48" aria-label="Filter by dealer">
                <SelectValue placeholder="Dealer" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All dealers</SelectItem>
                {dealers.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>

            <Button variant={attention ? 'default' : 'outline'} aria-pressed={attention} onClick={() => set({ attention: attention ? null : '1' })}>
              <AlertTriangle className="h-4 w-4 mr-2" aria-hidden />
              Stuck &gt; {staleDays}d{stuck.data ? ` (${stuck.data})` : ''}
            </Button>

            {filtered && (
              <Button variant="ghost" onClick={clearFilters}><X className="h-4 w-4 mr-1" aria-hidden /> Clear</Button>
            )}

            <div className="flex items-center gap-2 sm:ml-auto">
              <Button variant="outline" disabled={!total || exporter.running}
                onClick={() => exporter.run(filters, `autoflow-deals-${new Date().toISOString().slice(0, 10)}.csv`)}>
                {exporter.running ? <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden /> : <Download className="h-4 w-4 mr-2" aria-hidden />}
                {exporter.running
                  ? `Exporting ${exporter.progress?.loaded.toLocaleString('en-CA') ?? 0}${exporter.progress?.total ? ` / ${Math.min(exporter.progress.total, 10_000).toLocaleString('en-CA')}` : ''}`
                  : 'Export'}
              </Button>
              {exporter.running && <Button variant="ghost" size="sm" onClick={exporter.cancel}>Cancel</Button>}
              <Button onClick={() => navigate('/deals/new')}>
                <Plus className="h-4 w-4 mr-2" aria-hidden /> New deal
              </Button>
            </div>
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-auto p-4 lg:p-6 space-y-4">
          {isError ? (
            <QueryError what="the deals" error={error} onRetry={() => refetch()} retrying={isFetching} />
          ) : isLoading ? (
            <RowsSkeleton rows={8} />
          ) : !rows.length ? (
            <div className="rounded-lg border py-12 text-center text-muted-foreground space-y-3">
              <p>{filtered ? 'No deals match these filters.' : 'No deals yet — dealers submit from their portal, or click “New deal”.'}</p>
              {filtered && <Button variant="outline" size="sm" onClick={clearFilters}>Clear filters</Button>}
            </div>
          ) : (
            <>
              {/* phones: stacked cards */}
              <ul className={cn('md:hidden space-y-2', isPlaceholderData && 'opacity-60')}>
                {rows.map((deal) => (
                  <li key={deal.id}>
                    <Link to={`/deals/${deal.id}`} className="block rounded-lg border bg-card p-3 hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium truncate">{deal.customer.firstName} {deal.customer.lastName}</p>
                          <p className="font-mono text-xs text-muted-foreground">{deal.dealNumber}</p>
                        </div>
                        <StatusBadge status={deal.status} size="sm" />
                      </div>
                      <p className="text-sm text-muted-foreground mt-1 truncate">{deal.vehicle.year || ''} {deal.vehicle.make} {deal.vehicle.model} · {deal.dealerName}</p>
                      <div className="flex items-center justify-between mt-2 text-sm">
                        <span className="font-semibold">${deal.financingTerms.loanAmount.toLocaleString('en-CA')}</span>
                        <span className="text-xs text-muted-foreground">
                          {deal.openRequests ? <span className="text-warning font-medium mr-2">{deal.openRequests} doc{deal.openRequests === 1 ? '' : 's'} requested</span> : null}
                          {ago(deal.createdAt)}
                        </span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>

              {/* tablet / desktop: table */}
              <div className={cn('hidden md:block rounded-lg border overflow-x-auto', isPlaceholderData && 'opacity-60')}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <SortHeader label="Deal #" column="deal_number" sort={sort} ascending={ascending} onSort={onSort} />
                      <th>Customer</th>
                      <th>Vehicle</th>
                      <SortHeader label="Loan" column="loan_amount" sort={sort} ascending={ascending} onSort={onSort} />
                      <SortHeader label="Score" column="credit_score" sort={sort} ascending={ascending} onSort={onSort} />
                      <SortHeader label="LTV" column="ltv" sort={sort} ascending={ascending} onSort={onSort} />
                      <th>Dealer</th>
                      <SortHeader label="Status" column="status" sort={sort} ascending={ascending} onSort={onSort} />
                      <SortHeader label="Submitted" column="created_at" sort={sort} ascending={ascending} onSort={onSort} />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((deal) => (
                      <tr key={deal.id} onClick={() => navigate(`/deals/${deal.id}`)} className="cursor-pointer">
                        <td className="font-mono text-sm whitespace-nowrap">
                          <Link to={`/deals/${deal.id}`} onClick={(e) => e.stopPropagation()} className="hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
                            {deal.dealNumber}
                          </Link>
                        </td>
                        <td>
                          <p className="font-medium">{deal.customer.firstName} {deal.customer.lastName}</p>
                          <p className="text-xs text-muted-foreground">{deal.customer.email}</p>
                        </td>
                        <td>
                          <p className="text-sm">{deal.vehicle.year || ''} {deal.vehicle.make} {deal.vehicle.model}</p>
                          <p className="text-xs text-muted-foreground font-mono">{deal.vehicle.vin}</p>
                        </td>
                        <td className="font-medium whitespace-nowrap">${deal.financingTerms.loanAmount.toLocaleString('en-CA')}</td>
                        <td><span className={scoreColor(deal.creditInfo?.score)}>{deal.creditInfo?.score || '—'}</span></td>
                        <td>{deal.ltv ? `${deal.ltv}%` : '—'}</td>
                        <td className="text-sm">
                          {deal.dealerName}
                          {deal.openRequests ? <p className="text-xs text-warning font-medium">{deal.openRequests} doc{deal.openRequests === 1 ? '' : 's'} requested</p> : null}
                        </td>
                        <td><StatusBadge status={deal.status} size="sm" /></td>
                        <td className="text-sm text-muted-foreground whitespace-nowrap">{ago(deal.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <Pager page={page} pageSize={PAGE_SIZE} total={total} loading={isFetching} onPage={(p) => set({ page: p > 0 ? p + 1 : null })} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
