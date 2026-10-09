import { ago } from '@/lib/utils';
import { useState } from 'react';
import { AppHeader } from '@/components/layout/AppHeader';
import { StatusBadge } from '@/components/deals/StatusBadge';
import { useDeals } from '@/hooks/use-deals';
import { DealStatus, DEAL_STATUS_CONFIG } from '@/types/deal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { stuckDeals, toCsv } from '@/lib/metrics';
import { useAppSettings } from '@/hooks/use-autoflow';

import { Search, Filter, Download, Loader2, Plus, AlertTriangle } from 'lucide-react';

export default function DealsList() {
  const navigate = useNavigate();
  const { data: deals = [], isLoading } = useDeals();
  const [params, setParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState(params.get('q') ?? '');
  const [statusFilter, setStatusFilter] = useState<DealStatus | 'all'>((params.get('status') as DealStatus) ?? 'all');
  const attentionOnly = params.get('attention') === '1';
  const { data: settings } = useAppSettings();
  const staleDays = parseInt(String((settings?.preferences as Record<string, unknown> | undefined)?.stale_days ?? '3'), 10) || 3;
  const stuckIds = new Set(stuckDeals(deals, new Date(), staleDays).map((d) => d.id));

  const filteredDeals = deals.filter((deal) => {
    if (attentionOnly && !stuckIds.has(deal.id)) return false;
    const matchesSearch =
      deal.dealNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      `${deal.customer.firstName} ${deal.customer.lastName}`
        .toLowerCase()
        .includes(searchQuery.toLowerCase()) ||
      deal.dealerName.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus = statusFilter === 'all' || deal.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  const getCreditScoreColor = (score?: number) => {
    if (!score) return 'text-muted-foreground';
    if (score >= 720) return 'text-success';
    if (score >= 660) return 'text-info';
    if (score >= 600) return 'text-warning';
    return 'text-destructive';
  };

  return (
    <div className="flex flex-col h-full">
      <AppHeader
        title="All Deals"
        subtitle={`${filteredDeals.length} deals found`}
      />

      <div className="flex-1 overflow-hidden flex flex-col">
        {/* Filters */}
        <div className="p-6 pb-4 border-b bg-card">
          <div className="flex items-center gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by deal #, customer, or dealer..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>

            <Select
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v as DealStatus | 'all')}
            >
              <SelectTrigger className="w-48">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {Object.entries(DEAL_STATUS_CONFIG).map(([key, config]) => (
                  <SelectItem key={key} value={key}>
                    {config.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button variant={attentionOnly ? 'default' : 'outline'}
              onClick={() => { const next = new URLSearchParams(params); if (attentionOnly) next.delete('attention'); else next.set('attention', '1'); setParams(next); }}>
              <AlertTriangle className="h-4 w-4 mr-2" />
              Stuck &gt; {staleDays}d{stuckIds.size ? ` (${stuckIds.size})` : ''}
            </Button>

            <Button variant="outline" disabled={!filteredDeals.length} onClick={() => {
              const csv = toCsv(filteredDeals.map((d) => ({
                deal_number: d.dealNumber, status: d.status, customer: `${d.customer.firstName} ${d.customer.lastName}`,
                dealer: d.dealerName, vehicle: `${d.vehicle.year} ${d.vehicle.make} ${d.vehicle.model}`, vin: d.vehicle.vin,
                loan_amount: d.financingTerms.loanAmount, ltv: d.ltv, credit_score: d.creditInfo?.score ?? '', submitted: d.createdAt,
              })));
              const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
              Object.assign(document.createElement('a'), { href: url, download: 'autoflow-deals.csv' }).click();
              URL.revokeObjectURL(url);
            }}>
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>

            <Button className="ml-auto" onClick={() => navigate('/deals/new')}>
              <Plus className="h-4 w-4 mr-2" />
              New deal
            </Button>
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto p-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="rounded-lg border overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Deal #</th>
                    <th>Customer</th>
                    <th>Vehicle</th>
                    <th>Loan Amount</th>
                    <th>Credit Score</th>
                    <th>LTV</th>
                    <th>Dealer</th>
                    <th>Status</th>
                    <th>Submitted</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDeals.map((deal) => (
                    <tr
                      key={deal.id}
                      onClick={() => navigate(`/deals/${deal.id}`)}
                      className="cursor-pointer"
                    >
                      <td className="font-mono text-sm">{deal.dealNumber}</td>
                      <td>
                        <p className="font-medium">
                          {deal.customer.firstName} {deal.customer.lastName}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {deal.customer.email}
                        </p>
                      </td>
                      <td>
                        <p className="text-sm">
                          {deal.vehicle.year} {deal.vehicle.make} {deal.vehicle.model}
                        </p>
                        <p className="text-xs text-muted-foreground font-mono">
                          {deal.vehicle.vin}
                        </p>
                      </td>
                      <td className="font-medium">
                        ${deal.financingTerms.loanAmount.toLocaleString()}
                      </td>
                      <td>
                        <span className={getCreditScoreColor(deal.creditInfo?.score)}>
                          {deal.creditInfo?.score || '-'}
                        </span>
                      </td>
                      <td>{deal.ltv}%</td>
                      <td className="text-sm">{deal.dealerName}</td>
                      <td>
                        <StatusBadge status={deal.status} size="sm" />
                      </td>
                      <td className="text-sm text-muted-foreground">
                        {ago(deal.createdAt, {
                          addSuffix: true,
                        })}
                      </td>
                    </tr>
                  ))}
                  {!filteredDeals.length && (
                    <tr><td colSpan={9} className="text-center py-10 text-muted-foreground">
                      {deals.length ? 'No deals match these filters.' : 'No deals yet — dealers submit from their portal, or click “New deal”.'}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
