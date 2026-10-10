import { Suspense, useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { AppSidebar, DealerSidebar } from './AppSidebar';
import { MobileNavContext } from './mobile-nav';

/** Shown while a page's code loads: a header bar and a few content blocks. */
export function PageSkeleton() {
  return (
    <div className="flex h-full flex-col" role="status" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="flex h-14 md:h-16 shrink-0 items-center gap-3 border-b bg-card px-3 md:px-6">
        <Skeleton className="h-6 w-40" />
      </div>
      <div className="flex-1 space-y-4 overflow-hidden p-4 md:p-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    </div>
  );
}

function SkipLink() {
  return (
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-md focus:bg-card focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-foreground focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-ring"
    >
      Skip to content
    </a>
  );
}

/**
 * Sidebar + page. On phones (< md) the sidebar becomes a drawer opened from the hamburger in
 * the page header; on larger screens it is the usual (collapsible) column.
 */
function Shell({ kind }: { kind: 'staff' | 'dealer' }) {
  const { pathname } = useLocation();
  const [navOpen, setNavOpen] = useState(false);

  // close the drawer after navigating
  useEffect(() => setNavOpen(false), [pathname]);

  const nav = useMemo(() => ({ open: () => setNavOpen(true), isOpen: navOpen }), [navOpen]);
  const Sidebar = kind === 'staff' ? AppSidebar : DealerSidebar;

  return (
    <MobileNavContext.Provider value={nav}>
      <div className="flex h-screen supports-[height:100dvh]:h-dvh w-full overflow-hidden bg-background">
        <SkipLink />
        <Sidebar variant="desktop" />
        <Sheet open={navOpen} onOpenChange={setNavOpen}>
          <SheetContent
            side="left"
            id="mobile-navigation"
            className={
              'w-72 max-w-[85vw] border-sidebar-border bg-sidebar p-0 text-sidebar-foreground md:hidden '
              // the sheet's own close button: line it up with the brand row, below the notch
              + '[&>button]:top-[calc(env(safe-area-inset-top)+1.5rem)] [&>button]:ring-offset-sidebar [&>button]:focus:ring-sidebar-ring'
              + ' [&>button]:data-[state=open]:bg-transparent'
            }
          >
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <SheetDescription className="sr-only">AutoFlow pages</SheetDescription>
            <Sidebar variant="drawer" />
          </SheetContent>
        </Sheet>
        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 min-w-0 overflow-hidden pb-[env(safe-area-inset-bottom)] pr-[env(safe-area-inset-right)] focus:outline-none"
        >
          <ErrorBoundary variant="inline" resetKey={pathname} homeHref={kind === 'dealer' ? '/portal' : '/'}>
            <Suspense fallback={<PageSkeleton />}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
    </MobileNavContext.Provider>
  );
}

export function AppLayout() {
  return <Shell kind="staff" />;
}

export function DealerLayout() {
  return <Shell kind="dealer" />;
}
