// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation, type Location } from 'react-router-dom';
import { AuthContext, type AuthContextType } from '@/contexts/AuthContext';
import type { UserRole } from '@/types/deal';
import { byText, cleanup, click, render, waitFor } from '@/test/dom';

const { page, toast } = vi.hoisted(() => ({
  page: (name: string) => ({ default: () => `[${name}]` }),
  toast: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('@/hooks/use-toast', () => ({ toast }));
vi.mock('@/components/layout/AppLayout', async () => {
  const { Outlet } = await import('react-router-dom');
  return {
    AppLayout: () => <div data-layout="staff"><Outlet /></div>,
    DealerLayout: () => <div data-layout="dealer"><Outlet /></div>,
  };
});
vi.mock('@/pages/Dashboard', () => page('Dashboard'));
vi.mock('@/pages/Pipeline', () => page('Pipeline'));
vi.mock('@/pages/DealsList', () => page('DealsList'));
vi.mock('@/pages/DealDetail', () => page('DealDetail'));
vi.mock('@/pages/NewDeal', () => page('NewDeal'));
vi.mock('@/pages/CreditQueue', () => page('CreditQueue'));
vi.mock('@/pages/IncomeQueue', () => page('IncomeQueue'));
vi.mock('@/pages/FundingQueue', () => page('FundingQueue'));
vi.mock('@/pages/Dealers', () => page('Dealers'));
vi.mock('@/pages/Users', () => page('Users'));
vi.mock('@/pages/Reports', () => page('Reports'));
vi.mock('@/pages/Settings', () => page('Settings'));
vi.mock('@/pages/Auth', () => page('Auth'));
vi.mock('@/pages/ForgotPassword', () => page('ForgotPassword'));
vi.mock('@/pages/ResetPassword', () => page('ResetPassword'));
vi.mock('@/pages/AcceptInvite', () => page('AcceptInvite'));
vi.mock('@/pages/PendingAccess', () => page('PendingAccess'));
vi.mock('@/pages/portal/PortalHome', () => page('PortalHome'));
vi.mock('@/pages/portal/PortalSubmit', () => page('PortalSubmit'));
vi.mock('@/pages/portal/PortalDeal', () => page('PortalDeal'));
vi.mock('@/pages/NotFound', () => page('NotFound'));

import { AppRoutes } from '@/App';

type Who = 'anonymous' | 'admin' | 'credit' | 'dealer' | 'no-role';

function auth(who: Who, extra: Partial<AuthContextType> = {}): AuthContextType {
  const roles: UserRole[] = who === 'admin' ? ['admin'] : who === 'credit' ? ['credit_analyst'] : who === 'dealer' ? ['dealer'] : [];
  const signedIn = who !== 'anonymous';
  const isStaff = roles.some((r) => r !== 'dealer');
  const dealerId = who === 'dealer' ? 'dl1' : null;
  return {
    user: signedIn ? ({ id: `u-${who}`, email: `${who}@example.test` } as AuthContextType['user']) : null,
    session: signedIn ? ({ access_token: 't' } as AuthContextType['session']) : null,
    loading: false,
    accessLoading: false,
    accessError: false,
    roles,
    dealerId,
    dealerName: dealerId ? 'Rive-Sud Autos' : null,
    profileName: '',
    isStaff,
    isDealer: !isStaff && !!dealerId,
    isAdmin: roles.includes('admin'),
    sessionEnded: false,
    signedOut: false,
    hasRole: (...want) => roles.includes('admin') || want.some((r) => roles.includes(r)),
    refreshAccess: vi.fn(async () => {}),
    signOut: vi.fn(async () => {}),
    ...extra,
  };
}

let location: Location;
function Probe() {
  location = useLocation();
  return null;
}

async function visit(path: string, value: AuthContextType) {
  const r = await render(
    <AuthContext.Provider value={value}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
        <Probe />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
  // lazy pages resolve asynchronously
  await waitFor(() => expect(r.text()).toMatch(/\[\w+\]|Can.t reach AutoFlow|Loading/));
  if (!value.loading && !(value.session && value.accessLoading) && !value.accessError) {
    await waitFor(() => expect(r.text()).toMatch(/\[\w+\]/));
  }
  return r;
}

describe('route guards', () => {
  beforeEach(() => { toast.mockReset(); });
  afterEach(cleanup);

  it('sends signed-out visitors to sign-in, remembering where they were going', async () => {
    const r = await visit('/deals/abc?tab=docs', auth('anonymous'));
    expect(location.pathname).toBe('/auth');
    expect(location.state).toEqual({ from: '/deals/abc?tab=docs' });
    expect(r.text()).toBe('[Auth]');
  });

  it('says the session ended when it expired or was signed out elsewhere', async () => {
    await visit('/pipeline', auth('anonymous', { sessionEnded: true }));
    expect(location.pathname).toBe('/auth');
    expect(location.state).toEqual({ from: '/pipeline', reason: 'session-ended' });
  });

  it('starts fresh after a deliberate sign-out', async () => {
    await visit('/deals/abc', auth('anonymous', { signedOut: true }));
    expect(location.pathname).toBe('/auth');
    expect(location.state).toBeNull();
  });

  it('keeps the public auth pages reachable without signing in', async () => {
    for (const [path, name] of [
      ['/auth', 'Auth'], ['/forgot-password', 'ForgotPassword'], ['/reset-password', 'ResetPassword'], ['/accept-invite', 'AcceptInvite'],
    ]) {
      const r = await visit(path, auth('anonymous'));
      expect(location.pathname).toBe(path);
      expect(r.text()).toBe(`[${name}]`);
      cleanup();
    }
  });

  it('waits while the session or the access are loading', async () => {
    const r = await visit('/', auth('admin', { accessLoading: true }));
    expect(r.container.querySelector('[role="status"]')).not.toBeNull();
    expect(r.text()).not.toContain('[Dashboard]');
  });

  it('shows "Can\'t reach AutoFlow" (not /pending) when roles could not be loaded', async () => {
    const value = auth('no-role', { accessError: true });
    const r = await visit('/deals', value);
    expect(location.pathname).toBe('/deals');
    expect(r.text()).toContain('Can’t reach AutoFlow');
    await click(byText(r.container, 'Retry', 'button'));
    expect(value.refreshAccess).toHaveBeenCalled();
  });

  it('sends accounts without a role to /pending', async () => {
    const r = await visit('/deals', auth('no-role'));
    expect(location.pathname).toBe('/pending');
    expect(r.text()).toBe('[PendingAccess]');
  });

  it('keeps dealers in their portal', async () => {
    for (const path of ['/', '/deals/deal-1', '/settings', '/users']) {
      await visit(path, auth('dealer'));
      expect(location.pathname).toBe('/portal');
      cleanup();
    }
    const r = await visit('/portal/deals/deal-1', auth('dealer'));
    expect(r.text()).toBe('[PortalDeal]');
  });

  it('sends staff away from the portal to the dashboard', async () => {
    const r = await visit('/portal/new', auth('credit'));
    expect(location.pathname).toBe('/');
    expect(r.text()).toBe('[Dashboard]');
  });

  it.each(['/users', '/settings', '/dealers'])('only lets administrators open %s', async (path) => {
    const r = await visit(path, auth('credit'));
    expect(location.pathname).toBe('/');
    expect(r.text()).toBe('[Dashboard]');
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'No access' }));
  });

  it('lets administrators into the admin pages', async () => {
    for (const [path, name] of [['/users', 'Users'], ['/settings', 'Settings'], ['/dealers', 'Dealers']]) {
      const r = await visit(path, auth('admin'));
      expect(location.pathname).toBe(path);
      expect(r.text()).toBe(`[${name}]`);
      cleanup();
    }
    expect(toast).not.toHaveBeenCalled();
  });

  it('lets other staff use the shared pages', async () => {
    const r = await visit('/reports', auth('credit'));
    expect(r.text()).toBe('[Reports]');
  });

  it('shows the 404 page for unknown addresses', async () => {
    const r = await visit('/nope', auth('admin'));
    expect(r.text()).toBe('[NotFound]');
  });
});
