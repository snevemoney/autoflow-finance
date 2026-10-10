import { useState } from 'react';
import { Download, Calendar, Loader2 } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend,
} from 'recharts';
import { AppHeader } from '@/components/layout/AppHeader';
import { DealsByStatusChart } from '@/components/dashboard/DealsByStatusChart';
import { QueryError } from '@/components/QueryError';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useDashboardMetrics, useReportMetrics } from '@/hooks/use-deals';
import { useDealExport } from '@/hooks/use-deal-export';
import { formatMoneyShort } from '@/lib/metrics';
import { percent } from '@/lib/rpc';

const RANGES = { '7d': 7, '30d': 30, '90d': 90, '1y': 365 } as const;
type Range = keyof typeof RANGES;

/** Local calendar date, YYYY-MM-DD. */
function isoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m) return ym;
  return new Date(y, m - 1, 1).toLocaleString('en-CA', { month: 'short', year: '2-digit' });
}

function Metric({ label, value, loading, tone }: { label: string; value: string; loading: boolean; tone?: string }) {
  return (
    <Card className="min-w-0">
      <CardHeader className="p-4 sm:p-6 pb-2 sm:pb-2">
        <CardDescription className="truncate">{label}</CardDescription>
        {loading ? <Skeleton className="h-8 w-24" /> : <CardTitle className={`text-2xl sm:text-3xl truncate ${tone ?? ''}`}>{value}</CardTitle>}
      </CardHeader>
    </Card>
  );
}

export default function Reports() {
  const [range, setRange] = useState<Range>('30d');
  const today = new Date();
  const to = isoDate(today);
  const from = isoDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() - RANGES[range] + 1));
  const trendFrom = isoDate(new Date(today.getFullYear(), today.getMonth() - 5, 1));

  const report = useReportMetrics(from, to);
  const trend = useReportMetrics(trendFrom, to);
  const pipeline = useDashboardMetrics();
  const exporter = useDealExport();
  const r = report.data;
  const loading = report.isLoading;

  const dealerVolume = (r?.by_dealer ?? [])
    .filter((d) => d.submitted > 0 || d.funded_count > 0)
    .sort((a, b) => b.submitted - a.submitted)
    .slice(0, 12)
    .map((d) => ({ name: d.name.length > 14 ? `${d.name.slice(0, 13)}…` : d.name, deals: d.submitted, funded: d.funded_count }));
  const months = (trend.data?.by_month ?? []).map((m) => ({ month: monthLabel(m.month), deals: m.submitted, funded: m.funded_count }));

  const exportCsv = () => {
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    exporter.run({ createdFrom: new Date(`${from}T00:00:00`).toISOString(), createdTo: end.toISOString(), sort: 'created_at' }, `autoflow-deals-${from}-to-${to}.csv`);
  };

  return (
    <div className="flex flex-col h-full">
      <AppHeader title="Reports & Analytics" subtitle="Performance insights" />

      <div className="flex-1 overflow-y-auto p-4 lg:p-6 space-y-6 scrollbar-thin">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Select value={range} onValueChange={(v) => setRange(v as Range)}>
            <SelectTrigger className="w-48" aria-label="Time range">
              <Calendar className="h-4 w-4 mr-2" aria-hidden />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="90d">Last 90 days</SelectItem>
              <SelectItem value="1y">Last year</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={exportCsv} disabled={exporter.running || !r?.submitted}>
              {exporter.running ? <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden /> : <Download className="h-4 w-4 mr-2" aria-hidden />}
              {exporter.running ? `Exporting ${exporter.progress?.loaded.toLocaleString('en-CA') ?? 0}…` : 'Export CSV'}
            </Button>
            {exporter.running && <Button variant="ghost" size="sm" onClick={exporter.cancel}>Cancel</Button>}
          </div>
        </div>

        {report.isError ? (
          <QueryError what="the report" error={report.error} onRetry={() => report.refetch()} retrying={report.isFetching} />
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <Metric label="Deals submitted" value={(r?.submitted ?? 0).toLocaleString('en-CA')} loading={loading} />
            <Metric label="Funded" value={formatMoneyShort(r?.funded_amount ?? 0)} loading={loading} tone="text-success" />
            <Metric label="Approval rate" value={percent(r?.approval_rate)} loading={loading} />
            <Metric label="Avg deal funded" value={r && r.funded_count ? `$${Math.round(r.funded_amount / r.funded_count).toLocaleString('en-CA')}` : '—'} loading={loading} />
            <Metric label="Loans funded" value={(r?.funded_count ?? 0).toLocaleString('en-CA')} loading={loading} />
            <Metric label="Declined" value={(r?.declined ?? 0).toLocaleString('en-CA')} loading={loading} />
            <Metric label="Avg days to fund" value={r?.avg_days_to_fund != null ? r.avg_days_to_fund.toFixed(1) : '—'} loading={loading} />
            <Metric label="Period" value={`${RANGES[range]} days`} loading={false} />
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>Current pipeline</CardTitle>
              <CardDescription>Deals in each status right now</CardDescription>
            </CardHeader>
            <CardContent>
              {pipeline.isError ? <QueryError compact what="the pipeline" error={pipeline.error} onRetry={() => pipeline.refetch()} />
                : pipeline.isLoading ? <Skeleton className="h-[300px] w-full" />
                : <DealsByStatusChart counts={pipeline.data?.by_status ?? {}} />}
            </CardContent>
          </Card>

          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>Monthly volume</CardTitle>
              <CardDescription>Submitted and funded per month (last 6 months, funded by funding date)</CardDescription>
            </CardHeader>
            <CardContent>
              {trend.isError ? <QueryError compact what="the trend" error={trend.error} onRetry={() => trend.refetch()} />
                : trend.isLoading ? <Skeleton className="h-[300px] w-full" />
                : !months.length ? <p className="h-[300px] flex items-center justify-center text-sm text-muted-foreground">No deals in the last 6 months</p>
                : (
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={months} margin={{ left: -16, right: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis dataKey="month" className="text-xs" />
                        <YAxis className="text-xs" allowDecimals={false} />
                        <Tooltip />
                        <Legend wrapperStyle={{ fontSize: '12px' }} />
                        <Line type="monotone" name="Submitted" dataKey="deals" stroke="hsl(200, 80%, 50%)" strokeWidth={2} dot={{ r: 3 }} />
                        <Line type="monotone" name="Funded" dataKey="funded" stroke="hsl(175, 60%, 40%)" strokeWidth={2} dot={{ r: 3 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
            </CardContent>
          </Card>
        </div>

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Dealer performance</CardTitle>
            <CardDescription>Submitted and funded in the selected period</CardDescription>
          </CardHeader>
          <CardContent>
            {report.isError ? null : loading ? <Skeleton className="h-[300px] w-full" />
              : !dealerVolume.length ? <p className="h-[200px] flex items-center justify-center text-sm text-muted-foreground">No dealer activity in this period</p>
              : (
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dealerVolume} margin={{ left: -16, right: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="name" className="text-xs" interval={0} angle={dealerVolume.length > 4 ? -25 : 0} textAnchor={dealerVolume.length > 4 ? 'end' : 'middle'} height={dealerVolume.length > 4 ? 60 : 30} />
                      <YAxis className="text-xs" allowDecimals={false} />
                      <Tooltip />
                      <Legend wrapperStyle={{ fontSize: '12px' }} />
                      <Bar name="Submitted" dataKey="deals" fill="hsl(200, 80%, 50%)" radius={[4, 4, 0, 0]} />
                      <Bar name="Funded" dataKey="funded" fill="hsl(160, 60%, 40%)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
