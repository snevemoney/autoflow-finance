import { AppHeader } from '@/components/layout/AppHeader';
import { DealCard } from '@/components/deals/DealCard';
import { getDealsByDepartment } from '@/data/mockData';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Search, SlidersHorizontal, CheckCircle2 } from 'lucide-react';
import { useState } from 'react';

export default function FundingQueue() {
  const deals = getDealsByDepartment('funding');
  const [sortBy, setSortBy] = useState('date');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredDeals = deals.filter(
    (deal) =>
      deal.dealNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      `${deal.customer.firstName} ${deal.customer.lastName}`
        .toLowerCase()
        .includes(searchQuery.toLowerCase())
  );

  const sortedDeals = [...filteredDeals].sort((a, b) => {
    if (sortBy === 'amount_high') {
      return b.financingTerms.loanAmount - a.financingTerms.loanAmount;
    }
    if (sortBy === 'amount_low') {
      return a.financingTerms.loanAmount - b.financingTerms.loanAmount;
    }
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  // Calculate stats
  const totalToFund = deals.reduce(
    (sum, d) => sum + d.financingTerms.loanAmount,
    0
  );
  const avgDeal = Math.round(totalToFund / deals.length);
  const highValueDeals = deals.filter(
    (d) => d.financingTerms.loanAmount > 40000
  ).length;

  return (
    <div className="flex flex-col h-full">
      <AppHeader
        title="Funding Queue"
        subtitle={`${deals.length} deals ready for funding`}
      />

      <div className="flex-1 overflow-hidden flex flex-col">
        {/* Stats Bar */}
        <div className="p-6 pb-0">
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div className="stat-card p-4">
              <p className="text-sm text-muted-foreground">Ready to Fund</p>
              <p className="text-2xl font-bold">{deals.length}</p>
            </div>
            <div className="stat-card p-4">
              <p className="text-sm text-muted-foreground">Total to Disburse</p>
              <p className="text-2xl font-bold text-success">
                ${(totalToFund / 1000).toFixed(0)}K
              </p>
            </div>
            <div className="stat-card p-4">
              <p className="text-sm text-muted-foreground">Average Deal Size</p>
              <p className="text-2xl font-bold">${avgDeal.toLocaleString()}</p>
            </div>
            <div className="stat-card p-4">
              <p className="text-sm text-muted-foreground">High Value (40K+)</p>
              <p className="text-2xl font-bold text-accent">{highValueDeals}</p>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="px-6 pb-4 flex items-center gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search deals..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="w-48">
              <SlidersHorizontal className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="date">Newest First</SelectItem>
              <SelectItem value="amount_high">Highest Amount</SelectItem>
              <SelectItem value="amount_low">Lowest Amount</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Deals Grid */}
        <div className="flex-1 overflow-y-auto p-6 pt-2 scrollbar-thin">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {sortedDeals.map((deal) => (
              <DealCard key={deal.id} deal={deal} />
            ))}
          </div>
          {sortedDeals.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              No deals match your search criteria
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
