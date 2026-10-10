import { useEffect } from 'react';
import { matchPath, useLocation } from 'react-router-dom';

export const APP_NAME = 'AutoFlow';

/** Browser-tab title for each route (most specific patterns first). */
const ROUTE_TITLES: [pattern: string, title: string][] = [
  ['/', 'Dashboard'],
  ['/pipeline', 'Pipeline'],
  ['/deals', 'All deals'],
  ['/deals/new', 'New deal'],
  ['/deals/:id', 'Deal'],
  ['/credit', 'Credit review'],
  ['/income', 'Income verification'],
  ['/funding', 'Funding'],
  ['/dealers', 'Dealers'],
  ['/users', 'Users'],
  ['/reports', 'Reports'],
  ['/settings', 'Settings'],
  ['/portal', 'My deals'],
  ['/portal/new', 'Submit a deal'],
  ['/portal/deals/:id', 'Deal'],
  ['/auth', 'Sign in'],
  ['/forgot-password', 'Forgot password'],
  ['/reset-password', 'Choose a new password'],
  ['/accept-invite', 'Accept invitation'],
  ['/pending', 'Waiting for access'],
];

export function titleForPath(pathname: string): string {
  const hit = ROUTE_TITLES.find(([pattern]) => matchPath({ path: pattern, end: true }, pathname));
  return `${hit ? hit[1] : 'Page not found'} · ${APP_NAME}`;
}

/** Keeps document.title in sync with the current route ("Pipeline · AutoFlow"). */
export function useRouteTitle() {
  const { pathname } = useLocation();
  useEffect(() => {
    document.title = titleForPath(pathname);
  }, [pathname]);
}

/**
 * Where the header search goes: the deals list (staff) or the portal list (dealers), with
 * `?q=`. Already on that list, the other query parameters (filters) are kept so the page's
 * searchParams change and the list updates; the page number is dropped. An empty search on
 * the list clears `q`; elsewhere it does nothing (null).
 */
export function headerSearchTarget(opts: { pathname: string; search: string; term: string; isDealer: boolean }) {
  const listPath = opts.isDealer ? '/portal' : '/deals';
  const term = opts.term.trim();
  const onList = opts.pathname === listPath;
  if (!term && !onList) return null;
  const params = new URLSearchParams(onList ? opts.search : '');
  if (term) params.set('q', term);
  else params.delete('q');
  params.delete('page');
  const search = params.toString();
  return { pathname: listPath, search: search ? `?${search}` : '' };
}
