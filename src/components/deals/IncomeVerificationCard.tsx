import { useState } from 'react';
import { DollarSign, AlertTriangle, FileSearch, Plus, ClipboardCheck, Ban } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { QueryError } from '@/components/QueryError';
import { IncomeSourceCard } from './IncomeSourceCard';
import { AddIncomeSourceDialog } from './AddIncomeSourceDialog';
import { UnmatchedExtractionRow } from './UnmatchedExtractionRow';
import { useApplicantDebts, useExtractions, useIncomeSources, useRefreshIncome, type ExtractedIncome } from '@/hooks/use-income';
import { usePreferences } from '@/hooks/use-autoflow';
import { ratioTone, TONE_TEXT } from '@/lib/preferences';
import { cn } from '@/lib/utils';
import type { Deal } from '@/types/deal';

const fmt = (n: number) => `$${n.toLocaleString('en-CA', { maximumFractionDigits: 2 })}`;

function Ratio({ label, value, limit }: { label: string; value: number | null; limit: number }) {
  const tone = ratioTone(value, limit);
  return (
    <div className={cn('p-2 rounded-md border text-xs',
      tone === 'ok' ? 'bg-success/5 border-success/20' : tone === 'warn' ? 'bg-warning/5 border-warning/20' : tone === 'bad' ? 'bg-destructive/5 border-destructive/20' : 'bg-muted/40')}>
      <div className="flex justify-between items-center gap-2">
        <span className="text-muted-foreground">{label} <span className="opacity-70">(limit {limit}%)</span></span>
        <span className={cn('font-semibold', tone ? TONE_TEXT[tone] : 'text-muted-foreground')}>{value == null ? 'N/A' : `${value.toFixed(1)}%`}</span>
      </div>
    </div>
  );
}

/**
 * Income sources, read documents and ratios. Viewing this card never writes anything: the server
 * creates the primary source at submission and attaches read pay documents itself; linking an
 * unmatched document or applying a figure are explicit analyst actions.
 */
