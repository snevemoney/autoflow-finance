import { AppHeader } from '@/components/layout/AppHeader';
import { StatCard } from '@/components/dashboard/StatCard';
import { DealsByStatusChart } from '@/components/dashboard/DealsByStatusChart';
import { RecentDealsTable } from '@/components/dashboard/RecentDealsTable';
import { mockDeals, mockDealers } from '@/data/mockData';
import {
  FileText,
  DollarSign,
  CheckCircle2,
  Clock,
  TrendingUp,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';

export default function Dashboard() {
  const navigate = useNavigate();
  
  const totalDeals = mockDeals.length;
  const activeDeals = mockDeals.filter(
    (d) => !['funded', 'declined', 'incomplete'].includes(d.status)
  ).length;
  const fundedDeals = mockDeals.filter((d) => d.status === 'funded').length;
  const fundedAmount = mockDeals
    .filter((d) => d.status === 'funded')
    .reduce((sum, d) => sum + d.financingTerms.loanAmount, 0);
  const approvalRate = Math.round((fundedDeals / totalDeals) * 100);
  const pendingReview = mockDeals.filter(
    (d) => ['credit_review', 'income_verification', 'funding_review'].includes(d.status)
  ).length;

  return (
    <div className="flex flex-col h-full">
      <AppHeader
        title="Dashboard"
        subtitle={`Welcome back! You have ${activeDeals} active deals.`}
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin">
        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="Active Deals"
            value={activeDeals}
            change={{ value: 12, type: 'increase' }}
            icon={FileText}
            iconColor="text-info"
            iconBgColor="bg-info/10"
          />
          <StatCard
            title="Funded This Month"
            value={`$${(fundedAmount / 1000).toFixed(0)}K`}
            change={{ value: 8, type: 'increase' }}
            icon={DollarSign}
            iconColor="text-success"
            iconBgColor="bg-success/10"
          />
          <StatCard
            title="Approval Rate"
            value={`${approvalRate}%`}
            change={{ value: 3, type: 'increase' }}
            icon={CheckCircle2}
            iconColor="text-accent"
            iconBgColor="bg-accent/10"
          />
          <StatCard
            title="Pending Review"
            value={pendingReview}
            icon={Clock}
            iconColor="text-warning"
            iconBgColor="bg-warning/10"
          />
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Deals by Status */}
          <div className="lg:col-span-2 bg-card rounded-xl border p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="section-title">Deals by Status</h2>
              <Button variant="ghost" size="sm" onClick={() => navigate('/pipeline')}>
                View Pipeline
              </Button>
            </div>
            <DealsByStatusChart />
          </div>

          {/* Quick Actions */}
          <div className="bg-card rounded-xl border p-6">
            <h2 className="section-title mb-4">Quick Actions</h2>
            <div className="space-y-3">
              <Button
                variant="secondary"
                className="w-full justify-start"
                onClick={() => navigate('/pipeline')}
              >
                <FileText className="h-4 w-4 mr-2" />
                View Pipeline Board
              </Button>
              <Button
                variant="secondary"
                className="w-full justify-start"
                onClick={() => navigate('/credit')}
              >
                <TrendingUp className="h-4 w-4 mr-2" />
                Credit Review Queue
              </Button>
              <Button
                variant="secondary"
                className="w-full justify-start"
                onClick={() => navigate('/funding')}
              >
                <DollarSign className="h-4 w-4 mr-2" />
                Funding Queue
              </Button>
              <Button
                variant="secondary"
                className="w-full justify-start text-warning"
              >
                <AlertTriangle className="h-4 w-4 mr-2" />
                Deals Needing Attention (4)
              </Button>
            </div>

            {/* Top Dealers */}
            <h3 className="text-sm font-semibold mt-6 mb-3">Top Dealers</h3>
            <div className="space-y-2">
              {mockDealers.slice(0, 3).map((dealer) => (
                <div
                  key={dealer.id}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="truncate">{dealer.name}</span>
                  <span className="text-muted-foreground">
                    {dealer.approvalRate}% approval
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Recent Deals Table */}
        <div className="bg-card rounded-xl border p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="section-title">Recent Deals</h2>
            <Button variant="ghost" size="sm" onClick={() => navigate('/deals')}>
              View All
            </Button>
          </div>
          <RecentDealsTable />
        </div>
      </div>
    </div>
  );
}
