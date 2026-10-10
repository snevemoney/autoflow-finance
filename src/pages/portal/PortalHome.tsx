import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Search, AlertTriangle, CheckCircle2, Clock, FileUp } from 'lucide-react';
import { AppHeader } from '@/components/layout/AppHeader';
import { StatusBadge } from '@/components/deals/StatusBadge';
import { PortalFooter } from '@/components/portal/PortalFooter';
import { QueryError } from '@/components/QueryError';
import { Pager, RowsSkeleton, StatTile } from '@/components/ListControls';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDealCount, useDealPage, useQueueCounts } from '@/hooks/use-deals';
import { useOpenDealerRequests, usePreferences, type DealerRequest } from '@/hooks/use-autoflow';
import { useUrlParams, useUrlSearch } from '@/hooks/use-url-state';
import { useAuth } from '@/contexts/AuthContext';
import { ago, cn } from '@/lib/utils';

const PAGE_SIZE = 20;

export default function PortalHome() {
  const navigate = useNavigate();
  const { dealerName } = useAuth();
  const { prefs } = usePreferences();
  const { get, set } = useUrlParams();
  const search = useUrlSearch('q');
  const page = Math.max(0, (parseInt(get('page') || '1', 10) || 1) - 1);

  // RLS limits every one of these to the dealer's own deals
  const list = useDealPage({ search: search.value, page, pageSize: PAGE_SIZE, sort: 'updated_at', extras: ['requests'] });
  const counts = useQueueCounts();
  const funded = useDealCount({ statuses: ['funded'] });
  const requests = useOpenDealerRequests();

  const reqs = useMemo(() => requests.data ?? [], [requests.data]);
  const byDeal = useMemo(() => {
    const m = new Map<string, DealerRequest[]>();
    for (const r of reqs) m.set(r.deal_id, [...(m.get(r.deal_id) ?? []), r]);
    return m;
  }, [reqs]);

  const c = counts.data;
  const inProgress = c ? c.new_submission + c.document_review + c.credit_review + c.income_verification + c.funding_review + c.approved : null;
  const rows = list.data?.rows ?? [];
  const total = list.data?.total;

  return (
    <div className="flex flex-col h-full">
      <AppHeader title="My Deals" subtitle={dealerName ? `${dealerName} · financing with ${prefs.company_name}` : 'Dealer portal'} />
      <div className="flex-1 overflow-y-auto p-4 lg:p-6 space-y-6 scrollbar-thin">
        {requests.isError ? (
          <QueryError compact what="the document requests" error={requests.error} onRetry={() => requests.refetch()} />
        ) : reqs.length > 0 && (
          <section className="rounded-xl border border-warning/40 bg-warning/5 p-4" aria-label="Documents requested">
            <h2 className="flex items-center gap-2 font-semibold text-warning">
              <AlertTriangle className="h-4 w-4" aria-hidden />
              {reqs.length} document{reqs.length === 1 ? '' : 's'} requested on {byDeal.size} deal{byDeal.size === 1 ? '' : 's'}
            </h2>
            <ul className="mt-3 space-y-2">
              {[...byDeal.entries()].slice(0, 5).map(([dealId, items]) => {
                const d = items[0].deals;
                const customer = d?.customers ? `${d.customers.first_name} ${d.customers.last_name}` : '';
                return (
                  <li key={dealId} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-lg bg-card border px-3 py-2 text-sm">
                    <span className="min-w-0">
                      <span className="font-mono text-xs text-muted-foreground mr-2">{d?.deal_number}</span>
                      {customer}{customer ? ' — ' : ''}{items.map((x) => x.label).join(', ')}
                    </span>
                    <Button size="sm" asChild className="self-start sm:self-auto">
                      <Link to={`/portal/deals/${dealId}`}><FileUp className="h-3 w-3 mr-1" aria-hidden /> Upload</Link>
                    </Button>
                  </li>
                );
              })}
            </ul>
            {byDeal.size > 5 && <p className="mt-2 text-xs text-muted-foreground">and {byDeal.size - 5} more deal{byDeal.size - 5 === 1 ? '' : 's'} — see “Needs” below.</p>}
          </section>
        )}

        <div className="grid grid-cols-3 gap-2 sm:gap-4">
          <StatTile label="In progress" value={inProgress ?? '—'} loading={counts.isLoading} />
          <StatTile label="Need your documents" value={requests.data ? byDeal.size : '—'} loading={requests.isLoading} tone={byDeal.size ? 'warning' : undefined} />
          <StatTile label="Funded" value={funded.data ?? '—'} loading={funded.isLoading} tone="success" />
        </div>

        <section className="bg-card rounded-xl border" aria-label="My deals">
          <div className="flex flex-wrap items-center gap-3 p-4 border-b">
            <div className="relative w-full sm:flex-1 sm:max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input type="search" value={search.input} onChange={(e) => search.setInput(e.target.value)}
                placeholder="Search by deal #, customer or vehicle…" aria-label="Search my deals" className="pl-9" />
            </div>
            <Button className="w-full sm:w-auto sm:ml-auto" onClick={() => navigate('/portal/new')}><Plus className="h-4 w-4 mr-2" aria-hidden /> Submit a deal</Button>
          </div>
          {list.isError ? (
            <div className="p-4"><QueryError what="your deals" error={list.error} onRetry={() => list.refetch()} retrying={list.isFetching} /></div>
          ) : list.isLoading ? (
            <div className="p-4"><RowsSkeleton rows={5} /></div>
          ) : !rows.length ? (
            <div className="py-12 text-center space-y-3 px-4">
              <p className="text-muted-foreground">{search.value ? 'No deals match your search.' : 'You haven\'t submitted a deal yet.'}</p>
              {!search.value && <Button onClick={() => navigate('/portal/new')}><Plus className="h-4 w-4 mr-2" aria-hidden /> Submit your first deal</Button>}
            </div>
          ) : (
            <>
              <ul className={cn('md:hidden divide-y', list.isPlaceholderData && 'opacity-60')}>
                {rows.map((d) => {
                  const n = byDeal.get(d.id)?.length ?? d.openRequests ?? 0;
                  return (
                    <li key={d.id}>
                      <Link to={`/portal/deals/${d.id}`} className="block p-4 hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-medium truncate">{d.customer.firstName} {d.customer.lastName}</p>
                            <p className="font-mono text-xs text-muted-foreground">{d.dealNumber}</p>
                          </div>
                          <StatusBadge status={d.status} size="sm" />
                        </div>
                        <p className="text-sm text-muted-foreground mt-1 truncate">{d.vehicle.year || ''} {d.vehicle.make} {d.vehicle.model} · ${d.financingTerms.loanAmount.toLocaleString('en-CA')}</p>
                        <p className="text-xs mt-1 flex justify-between">
                          {n ? <span className="text-warning font-medium">{n} document{n === 1 ? '' : 's'} needed</span> : <span />}
                          <span className="text-muted-foreground">Updated {ago(d.updatedAt)}</span>
                        </p>
                      </Link>
                    </li>
                  );
                })}
              </ul>
              <div className={cn('hidden md:block overflow-x-auto', list.isPlaceholderData && 'opacity-60')}>
                <table className="data-table">
                  <thead>
                    <tr><th>Deal #</th><th>Customer</th><th>Vehicle</th><th>Amount</th><th>Status</th><th>Needs</th><th>Updated</th></tr>
                  </thead>
                  <tbody>
                    {rows.map((d) => {
                      const n = byDeal.get(d.id)?.length ?? d.openRequests ?? 0;
                      return (
                        <tr key={d.id} className="cursor-pointer" onClick={() => navigate(`/portal/deals/${d.id}`)}>
                          <td className="font-mono text-sm">
                            <Link to={`/portal/deals/${d.id}`} onClick={(e) => e.stopPropagation()} className="hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">{d.dealNumber}</Link>
                          </td>
                          <td className="font-medium">{d.customer.firstName} {d.customer.lastName}</td>
                          <td className="text-sm">{d.vehicle.year || ''} {d.vehicle.make} {d.vehicle.model}</td>
                          <td className="font-medium">${d.financingTerms.loanAmount.toLocaleString('en-CA')}</td>
                          <td><StatusBadge status={d.status} size="sm" /></td>
                          <td className="text-sm">{n ? <span className="text-warning font-medium">{n} doc{n === 1 ? '' : 's'}</span> : <span className="text-muted-foreground">—</span>}</td>
                          <td className="text-sm text-muted-foreground whitespace-nowrap">{ago(d.updatedAt)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Pager className="p-4 border-t" page={page} pageSize={PAGE_SIZE} total={total} loading={list.isFetching} onPage={(p) => set({ page: p > 0 ? p + 1 : null })} />
            </>
          )}
        </section>
        <PortalFooter />
      </div>
    </div>
  );
}
