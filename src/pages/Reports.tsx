import { AppHeader } from '@/components/layout/AppHeader';
import { DealsByStatusChart } from '@/components/dashboard/DealsByStatusChart';
import { useDeals, useDealers } from '@/hooks/use-deals';
import { monthlyTrend, toCsv, withinDays, formatMoneyShort } from '@/lib/metrics';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
} from 'recharts';
import { Download, Calendar } from 'lucide-react';
import { useState } from 'react';

export default function Reports() {
  const [timeRange, setTimeRange] = useState('30d');

  const { data: allDeals = [] } = useDeals();
  const { data: dealers = [] } = useDealers();
  const days = { '7d': 7, '30d': 30, '90d': 90, '1y': 365 }[timeRange] ?? 30;
  const deals = withinDays(allDeals, days);

  const totalDeals = deals.length;
  const fundedDeals = deals.filter((d) => d.status === 'funded');
  const decided = deals.filter((d) => ['funded', 'approved', 'declined'].includes(d.status));
  const approvalRate = decided.length ? Math.round((decided.filter((d) => d.status !== 'declined').length / decided.length) * 100) : null;
  const totalFunded = fundedDeals.reduce((sum, d) => sum + (d.fundedAmount ?? d.financingTerms.loanAmount), 0);
  const avgDealSize = fundedDeals.length ? Math.round(totalFunded / fundedDeals.length) : 0;

  const dealerVolume = dealers
    .map((dealer) => ({
      name: dealer.code || dealer.name.split(' ')[0],
      deals: deals.filter((d) => d.dealerId === dealer.id).length,
      funded: deals.filter((d) => d.dealerId === dealer.id && d.status === 'funded').length,
    }))
    .filter((d) => d.deals > 0)
    .sort((a, b) => b.deals - a.deals)
    .slice(0, 12);

  const trend = monthlyTrend(allDeals, 6);

  const exportCsv = () => {
    const csv = toCsv(deals.map((d) => ({
      deal_number: d.dealNumber, status: d.status, dealer: d.dealerName,
      customer: `${d.customer.firstName} ${d.customer.lastName}`,
      vehicle: `${d.vehicle.year} ${d.vehicle.make} ${d.vehicle.model}`,
      loan_amount: d.financingTerms.loanAmount, apr: d.financingTerms.apr, term_months: d.financingTerms.termMonths,
      credit_score: d.creditInfo?.score ?? '', submitted: d.createdAt, funded_at: d.fundedAt ?? '', funded_amount: d.fundedAmount ?? '',
    })));
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `autoflow-deals-${timeRange}.csv` });
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col h-full">
      <AppHeader title="Reports & Analytics" subtitle="Performance insights" />

      <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin">
        {/* Filters */}
        <div className="flex items-center justify-between">
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger className="w-48">
              <Calendar className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Select time range" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="90d">Last 90 days</SelectItem>
              <SelectItem value="1y">Last year</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={exportCsv} disabled={!deals.length}>
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        </div>

        {/* Key Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Deals</CardDescription>
              <CardTitle className="text-3xl">{totalDeals}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Funded</CardDescription>
              <CardTitle className="text-3xl text-success">
                {formatMoneyShort(totalFunded)}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Approval Rate</CardDescription>
              <CardTitle className="text-3xl">{approvalRate == null ? '—' : `${approvalRate}%`}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Avg Deal Size</CardDescription>
              <CardTitle className="text-3xl">
                ${avgDealSize.toLocaleString()}
              </CardTitle>
            </CardHeader>
          </Card>
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Deals by Status */}
          <Card>
            <CardHeader>
              <CardTitle>Deals by Status</CardTitle>
              <CardDescription>Current pipeline distribution</CardDescription>
            </CardHeader>
            <CardContent>
              <DealsByStatusChart deals={deals} />
            </CardContent>
          </Card>

          {/* Volume Trend */}
          <Card>
            <CardHeader>
              <CardTitle>Monthly Volume Trend</CardTitle>
              <CardDescription>Deals submitted per month (last 6 months)</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trend}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="month" className="text-xs" />
                    <YAxis className="text-xs" />
                    <Tooltip
                      content={({ active, payload, label }) => {
                        if (active && payload && payload.length) {
                          return (
                            <div className="bg-popover border rounded-lg shadow-lg p-3">
                              <p className="font-medium">{label}</p>
                              <p className="text-sm text-muted-foreground">
                                {payload[0].value} deals
                              </p>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="deals"
                      stroke="hsl(175, 60%, 40%)"
                      strokeWidth={2}
                      dot={{ fill: 'hsl(175, 60%, 40%)' }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Dealer Performance */}
        <Card>
          <CardHeader>
            <CardTitle>Dealer Performance</CardTitle>
            <CardDescription>Volume comparison by dealer</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dealerVolume}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="name" className="text-xs" />
                  <YAxis className="text-xs" />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (active && payload && payload.length) {
                        return (
                          <div className="bg-popover border rounded-lg shadow-lg p-3">
                            <p className="font-medium">{label}</p>
                            <p className="text-sm text-info">
                              Total: {payload[0]?.value} deals
                            </p>
                            <p className="text-sm text-success">
                              Funded: {payload[1]?.value} deals
                            </p>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Bar dataKey="deals" fill="hsl(200, 80%, 50%)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="funded" fill="hsl(160, 60%, 40%)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
