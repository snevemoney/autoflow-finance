import { AppHeader } from '@/components/layout/AppHeader';
import { QueueView, type QueueFilter, type QueueSort } from '@/components/deals/QueueView';
import { StatTile } from '@/components/ListControls';
import { useDealCount } from '@/hooks/use-deals';
import { usePreferences } from '@/hooks/use-autoflow';

const SORTS: QueueSort[] = [
  { value: 'oldest', label: 'Waiting longest', sort: 'status_changed_at', ascending: true },
  { value: 'newest', label: 'Newest first', sort: 'created_at' },
  { value: 'amount_high', label: 'Highest amount', sort: 'loan_amount' },
  { value: 'amount_low', label: 'Lowest amount', sort: 'loan_amount', ascending: true },
];

const FILTERS: QueueFilter[] = [
  { value: 'review', label: 'Funding review', statuses: ['funding_review'] },
  { value: 'approved', label: 'Approved — ready to fund', statuses: ['approved'] },
];

export default function FundingQueue() {
  const { prefs } = usePreferences();
  const limit = prefs.funding_approval_limit;
  const review = useDealCount({ statuses: ['funding_review'] });
  const approved = useDealCount({ statuses: ['approved'] });
  const overLimit = useDealCount({ statuses: ['funding_review', 'approved'], loanAbove: limit }, { enabled: limit != null });
  const stuck = useDealCount({ statuses: ['funding_review'], stuckDays: prefs.stale_days });

  const total = review.data != null && approved.data != null ? review.data + approved.data : null;

  return (
    <div className="flex flex-col h-full">
      <AppHeader
        title="Funding Queue"
        subtitle={total == null ? 'Loading…' : `${total} in funding · ${approved.data} approved and ready to fund`}
      />
      <QueueView
        id="funding"
        statuses={['funding_review', 'approved']}
        filters={FILTERS}
        sorts={SORTS}
        emptyText="Nothing in funding yet — deals with verified income land here automatically."
        stats={
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile label="In funding review" value={review.data ?? '—'} loading={review.isLoading} />
            <StatTile label="Approved, ready to fund" value={approved.data ?? '—'} loading={approved.isLoading} tone="success" />
            <StatTile
              label={limit != null ? `Above $${limit.toLocaleString('en-CA')} limit` : 'Funding approval limit'}
              value={limit != null ? overLimit.data ?? '—' : 'Not set'}
              loading={limit != null && overLimit.isLoading}
              tone={overLimit.data ? 'warning' : undefined}
              hint={limit == null ? 'Set it in Settings → Business rules' : undefined}
            />
            <StatTile label={`Waiting over ${prefs.stale_days} days`} value={stuck.data ?? '—'} loading={stuck.isLoading} tone={stuck.data ? 'warning' : undefined} />
          </div>
        }
      />
    </div>
  );
}
