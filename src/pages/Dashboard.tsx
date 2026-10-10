import { useNavigate } from 'react-router-dom';
import {
  FileText, DollarSign, CheckCircle2, Clock, TrendingUp, AlertTriangle, Plus, Sparkles, FileSearch, Send, Route, Calculator,
} from 'lucide-react';
import { AppHeader } from '@/components/layout/AppHeader';
import { StatCard } from '@/components/dashboard/StatCard';
import { DealsByStatusChart } from '@/components/dashboard/DealsByStatusChart';
import { RecentDealsTable } from '@/components/dashboard/RecentDealsTable';
import { QueryError } from '@/components/QueryError';
import { RowsSkeleton } from '@/components/ListControls';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useDashboardMetrics, useDealCount, useDealPage } from '@/hooks/use-deals';
import { usePreferences } from '@/hooks/use-autoflow';
import { useAuth } from '@/contexts/AuthContext';
import { formatMoneyShort } from '@/lib/metrics';
import { percent } from '@/lib/rpc';

function AutomationTile({ icon: Icon, label, value, loading }: { icon: React.ElementType; label: string; value: number | undefined; loading: boolean }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-background p-3 min-w-0">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10"><Icon className="h-4 w-4 text-accent" aria-hidden /></div>
      <div className="min-w-0">
        {loading ? <Skeleton className="h-5 w-8" /> : <p className="text-xl font-semibold leading-none">{value ?? '–'}</p>}
        <p className="text-xs text-muted-foreground mt-1">{label}</p>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { profileName } = useAuth();
  const { prefs } = usePreferences();
  const metrics = useDashboardMetrics();
  const recent = useDealPage({ pageSize: 8, sort: 'created_at' }, { live: false });
  const stuck = useDealCount({ stuckDays: prefs.stale_days });
  const m = metrics.data;
  const loading = metrics.isLoading;

  return (
    <div className="flex flex-col h-full">
      <AppHeader
        title="Dashboard"
        subtitle={loading ? 'Loading…' : m ? `${profileName ? `Welcome back, ${profileName.split(' ')[0]}. ` : ''}${m.active} active deal${m.active === 1 ? '' : 's'}.` : undefined}
      />

      <div className="flex-1 overflow-y-auto p-4 lg:p-6 space-y-6 scrollbar-thin">
        {metrics.isError ? (
          <QueryError what="the dashboard figures" error={metrics.error} onRetry={() => metrics.refetch()} retrying={metrics.isFetching} />
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <StatCard title="Active deals" value={m?.active ?? 0} loading={loading} icon={FileText} iconColor="text-info" iconBgColor="bg-info/10" />
            <StatCard title="Funded this month" value={formatMoneyShort(m?.funded_this_month_amount ?? 0)} loading={loading}
              hint={m ? `${m.funded_this_month_count} loan${m.funded_this_month_count === 1 ? '' : 's'}` : undefined}
              icon={DollarSign} iconColor="text-success" iconBgColor="bg-success/10" />
            <StatCard title="Approval rate" value={percent(m?.approval_rate)} loading={loading}
              icon={CheckCircle2} iconColor="text-accent" iconBgColor="bg-accent/10" />
            <StatCard title="In review" value={m?.in_review ?? 0} loading={loading} icon={Clock} iconColor="text-warning" iconBgColor="bg-warning/10" />
          </div>
        )}

        {!metrics.isError && (
          <div className="bg-card rounded-xl border p-4 sm:p-6">
            <div className="flex items-center justify-between gap-2 mb-4">
              <h2 className="section-title flex items-center gap-2"><Sparkles className="h-4 w-4 text-accent" aria-hidden /> Automations — last 7 days</h2>
              <Button variant="ghost" size="sm" onClick={() => navigate('/settings?tab=automations')}>Configure</Button>
            </div>
            <div className="grid grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-4 gap-3">
              <AutomationTile icon={FileSearch} label="Documents auto-sorted" value={m?.automation_7d.auto_sorted} loading={loading} />
              <AutomationTile icon={Calculator} label="Incomes auto-filled" value={m?.automation_7d.auto_filled} loading={loading} />
              <AutomationTile icon={Send} label="Docs requested from dealers" value={m?.automation_7d.requested} loading={loading} />
              <AutomationTile icon={Route} label="Deals auto-routed" value={m?.automation_7d.auto_routed} loading={loading} />
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-card rounded-xl border p-4 sm:p-6 min-w-0">
            <div className="flex items-center justify-between mb-4">
              <h2 className="section-title">Deals by status</h2>
              <Button variant="ghost" size="sm" onClick={() => navigate('/pipeline')}>View pipeline</Button>
            </div>
            {loading ? <Skeleton className="h-[300px] w-full" /> : m ? <DealsByStatusChart counts={m.by_status} /> : null}
          </div>

          <div className="bg-card rounded-xl border p-4 sm:p-6 min-w-0">
            <h2 className="section-title mb-4">Quick actions</h2>
            <div className="space-y-3">
              <Button className="w-full justify-start" onClick={() => navigate('/deals/new')}>
                <Plus className="h-4 w-4 mr-2" aria-hidden /> New deal
              </Button>
              <Button variant="secondary" className="w-full justify-start" onClick={() => navigate('/credit')}>
                <TrendingUp className="h-4 w-4 mr-2" aria-hidden /> Credit review queue
              </Button>
              <Button variant="secondary" className="w-full justify-start" onClick={() => navigate('/funding')}>
                <DollarSign className="h-4 w-4 mr-2" aria-hidden /> Funding queue
              </Button>
              <Button variant="secondary" className="w-full justify-start text-warning" onClick={() => navigate('/deals?attention=1')}>
                <AlertTriangle className="h-4 w-4 mr-2" aria-hidden />
                Stuck over {prefs.stale_days} day{prefs.stale_days === 1 ? '' : 's'}{stuck.data != null ? ` (${stuck.data})` : ''}
              </Button>
              {m && (
                <p className="text-xs text-muted-foreground px-1">
                  {m.waiting_on_dealer} deal{m.waiting_on_dealer === 1 ? '' : 's'} waiting on dealer documents
                </p>
              )}
            </div>

            <h3 className="text-sm font-semibold mt-6 mb-3">Top dealers</h3>
            <div className="space-y-2">
              {loading && <><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-4/5" /></>}
              {m && m.top_dealers.length === 0 && <p className="text-xs text-muted-foreground">No dealer activity yet.</p>}
              {m?.top_dealers.slice(0, 5).map((dealer) => (
                <div key={dealer.dealer_id || dealer.name} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate">{dealer.name}</span>
                  <span className="text-muted-foreground shrink-0">
                    {dealer.funded} funded · {dealer.submitted} sent{dealer.approval_rate != null ? ` · ${percent(dealer.approval_rate)}` : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-card rounded-xl border p-4 sm:p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="section-title">Recent deals</h2>
            <Button variant="ghost" size="sm" onClick={() => navigate('/deals')}>View all</Button>
          </div>
          {recent.isError ? (
            <QueryError compact what="the recent deals" error={recent.error} onRetry={() => recent.refetch()} retrying={recent.isFetching} />
          ) : recent.isLoading ? <RowsSkeleton rows={5} /> : <RecentDealsTable deals={recent.data?.rows ?? []} />}
        </div>
      </div>
    </div>
  );
}
