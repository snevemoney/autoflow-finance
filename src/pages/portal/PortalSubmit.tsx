import { AppHeader } from '@/components/layout/AppHeader';
import { DealSubmissionForm } from '@/components/deals/DealSubmissionForm';

export default function PortalSubmit() {
  return (
    <div className="flex flex-col h-full">
      <AppHeader title="Submit a Deal" subtitle="Send the deal and every document you have — we'll ask if anything is missing" />
      <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
        <DealSubmissionForm mode="dealer" />
      </div>
    </div>
  );
}
