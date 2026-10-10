import { usePreferences } from '@/hooks/use-autoflow';

/** Lender name and support contact at the bottom of every dealer portal page. */
export function PortalFooter() {
  const { prefs } = usePreferences();
  return (
    <footer className="mt-8 border-t pt-4 pb-2 text-xs text-muted-foreground flex flex-wrap items-center justify-between gap-2">
      <span>{prefs.company_name} · Dealer portal</span>
      {prefs.support_email && (
        <span>
          Questions? <a className="text-accent hover:underline" href={`mailto:${prefs.support_email}`}>{prefs.support_email}</a>
        </span>
      )}
    </footer>
  );
}
