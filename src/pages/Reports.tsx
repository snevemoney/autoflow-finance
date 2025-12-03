import { AppHeader } from '@/components/layout/AppHeader';
import { DealsByStatusChart } from '@/components/dashboard/DealsByStatusChart';
import { mockDeals, mockDealers } from '@/data/mockData';
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

  // Calculate metrics
  const totalDeals = mockDeals.length;
  const fundedDeals = mockDeals.filter((d) => d.status === 'funded');
  const declinedDeals = mockDeals.filter((d) => d.status === 'declined');
  const approvalRate = Math.round((fundedDeals.length / totalDeals) * 100);
  const totalFunded = fundedDeals.reduce(
    (sum, d) => sum + d.financingTerms.loanAmount,
    0
  );
  const avgDealSize = Math.round(totalFunded / fundedDeals.length);

  // Volume by dealer data
  const dealerVolume = mockDealers.map((dealer) => ({
    name: dealer.name.split(' ')[0],
    deals: mockDeals.filter((d) => d.dealerId === dealer.id).length,
    funded: mockDeals.filter(
      (d) => d.dealerId === dealer.id && d.status === 'funded'
    ).length,
  }));

  // Mock monthly trend data
  const monthlyTrend = [
    { month: 'Jul', deals: 28, funded: 280000 },
    { month: 'Aug', deals: 35, funded: 350000 },
    { month: 'Sep', deals: 42, funded: 420000 },
    { month: 'Oct', deals: 38, funded: 380000 },
    { month: 'Nov', deals: 45, funded: 450000 },
    { month: 'Dec', deals: 52, funded: 520000 },
  ];

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
          <Button variant="outline">
            <Download className="h-4 w-4 mr-2" />
            Export Report
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
                ${(totalFunded / 1000000).toFixed(2)}M
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Approval Rate</CardDescription>
              <CardTitle className="text-3xl">{approvalRate}%</CardTitle>
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
              <DealsByStatusChart />
            </CardContent>
          </Card>

          {/* Volume Trend */}
          <Card>
            <CardHeader>
              <CardTitle>Monthly Volume Trend</CardTitle>
              <CardDescription>Deals processed over time</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={monthlyTrend}>
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
