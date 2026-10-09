import { ago } from '@/lib/utils';
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Search, AlertTriangle, CheckCircle2, Clock, FileUp, Loader2 } from 'lucide-react';
import { AppHeader } from '@/components/layout/AppHeader';
import { StatusBadge } from '@/components/deals/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDeals } from '@/hooks/use-deals';
import { useOpenDealerRequests } from '@/hooks/use-autoflow';
import { useAuth } from '@/contexts/AuthContext';

export default function PortalHome() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { dealerName } = useAuth();
  const { data: deals = [], isLoading } = useDeals();
  const { data: requests = [] } = useOpenDealerRequests();
  const [q, setQ] = useState(params.get('q') ?? '');

  const requestsByDeal = useMemo(() => {
    const m = new Map<string, typeof requests>();
    for (const r of requests) m.set(r.deal_id, [...(m.get(r.deal_id) ?? []), r]);
    return m;
  }, [requests]);

  const filtered = deals.filter((d) => {
    const s = q.toLowerCase();
    return !s || d.dealNumber.toLowerCase().includes(s) || `${d.customer.firstName} ${d.customer.lastName}`.toLowerCase().includes(s)
      || `${d.vehicle.make} ${d.vehicle.model}`.toLowerCase().includes(s);
  });
  const inProgress = deals.filter((d) => !['funded', 'declined', 'incomplete'].includes(d.status)).length;
  const funded = deals.filter((d) => d.status === 'funded').length;
  const dealsNeedingAction = [...requestsByDeal.keys()].length;

  return (
    <div className="flex flex-col h-full">
      <AppHeader title="My Deals" subtitle={dealerName ?? 'Dealer portal'} />
      <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin">
        {requests.length > 0 && (
          <div className="rounded-xl border border-warning/40 bg-warning/5 p-4">
            <p className="flex items-center gap-2 font-semibold text-warning">
              <AlertTriangle className="h-4 w-4" />
              {requests.length} document{requests.length === 1 ? '' : 's'} requested on {dealsNeedingAction} deal{dealsNeedingAction === 1 ? '' : 's'}
            </p>
            <div className="mt-3 space-y-2">
              {[...requestsByDeal.entries()].slice(0, 5).map(([dealId, reqs]) => {
                const deal = deals.find((d) => d.id === dealId);
                return (
                  <div key={dealId} className="flex items-center justify-between gap-3 rounded-lg bg-card border px-3 py-2 text-sm">
                    <span className="min-w-0 truncate">
                      <span className="font-mono text-xs text-muted-foreground mr-2">{deal?.dealNumber}</span>
                      {deal ? `${deal.customer.firstName} ${deal.customer.lastName}` : ''} — {reqs.map((r) => r.label).join(', ')}
                    </span>
                    <Button size="sm" onClick={() => navigate(`/portal/deals/${dealId}`)}>
                      <FileUp className="h-3 w-3 mr-1" /> Upload
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="stat-card"><p className="metric-label flex items-center gap-1"><Clock className="h-4 w-4" /> In progress</p><p className="metric-value mt-1">{inProgress}</p></div>
          <div className="stat-card"><p className="metric-label flex items-center gap-1"><AlertTriangle className="h-4 w-4" /> Need your documents</p><p className="metric-value mt-1">{dealsNeedingAction}</p></div>
          <div className="stat-card"><p className="metric-label flex items-center gap-1"><CheckCircle2 className="h-4 w-4" /> Funded</p><p className="metric-value mt-1">{funded}</p></div>
        </div>

        <div className="bg-card rounded-xl border">
          <div className="flex flex-wrap items-center gap-3 p-4 border-b">
            <div className="relative flex-1 min-w-[220px] max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by deal #, customer or vehicle…" className="pl-9" />
            </div>
            <Button className="ml-auto" onClick={() => navigate('/portal/new')}><Plus className="h-4 w-4 mr-2" /> Submit a deal</Button>
          </div>
          {isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : !filtered.length ? (
            <div className="py-12 text-center space-y-3">
              <p className="text-muted-foreground">{deals.length ? 'No deals match your search.' : 'You haven\'t submitted a deal yet.'}</p>
              {!deals.length && <Button onClick={() => navigate('/portal/new')}><Plus className="h-4 w-4 mr-2" /> Submit your first deal</Button>}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr><th>Deal #</th><th>Customer</th><th>Vehicle</th><th>Amount</th><th>Status</th><th>Needs</th><th>Updated</th></tr>
                </thead>
                <tbody>
                  {filtered.map((d) => {
                    const reqs = requestsByDeal.get(d.id) ?? [];
                    return (
                      <tr key={d.id} className="cursor-pointer" onClick={() => navigate(`/portal/deals/${d.id}`)}>
                        <td className="font-mono text-sm">{d.dealNumber}</td>
                        <td className="font-medium">{d.customer.firstName} {d.customer.lastName}</td>
                        <td className="text-sm">{d.vehicle.year} {d.vehicle.make} {d.vehicle.model}</td>
                        <td className="font-medium">${d.financingTerms.loanAmount.toLocaleString('en-CA')}</td>
                        <td><StatusBadge status={d.status} size="sm" /></td>
                        <td className="text-sm">{reqs.length ? <span className="text-warning font-medium">{reqs.length} doc{reqs.length === 1 ? '' : 's'}</span> : <span className="text-muted-foreground">—</span>}</td>
                        <td className="text-sm text-muted-foreground">{ago(d.updatedAt, { addSuffix: true })}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
