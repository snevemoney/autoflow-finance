import { AppHeader } from '@/components/layout/AppHeader';
import { StatCard } from '@/components/dashboard/StatCard';
import { DealsByStatusChart } from '@/components/dashboard/DealsByStatusChart';
import { RecentDealsTable } from '@/components/dashboard/RecentDealsTable';
import { useDeals, useDealers } from '@/hooks/use-deals';
import { useAppSettings, useAutomationActivity, useDealerStats, useOpenRequestCounts } from '@/hooks/use-autoflow';
import { useAuth } from '@/contexts/AuthContext';
import { dashboardMetrics, formatMoneyShort } from '@/lib/metrics';
import {
  FileText, DollarSign, CheckCircle2, Clock, TrendingUp, AlertTriangle, Plus, Sparkles, FileSearch, Send, Route, Calculator,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';

function AutomationTile({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: number | undefined }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-background p-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/10"><Icon className="h-4 w-4 text-accent" /></div>
      <div>
        <p className="text-xl font-semibold leading-none">{value ?? '–'}</p>
        <p className="text-xs text-muted-foreground mt-1">{label}</p>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { profileName } = useAuth();
  const { data: deals = [], isLoading } = useDeals();
  const { data: dealers = [] } = useDealers();
  const { data: stats } = useDealerStats();
  const { data: requestCounts } = useOpenRequestCounts();
  const { data: activity } = useAutomationActivity(7);

  const { data: settings } = useAppSettings();
  const staleDays = parseInt(String((settings?.preferences as Record<string, unknown> | undefined)?.stale_days ?? '3'), 10) || 3;
  const m = dashboardMetrics(deals, new Date(), staleDays);
  const waitingOnDealers = requestCounts ? [...requestCounts.keys()].length : 0;
  const change = m.fundedLastMonth > 0
    ? { value: Math.round(((m.fundedThisMonth - m.fundedLastMonth) / m.fundedLastMonth) * 100), type: m.fundedThisMonth >= m.fundedLastMonth ? 'increase' as const : 'decrease' as const }
    : undefined;

  const topDealers = dealers
    .map((d) => ({ ...d, s: stats?.get(d.id) }))
    .filter((d) => (d.s?.total_deals ?? 0) > 0)
    .sort((a, b) => (b.s?.funded_deals ?? 0) - (a.s?.funded_deals ?? 0) || (b.s?.total_deals ?? 0) - (a.s?.total_deals ?? 0))
    .slice(0, 4);

  return (
    <div className="flex flex-col h-full">
      <AppHeader
        title="Dashboard"
        subtitle={isLoading ? 'Loading…' : `${profileName ? `Welcome back, ${profileName.split(' ')[0]}. ` : ''}${m.active} active deal${m.active === 1 ? '' : 's'}.`}
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard title="Active Deals" value={m.active} icon={FileText} iconColor="text-info" iconBgColor="bg-info/10" />
          <StatCard title="Funded This Month" value={formatMoneyShort(m.fundedThisMonth)} change={change}
            icon={DollarSign} iconColor="text-success" iconBgColor="bg-success/10" />
          <StatCard title="Approval Rate" value={m.approvalRate == null ? '—' : `${m.approvalRate}%`}
            icon={CheckCircle2} iconColor="text-accent" iconBgColor="bg-accent/10" />
          <StatCard title="In Review" value={m.pendingReview} icon={Clock} iconColor="text-warning" iconBgColor="bg-warning/10" />
        </div>

        <div className="bg-card rounded-xl border p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="section-title flex items-center gap-2"><Sparkles className="h-4 w-4 text-accent" /> Automations — last 7 days</h2>
            <Button variant="ghost" size="sm" onClick={() => navigate('/settings?tab=automations')}>Configure</Button>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <AutomationTile icon={FileSearch} label="Documents auto-sorted" value={activity?.autoSorted} />
            <AutomationTile icon={Calculator} label="Incomes auto-filled" value={activity?.incomeFilled} />
            <AutomationTile icon={Send} label="Docs requested from dealers" value={activity?.requestsSent} />
            <AutomationTile icon={Route} label="Deals auto-routed" value={activity?.autoRouted} />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-card rounded-xl border p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="section-title">Deals by Status</h2>
              <Button variant="ghost" size="sm" onClick={() => navigate('/pipeline')}>View Pipeline</Button>
            </div>
            <DealsByStatusChart deals={deals} />
          </div>

          <div className="bg-card rounded-xl border p-6">
            <h2 className="section-title mb-4">Quick Actions</h2>
            <div className="space-y-3">
              <Button className="w-full justify-start" onClick={() => navigate('/deals/new')}>
                <Plus className="h-4 w-4 mr-2" /> New deal
              </Button>
              <Button variant="secondary" className="w-full justify-start" onClick={() => navigate('/credit')}>
                <TrendingUp className="h-4 w-4 mr-2" /> Credit Review Queue
              </Button>
              <Button variant="secondary" className="w-full justify-start" onClick={() => navigate('/funding')}>
                <DollarSign className="h-4 w-4 mr-2" /> Funding Queue
              </Button>
              <Button variant="secondary" className="w-full justify-start text-warning" onClick={() => navigate('/deals?attention=1')}>
                <AlertTriangle className="h-4 w-4 mr-2" /> Stuck over {staleDays} day{staleDays === 1 ? '' : 's'} ({m.stuck.length})
              </Button>
              <p className="text-xs text-muted-foreground px-1">{waitingOnDealers} deal{waitingOnDealers === 1 ? '' : 's'} waiting on dealer documents</p>
            </div>

            <h3 className="text-sm font-semibold mt-6 mb-3">Top Dealers</h3>
            <div className="space-y-2">
              {topDealers.length === 0 && <p className="text-xs text-muted-foreground">No dealer activity yet.</p>}
              {topDealers.map((dealer) => (
                <div key={dealer.id} className="flex items-center justify-between text-sm">
                  <span className="truncate">{dealer.name}</span>
                  <span className="text-muted-foreground shrink-0 ml-2">
                    {dealer.s?.funded_deals ?? 0} funded{dealer.s?.approval_rate != null ? ` · ${dealer.s.approval_rate}%` : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-card rounded-xl border p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="section-title">Recent Deals</h2>
            <Button variant="ghost" size="sm" onClick={() => navigate('/deals')}>View All</Button>
          </div>
          <RecentDealsTable deals={deals} />
        </div>
      </div>
    </div>
  );
}
