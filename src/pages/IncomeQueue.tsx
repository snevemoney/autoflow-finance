import { Send } from 'lucide-react';
import { AppHeader } from '@/components/layout/AppHeader';
import { QueueView, type QueueSort } from '@/components/deals/QueueView';
import { StatTile } from '@/components/ListControls';
import { Button } from '@/components/ui/button';
import { useDealCount } from '@/hooks/use-deals';
import { usePreferences } from '@/hooks/use-autoflow';
import { useUrlParams } from '@/hooks/use-url-state';

const SORTS: QueueSort[] = [
  { value: 'oldest', label: 'Waiting longest', sort: 'status_changed_at', ascending: true },
  { value: 'newest', label: 'Newest first', sort: 'created_at' },
  { value: 'amount', label: 'Largest loan', sort: 'loan_amount' },
];

export default function IncomeQueue() {
  const { prefs } = usePreferences();
  const { get, set } = useUrlParams();
  const docsOnly = get('waiting') === '1';
  const waiting = useDealCount({ statuses: ['income_verification'] });
  const onDealer = useDealCount({ statuses: ['income_verification'], waitingOnDealer: true });
  const stuck = useDealCount({ statuses: ['income_verification'], stuckDays: prefs.stale_days });

  return (
    <div className="flex flex-col h-full">
      <AppHeader
        title="Income Verification Queue"
        subtitle={waiting.data == null ? 'Loading…' : `${waiting.data} deal${waiting.data === 1 ? '' : 's'} waiting for income verification`}
      />
      <QueueView
        id="income"
        statuses={['income_verification']}
        sorts={SORTS}
        query={docsOnly ? { waitingOnDealer: true } : undefined}
        emptyText="Nothing waiting for income verification — credit-approved deals land here automatically."
        toolbar={(
          <Button variant={docsOnly ? 'default' : 'outline'} aria-pressed={docsOnly} onClick={() => set({ waiting: docsOnly ? null : '1' })}>
            <Send className="h-4 w-4 mr-2" aria-hidden /> Waiting on dealer
          </Button>
        )}
        stats={
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            <StatTile label="Waiting for verification" value={waiting.data ?? '—'} loading={waiting.isLoading} />
            <StatTile label="Waiting on dealer documents" value={onDealer.data ?? '—'} loading={onDealer.isLoading} tone={onDealer.data ? 'warning' : undefined} />
            <StatTile label={`Waiting over ${prefs.stale_days} days`} value={stuck.data ?? '—'} loading={stuck.isLoading} tone={stuck.data ? 'warning' : undefined} />
          </div>
        }
      />
    </div>
  );
}
