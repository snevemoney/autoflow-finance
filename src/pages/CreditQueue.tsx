import { AppHeader } from '@/components/layout/AppHeader';
import { DealCard, DebtSummary } from '@/components/deals/DealCard';
import { getDealsByDepartment } from '@/data/mockData';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Search, SlidersHorizontal, TrendingUp, TrendingDown } from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

export default function CreditQueue() {
  const deals = getDealsByDepartment('credit');
  const [sortBy, setSortBy] = useState('date');
  const [searchQuery, setSearchQuery] = useState('');
  const [debtMap, setDebtMap] = useState<Map<string, DebtSummary>>(new Map());

  // Fetch applicant debts for all queued deals
  useEffect(() => {
    const dealIds = deals.map((d) => d.id);
    if (dealIds.length === 0) return;

    supabase
      .from('applicant_debts')
      .select('deal_id, monthly_payment, debt_type, is_court_ordered')
      .in('deal_id', dealIds)
      .then(({ data, error }) => {
        if (error) {
          toast({ title: 'Could not load debts', description: error.message, variant: 'destructive' });
          return;
        }
        if (!data) return;
        const map = new Map<string, { totalMonthlyDebts: number; hasGarnishments: boolean; rentPayment: number; debtCount: number; debtTypes: Set<string> }>();
        for (const row of data) {
          const existing = map.get(row.deal_id) || { totalMonthlyDebts: 0, hasGarnishments: false, rentPayment: 0, debtCount: 0, debtTypes: new Set<string>() };
          existing.totalMonthlyDebts += Number(row.monthly_payment);
          existing.debtCount++;
          existing.debtTypes.add(row.debt_type);
          if (row.debt_type === 'rent') {
            existing.rentPayment += Number(row.monthly_payment);
          }
          if (row.debt_type === 'garnishment' || row.debt_type === 'child_support' || row.is_court_ordered) {
            existing.hasGarnishments = true;
          }
          map.set(row.deal_id, existing);
        }

        const result = new Map<string, DebtSummary>();
        for (const deal of deals) {
          const debts = map.get(deal.id);
          const monthlyIncome = deal.customer.employmentInfo?.monthlyIncome || 0;
          const totalDebts = debts?.totalMonthlyDebts || 0;
          const dti = monthlyIncome > 0
            ? ((deal.financingTerms.monthlyPayment + totalDebts) / monthlyIncome) * 100
            : null;
          result.set(deal.id, {
            totalMonthlyDebts: totalDebts,
            hasGarnishments: debts?.hasGarnishments || false,
            dti,
            rentPayment: debts?.rentPayment || 0,
            debtCount: debts?.debtCount || 0,
            debtTypes: debts ? Array.from(debts.debtTypes) : [],
          });
        }
        setDebtMap(result);
      });
  }, [deals.length]);

  const filteredDeals = deals.filter(
    (deal) =>
      deal.dealNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      `${deal.customer.firstName} ${deal.customer.lastName}`
        .toLowerCase()
        .includes(searchQuery.toLowerCase())
  );

  const sortedDeals = [...filteredDeals].sort((a, b) => {
    if (sortBy === 'score_high') {
      return (b.creditInfo?.score || 0) - (a.creditInfo?.score || 0);
    }
    if (sortBy === 'score_low') {
      return (a.creditInfo?.score || 0) - (b.creditInfo?.score || 0);
    }
    if (sortBy === 'amount') {
      return b.financingTerms.loanAmount - a.financingTerms.loanAmount;
    }
    if (sortBy === 'dti_high') {
      return (debtMap.get(b.id)?.dti || 0) - (debtMap.get(a.id)?.dti || 0);
    }
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  // Calculate stats
  const avgScore = Math.round(
    deals.reduce((sum, d) => sum + (d.creditInfo?.score || 0), 0) / deals.length
  );
  const primeCount = deals.filter((d) => d.creditInfo?.tier === 'prime').length;
  const subprimeCount = deals.filter(
    (d) =>
      d.creditInfo?.tier === 'subprime' || d.creditInfo?.tier === 'deep_subprime'
  ).length;
  const highDtiCount = useMemo(
    () => Array.from(debtMap.values()).filter((s) => s.dti != null && s.dti > 45).length,
    [debtMap]
  );

  return (
    <div className="flex flex-col h-full">
      <AppHeader
        title="Credit Review Queue"
        subtitle={`${deals.length} deals pending credit review`}
      />

      <div className="flex-1 overflow-hidden flex flex-col">
        {/* Stats Bar */}
        <div className="p-6 pb-0">
          <div className="grid grid-cols-5 gap-4 mb-6">
            <div className="stat-card p-4">
              <p className="text-sm text-muted-foreground">Pending Review</p>
              <p className="text-2xl font-bold">{deals.length}</p>
            </div>
            <div className="stat-card p-4">
              <p className="text-sm text-muted-foreground">Avg Credit Score</p>
              <p className="text-2xl font-bold">{avgScore}</p>
            </div>
            <div className="stat-card p-4">
              <p className="text-sm text-muted-foreground">Prime Applications</p>
              <p className="text-2xl font-bold text-success">{primeCount}</p>
            </div>
            <div className="stat-card p-4">
              <p className="text-sm text-muted-foreground">Subprime Applications</p>
              <p className="text-2xl font-bold text-warning">{subprimeCount}</p>
            </div>
            <div className="stat-card p-4">
              <p className="text-sm text-muted-foreground">High DTI Deals</p>
              <p className="text-2xl font-bold text-destructive">{highDtiCount}</p>
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
              <SelectItem value="score_high">
                <span className="flex items-center gap-1">
                  <TrendingUp className="h-3 w-3" /> Highest Score
                </span>
              </SelectItem>
              <SelectItem value="score_low">
                <span className="flex items-center gap-1">
                  <TrendingDown className="h-3 w-3" /> Lowest Score
                </span>
              </SelectItem>
              <SelectItem value="amount">Loan Amount</SelectItem>
              <SelectItem value="dti_high">Highest DTI</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Deals Grid */}
        <div className="flex-1 overflow-y-auto p-6 pt-2 scrollbar-thin">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {sortedDeals.map((deal) => (
              <DealCard
                key={deal.id}
                deal={deal}
                debtSummary={debtMap.get(deal.id)}
              />
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
