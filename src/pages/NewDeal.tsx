import { AppHeader } from '@/components/layout/AppHeader';
import { DealSubmissionForm } from '@/components/deals/DealSubmissionForm';

export default function NewDeal() {
  return (
    <div className="flex flex-col h-full">
      <AppHeader title="New Deal" subtitle="Enter a deal on behalf of a dealer — it follows the same automated flow" />
      <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
        <DealSubmissionForm mode="staff" />
      </div>
    </div>
  );
}
