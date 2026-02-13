import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DollarSign, TrendingUp, TrendingDown, Briefcase } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Deal } from '@/types/deal';

interface IncomeVerificationCardProps {
  deal: Deal;
}

export function IncomeVerificationCard({ deal }: IncomeVerificationCardProps) {
  const statedIncome = deal.customer.employmentInfo?.monthlyIncome ?? 0;
  const employer = deal.customer.employmentInfo?.employer ?? 'Unknown';
  const jobTitle = deal.customer.employmentInfo?.jobTitle ?? 'Unknown';
  const yearsEmployed = deal.customer.employmentInfo?.yearsEmployed ?? 0;

  // Count income-related docs
  const incomeDocs = deal.documents.filter(
    d => d.type === 'pay_stub' || d.type === 'bank_statement' || d.type === 'income_verification'
  );
  const verifiedDocs = incomeDocs.filter(d => d.status === 'verified');

  // Simulated calculated income (in production this would come from document parsing)
  // Slight variance to show recalculation effect
  const calculatedIncome = incomeDocs.length > 1
    ? Math.round(statedIncome * (0.95 + Math.random() * 0.1))
    : statedIncome;

  const incomeDelta = calculatedIncome - statedIncome;
  const deltaPercent = statedIncome > 0 ? ((incomeDelta / statedIncome) * 100).toFixed(1) : '0';

  const monthlyPayment = deal.financingTerms.monthlyPayment;
  const paymentToIncome = calculatedIncome > 0
    ? ((monthlyPayment / calculatedIncome) * 100).toFixed(1)
    : 'N/A';

  const ratioHealthy = typeof paymentToIncome === 'string' ? false : parseFloat(paymentToIncome) <= 20;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <DollarSign className="h-5 w-5" />
          Income Verification
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Employment Info */}
        <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
          <Briefcase className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
          <div className="text-sm">
            <p className="font-medium">{employer}</p>
            <p className="text-muted-foreground">{jobTitle} • {yearsEmployed} yr{yearsEmployed !== 1 ? 's' : ''}</p>
          </div>
        </div>

        {/* Income Figures */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Stated Income</span>
            <span className="font-medium">${statedIncome.toLocaleString()}/mo</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Calculated Income</span>
            <span className="font-medium">${calculatedIncome.toLocaleString()}/mo</span>
          </div>
          {incomeDelta !== 0 && (
            <div className={cn(
              'flex items-center gap-1 text-xs',
              incomeDelta > 0 ? 'text-success' : 'text-warning'
            )}>
              {incomeDelta > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {incomeDelta > 0 ? '+' : ''}{deltaPercent}% from stated
            </div>
          )}
        </div>

        {/* Payment-to-Income Ratio */}
        <div className={cn(
          'p-3 rounded-lg border text-sm',
          ratioHealthy ? 'bg-success/5 border-success/20' : 'bg-warning/5 border-warning/20'
        )}>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Payment / Income</span>
            <span className={cn('font-bold', ratioHealthy ? 'text-success' : 'text-warning')}>
              {paymentToIncome}%
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            ${monthlyPayment.toLocaleString()} / ${calculatedIncome.toLocaleString()}
          </p>
        </div>

        {/* Doc count */}
        <div className="text-xs text-muted-foreground">
          {verifiedDocs.length}/{incomeDocs.length} income documents verified
        </div>
      </CardContent>
    </Card>
  );
}