export function IncomeVerificationCard({ deal }: { deal: Deal }) {
  const { prefs } = usePreferences();
  const sources = useIncomeSources(deal.id);
  const extractions = useExtractions(deal.id);
  const debts = useApplicantDebts(deal.id);
  const refresh = useRefreshIncome(deal.id);
  const [addOpen, setAddOpen] = useState(false);

  const header = (
    <CardHeader className="pb-2 pt-4 px-4">
      <div className="flex items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold"><DollarSign className="h-4 w-4" aria-hidden /> Income verification</CardTitle>
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setAddOpen(true)}><Plus className="h-3 w-3 mr-1" aria-hidden /> Add source</Button>
      </div>
    </CardHeader>
  );
  const dialog = <AddIncomeSourceDialog open={addOpen} onOpenChange={setAddOpen} dealId={deal.id} customerId={deal.customer.id} onAdded={refresh} />;

  if (sources.isError) {
    return <Card>{header}<CardContent className="px-4 pb-4"><QueryError compact what="the income sources" error={sources.error} onRetry={() => sources.refetch()} /></CardContent>{dialog}</Card>;
  }
  if (sources.isLoading) {
    return <Card>{header}<CardContent className="px-4 pb-4 space-y-2"><Skeleton className="h-6 w-1/2" /><Skeleton className="h-24" /></CardContent></Card>;
  }

  const list = sources.data ?? [];
  const all: ExtractedIncome[] = extractions.data ?? [];
  const bySource: Record<string, ExtractedIncome[]> = {};
  for (const e of all) if (e.income_source_id) (bySource[e.income_source_id] ??= []).push(e);
  const unmatched = all.filter((e) => !e.income_source_id && e.gross_pay != null);

  if (!list.length) {
    const stated = deal.customer.employmentInfo?.monthlyIncome ?? 0;
    return (
      <Card>
        {header}
        <CardContent className="px-4 pb-4 space-y-2 text-sm">
          <p className="text-muted-foreground">No income source on this deal yet{stated ? ` — the application states ${fmt(stated)}/mo` : ''}. Add one to verify income.</p>
          {unmatched.length > 0 && <p className="text-xs text-warning">{unmatched.length} read pay document{unmatched.length === 1 ? '' : 's'} waiting to be linked.</p>}
        </CardContent>
        {dialog}
      </Card>
    );
  }

  const totalStated = list.reduce((s, src) => s + Number(src.stated_monthly_income ?? 0), 0);
  const totalCalculated = list.reduce((s, src) => s + Number(src.calculated_monthly_income ?? src.stated_monthly_income ?? 0), 0);
  const payment = deal.financingTerms.monthlyPayment;
  const debtTotal = (debts.data ?? []).reduce((s, d) => s + Number(d.monthly_payment), 0);
  const pti = totalCalculated > 0 ? (payment / totalCalculated) * 100 : null;
  const dti = totalCalculated > 0 ? ((payment + debtTotal) / totalCalculated) * 100 : null;
  const flags = [...new Set(list.flatMap((s) => s.flag_reasons ?? []))];
  if (list.filter((s) => s.source_type === 'salaried').length > 1) flags.push('More than one full-time job');
  const linkedCount = all.filter((e) => e.income_source_id).length;

  return (
    <Card>
      {header}
      <CardContent className="space-y-3 px-4 pb-4 pt-0">
        {list.some((s) => s.verification_status === 'needs_review') && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-info/10 border border-info/30 text-sm">
            <ClipboardCheck className="h-4 w-4 text-info shrink-0" aria-hidden />
            <span className="text-info font-medium">Review required — a source needs more documentation</span>
          </div>
        )}
        {list.some((s) => s.vehicle_for_work) && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-sm">
            <Ban className="h-4 w-4 text-destructive shrink-0" aria-hidden />
            <span className="text-destructive font-medium">Not eligible — the vehicle is used for rideshare/commercial work.</span>
          </div>
        )}
        {list.some((s) => s.missed_days_flag) && (
          <Badge variant="outline" className="text-warning border-warning/30"><AlertTriangle className="h-3 w-3 mr-1" aria-hidden /> Missed work days flagged</Badge>
        )}

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div><p className="text-muted-foreground text-xs">Total stated</p><p className="font-bold text-base">{fmt(totalStated)}/mo</p></div>
          <div><p className="text-muted-foreground text-xs">Total calculated</p><p className="font-bold text-base">{fmt(totalCalculated)}/mo</p></div>
        </div>
        <Ratio label="Payment / income" value={pti} limit={prefs.max_pti} />
        {debtTotal > 0 && <Ratio label="DTI (payment + debts)" value={dti} limit={prefs.max_dti} />}

        {(linkedCount > 0 || unmatched.length > 0) && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <FileSearch className="h-3 w-3" aria-hidden />
            {linkedCount > 0 && <Badge variant="outline" className="text-xs text-success border-success/30">{linkedCount} document{linkedCount === 1 ? '' : 's'} linked</Badge>}
            {unmatched.length > 0 && <Badge variant="outline" className="text-xs text-warning border-warning/30">{unmatched.length} unmatched</Badge>}
          </div>
        )}

        {unmatched.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Read documents not linked to a source — choose one</p>
            {unmatched.map((ext) => <UnmatchedExtractionRow key={ext.id} extraction={ext} incomeSources={list} onLinked={refresh} />)}
          </div>
        )}

        <div className="space-y-3">
          <p className="text-xs font-medium text-muted-foreground">{list.length} income source{list.length === 1 ? '' : 's'}</p>
          {list.map((src) => <IncomeSourceCard key={src.id} source={src} linkedExtractions={bySource[src.id]} onUpdated={refresh} />)}
        </div>

        {flags.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Review flags</p>
            {flags.map((flag) => (
              <div key={flag} className="flex items-center gap-1.5 text-xs text-warning"><AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />{flag}</div>
            ))}
          </div>
        )}
      </CardContent>
      {dialog}
    </Card>
  );
}
