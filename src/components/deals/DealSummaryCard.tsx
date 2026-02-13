import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Zap, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Deal } from '@/types/deal';

interface DealSummaryCardProps {
  deal: Deal;
}

type RiskLevel = 'low' | 'moderate' | 'high';

function computeRisk(deal: DealSummaryCardProps['deal']): { level: RiskLevel; score: number; concerns: string[] } {
  let score = 0;
  const concerns: string[] = [];

  // Credit score
  const creditScore = deal.creditInfo?.score ?? 0;
  if (creditScore >= 720) score += 0;
  else if (creditScore >= 660) { score += 15; concerns.push('Near-prime credit'); }
  else if (creditScore >= 600) { score += 30; concerns.push('Subprime credit'); }
  else { score += 50; concerns.push('Deep subprime credit'); }

  // LTV
  if (deal.ltv > 120) { score += 25; concerns.push(`High LTV (${deal.ltv}%)`); }
  else if (deal.ltv > 100) { score += 15; concerns.push(`Elevated LTV (${deal.ltv}%)`); }

  // Income-to-payment ratio
  const monthlyIncome = deal.customer.employmentInfo?.monthlyIncome ?? 0;
  const payment = deal.financingTerms.monthlyPayment;
  if (monthlyIncome > 0) {
    const ratio = payment / monthlyIncome;
    if (ratio > 0.25) { score += 20; concerns.push('Payment >25% of income'); }
    else if (ratio > 0.15) { score += 10; }
  }

  // Flags
  if (deal.flags.length > 0) {
    score += deal.flags.length * 10;
    deal.flags.forEach(f => concerns.push(f));
  }

  // Document completeness
  const docs = deal.documents.filter(d => d.status === 'verified').length;
  const totalDocs = deal.documents.length;
  if (totalDocs > 0 && docs / totalDocs < 0.5) {
    score += 10;
    concerns.push('Low document verification rate');
  }

  const level: RiskLevel = score <= 20 ? 'low' : score <= 45 ? 'moderate' : 'high';
  return { level, score: Math.min(score, 100), concerns };
}

export function DealSummaryCard({ deal }: DealSummaryCardProps) {
  const risk = computeRisk(deal);
  const monthlyIncome = deal.customer.employmentInfo?.monthlyIncome ?? 0;
  const paymentRatio = monthlyIncome > 0
    ? ((deal.financingTerms.monthlyPayment / monthlyIncome) * 100).toFixed(1)
    : 'N/A';

  const RiskIcon = risk.level === 'low' ? CheckCircle2 : risk.level === 'moderate' ? AlertTriangle : XCircle;
  const riskColors = {
    low: 'text-success bg-success/10 border-success/30',
    moderate: 'text-warning bg-warning/10 border-warning/30',
    high: 'text-destructive bg-destructive/10 border-destructive/30',
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Zap className="h-5 w-5" />
          Quick Summary
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Risk Signal */}
        <div className={cn('flex items-center gap-3 p-3 rounded-lg border', riskColors[risk.level])}>
          <RiskIcon className="h-5 w-5 shrink-0" />
          <div>
            <p className="font-medium text-sm capitalize">{risk.level} Risk</p>
            <p className="text-xs opacity-80">Score: {risk.score}/100</p>
          </div>
        </div>

        {/* Key Metrics */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-muted-foreground text-xs">Customer</p>
            <p className="font-medium">{deal.customer.firstName} {deal.customer.lastName}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Credit</p>
            <p className="font-medium">
              {deal.creditInfo?.score ?? 'N/A'}
              {deal.creditInfo && (
                <span className="text-xs text-muted-foreground ml-1">
                  ({deal.creditInfo.tier.replace('_', ' ')})
                </span>
              )}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Loan Amount</p>
            <p className="font-medium">${deal.financingTerms.loanAmount.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">LTV</p>
            <p className="font-medium">{deal.ltv}%</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Monthly Payment</p>
            <p className="font-medium">${deal.financingTerms.monthlyPayment.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Payment/Income</p>
            <p className="font-medium">{paymentRatio}%</p>
          </div>
        </div>

        {/* Concerns */}
        {risk.concerns.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">Concerns</p>
            <ul className="space-y-1">
              {risk.concerns.slice(0, 4).map((c, i) => (
                <li key={i} className="flex items-center gap-1.5 text-xs text-warning">
                  <AlertTriangle className="h-3 w-3 shrink-0" />
                  {c}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
