import { useState } from 'react';
import { AppHeader } from '@/components/layout/AppHeader';
import { StatusBadge } from '@/components/deals/StatusBadge';
import { QueryError } from '@/components/QueryError';
import { DEAL_PAGE_SIZE, useDeals } from '@/hooks/use-deals';
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
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { Search, Filter, Download, SlidersHorizontal, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';

export default function DealsList() {
  const navigate = useNavigate();
  const [page, setPage] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<DealStatus | 'all'>('all');
  const { data, isLoading, isError, error, refetch } = useDeals({
    page,
    pageSize: DEAL_PAGE_SIZE,
    status: statusFilter,
  });
  const deals = data?.deals ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / DEAL_PAGE_SIZE));

  const filteredDeals = deals.filter((deal) => {
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
              onValueChange={(v) => {
                setStatusFilter(v as DealStatus | 'all');
                setPage(0);
              }}
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

            <Button variant="outline">
              <SlidersHorizontal className="h-4 w-4 mr-2" />
              More Filters
            </Button>

            <Button variant="outline">
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto p-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : isError ? (
            <QueryError message={error instanceof Error ? error.message : 'Could not load deals.'} onRetry={() => refetch()} />
          ) : (
            <div className="rounded-lg border overflow-hidden">
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
                        {formatDistanceToNow(new Date(deal.createdAt), {
                          addSuffix: true,
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!isLoading && !isError && total > 0 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-sm text-muted-foreground">
                Page {page + 1} of {pageCount} · {total} deals
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                  <ChevronLeft className="h-4 w-4 mr-1" /> Previous
                </Button>
                <Button variant="outline" size="sm" disabled={page + 1 >= pageCount} onClick={() => setPage((p) => p + 1)}>
                  Next <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
