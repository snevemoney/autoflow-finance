import { useCallback, useRef, useState } from 'react';
import { downloadCsv, fetchAllPages, toCsv } from '@/lib/csv';
import { errorMessage } from '@/lib/rpc';
import { statusConfig, type Deal } from '@/types/deal';
import { toast } from '@/hooks/use-toast';
import { fetchDealRange, type DealQuery } from './use-deals';

export const EXPORT_CAP = 10_000;
const PAGE = 500;

export function dealCsvRow(d: Deal) {
  return {
    deal_number: d.dealNumber,
    status: statusConfig(d.status).label,
    customer: `${d.customer.firstName} ${d.customer.lastName}`.trim(),
    dealer: d.dealerName,
    vehicle: `${d.vehicle.year || ''} ${d.vehicle.make} ${d.vehicle.model}`.trim(),
    vin: d.vehicle.vin,
    loan_amount: d.financingTerms.loanAmount,
    apr: d.financingTerms.apr,
    term_months: d.financingTerms.termMonths,
    ltv: d.ltv,
    credit_score: d.creditInfo?.score ?? null,
    submitted: d.createdAt,
    funded_at: d.fundedAt ?? null,
    funded_amount: d.fundedAmount ?? null,
  };
}

/** Exports every deal matching a filter: pages of 500, capped, with progress, formula-safe cells. */
export function useDealExport() {
  const [progress, setProgress] = useState<{ loaded: number; total: number | null } | null>(null);
  const abort = useRef<AbortController | null>(null);

  const run = useCallback(async (q: DealQuery, filename: string) => {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setProgress({ loaded: 0, total: null });
    try {
      const query: DealQuery = { ...q, extras: [], page: undefined, pageSize: undefined };
      const { rows, total, truncated } = await fetchAllPages(
        (from, to) => fetchDealRange(query, from, to, from === 0 ? 'exact' : null),
        { pageSize: PAGE, cap: EXPORT_CAP, signal: ctrl.signal, onProgress: (loaded, t) => setProgress({ loaded, total: t }) },
      );
      if (!rows.length) {
        toast({ title: 'Nothing to export', description: 'No deals match these filters.' });
        return;
      }
      downloadCsv(filename, toCsv(rows.map(dealCsvRow)));
      toast({
        title: `Exported ${rows.length.toLocaleString('en-CA')} deal${rows.length === 1 ? '' : 's'}`,
        description: truncated ? `Only the first ${EXPORT_CAP.toLocaleString('en-CA')} of ${total?.toLocaleString('en-CA') ?? 'many'} — narrow the filters to export the rest.` : undefined,
      });
    } catch (e) {
      if ((e as { name?: string })?.name !== 'AbortError') {
        toast({ title: 'Export failed', description: errorMessage(e), variant: 'destructive' });
      }
    } finally {
      if (abort.current === ctrl) {
        abort.current = null;
        setProgress(null);
      }
    }
  }, []);

  const cancel = useCallback(() => abort.current?.abort(), []);
  return { run, cancel, progress, running: progress != null };
}
