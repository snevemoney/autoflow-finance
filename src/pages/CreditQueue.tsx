import { AppHeader } from '@/components/layout/AppHeader';
import { QueueView, type QueueSort } from '@/components/deals/QueueView';
import { StatTile } from '@/components/ListControls';
import { useDealCount } from '@/hooks/use-deals';
import { usePreferences } from '@/hooks/use-autoflow';

const SORTS: QueueSort[] = [
  { value: 'oldest', label: 'Waiting longest', sort: 'status_changed_at', ascending: true },
  { value: 'newest', label: 'Newest first', sort: 'created_at' },
  { value: 'score_high', label: 'Highest score', sort: 'credit_score' },
  { value: 'score_low', label: 'Lowest score', sort: 'credit_score', ascending: true },
  { value: 'amount', label: 'Largest loan', sort: 'loan_amount' },
];

export default function CreditQueue() {
  const { prefs } = usePreferences();
  const waiting = useDealCount({ statuses: ['credit_review'] });
  const stuck = useDealCount({ statuses: ['credit_review'], stuckDays: prefs.stale_days });
  const prime = useDealCount({ statuses: ['credit_review'], creditTiers: ['prime', 'near_prime'] });
  const subprime = useDealCount({ statuses: ['credit_review'], creditTiers: ['subprime', 'deep_subprime'] });

  return (
    <div className="flex flex-col h-full">
      <AppHeader
        title="Credit Review Queue"
        subtitle={waiting.data == null ? 'Loading…' : `${waiting.data} deal${waiting.data === 1 ? '' : 's'} waiting for a credit decision`}
      />
      <QueueView
        id="credit"
        statuses={['credit_review']}
        sorts={SORTS}
        extras={['requests', 'debts', 'income']}
        emptyText="Nothing waiting for credit review — complete files land here automatically."
        stats={
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile label="Waiting for credit" value={waiting.data ?? '—'} loading={waiting.isLoading} />
            <StatTile label={`Waiting over ${prefs.stale_days} days`} value={stuck.data ?? '—'} loading={stuck.isLoading} tone={stuck.data ? 'warning' : undefined} />
            <StatTile label="Prime / near prime" value={prime.data ?? '—'} loading={prime.isLoading} tone="success" />
            <StatTile label="Subprime" value={subprime.data ?? '—'} loading={subprime.isLoading} tone="warning" hint={`DTI limit ${prefs.max_dti}% · PTI ${prefs.max_pti}%`} />
          </div>
        }
      />
    </div>
  );
}
