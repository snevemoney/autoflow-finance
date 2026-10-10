// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient } from '@/lib/queryClient';
import { cleanup, render, waitFor } from '@/test/dom';

type Result = { data: unknown; error: unknown };
const { mock } = vi.hoisted(() => {
  const mock = {
    listener: null as null | ((event: string, session: unknown) => void),
    results: {} as Record<string, () => Result>,
    signOut: vi.fn(),
  };
  return { mock };
});

vi.mock('@/integrations/supabase/client', () => {
  const query = (table: string) => {
    const result = () => Promise.resolve(mock.results[table]?.() ?? { data: null, error: null });
    const builder = {
      select: () => builder,
      eq: () => builder,
      maybeSingle: result,
      then: (ok: (v: Result) => unknown, fail?: (e: unknown) => unknown) => result().then(ok, fail),
    };
    return builder;
  };
  return {
    supabase: {
      from: query,
      auth: {
        onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
          mock.listener = cb;
          return { data: { subscription: { unsubscribe: () => { mock.listener = null; } } } };
        },
        signOut: (...args: unknown[]) => mock.signOut(...args),
      },
    },
  };
});

import { AuthProvider, useAuth, type AuthContextType } from './AuthContext';

const sessionFor = (id: string) => ({ access_token: `t-${id}`, user: { id, email: `${id}@example.test` } });
let ctx: AuthContextType;
function Probe() {
  ctx = useAuth();
  return null;
}

async function emit(event: string, session: unknown) {
  await act(async () => { mock.listener?.(event, session); });
}

function rolesAre(role: string | null) {
  mock.results.user_roles = () => ({ data: role ? [{ role }] : [], error: null });
  mock.results.dealer_users = () => ({ data: null, error: null });
  mock.results.profiles = () => ({ data: { name: 'Marie' }, error: null });
}

describe('AuthProvider', () => {
  let qc: ReturnType<typeof createQueryClient>;

  beforeEach(async () => {
    mock.results = {};
    mock.signOut.mockReset();
    qc = createQueryClient();
    await render(<QueryClientProvider client={qc}><AuthProvider><Probe /></AuthProvider></QueryClientProvider>);
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('clears the query cache when the signed-in user changes, before the new user renders', async () => {
    rolesAre('admin');
    await emit('INITIAL_SESSION', sessionFor('user-a'));
    await waitFor(() => expect(ctx.isAdmin).toBe(true));
    qc.setQueryData(['deals'], ['deal of user a']);
    qc.setQueryData(['notifications'], ['note for user a']);

    await emit('TOKEN_REFRESHED', sessionFor('user-a'));
    expect(qc.getQueryData(['deals'])).toEqual(['deal of user a']);

    rolesAre('dealer');
    await emit('SIGNED_OUT', null);
    expect(qc.getQueryData(['deals'])).toBeUndefined();
    expect(qc.getQueryData(['notifications'])).toBeUndefined();

    qc.setQueryData(['deals'], ['fetched while signed out']);
    await emit('SIGNED_IN', sessionFor('user-b'));
    expect(qc.getQueryData(['deals'])).toBeUndefined();
    expect(ctx.user?.id).toBe('user-b');
    // the previous account's roles are never shown for the new one
    expect(ctx.isAdmin).toBe(false);
  });

  it('treats a failed roles query as an error, not as "no role"', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    rolesAre('admin');
    mock.results.user_roles = () => ({ data: null, error: { message: 'Internal Server Error', code: '500' } });
    await emit('INITIAL_SESSION', sessionFor('user-a'));
    expect(ctx.accessLoading).toBe(true);
    await waitFor(() => expect(ctx.accessError).toBe(true), 3000);
    expect(ctx.accessLoading).toBe(false);

    // retry once the server is back
    rolesAre('admin');
    await act(async () => { await ctx.refreshAccess(); });
    expect(ctx.accessError).toBe(false);
    expect(ctx.isAdmin).toBe(true);
  });

  it('treats a failed profile query as an error too', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    rolesAre('admin');
    mock.results.profiles = () => ({ data: null, error: { message: 'Failed to fetch' } });
    await emit('INITIAL_SESSION', sessionFor('user-a'));
    await waitFor(() => expect(ctx.accessError).toBe(true), 3000);
  });

  it('recovers silently from a single blip', async () => {
    let calls = 0;
    rolesAre('admin');
    mock.results.user_roles = () => (++calls === 1 ? { data: null, error: { message: 'Failed to fetch' } } : { data: [{ role: 'admin' }], error: null });
    await emit('INITIAL_SESSION', sessionFor('user-a'));
    await waitFor(() => expect(ctx.isAdmin).toBe(true), 3000);
    expect(ctx.accessError).toBe(false);
  });

  it('keeps "no role" for accounts that genuinely have none', async () => {
    rolesAre(null);
    await emit('INITIAL_SESSION', sessionFor('user-new'));
    await waitFor(() => expect(ctx.accessLoading).toBe(false));
    expect(ctx.accessError).toBe(false);
    expect(ctx.roles).toEqual([]);
    expect(ctx.isStaff || ctx.isDealer).toBe(false);
  });

  it('marks the session as ended when it is signed out without the user asking', async () => {
    rolesAre('admin');
    await emit('INITIAL_SESSION', sessionFor('user-a'));
    await emit('SIGNED_OUT', null); // refresh refused / other tab
    expect(ctx.sessionEnded).toBe(true);
    expect(ctx.signedOut).toBe(false);
    await emit('SIGNED_IN', sessionFor('user-a'));
    expect(ctx.sessionEnded).toBe(false);
  });

  it('does not call a deliberate sign-out an ended session, and signs out locally if the server is unreachable', async () => {
    rolesAre('admin');
    await emit('INITIAL_SESSION', sessionFor('user-a'));
    mock.signOut.mockImplementation(async (opts?: { scope?: string }) => {
      if (!opts) return { error: { name: 'AuthRetryableFetchError', status: 0 } };
      mock.listener?.('SIGNED_OUT', null);
      return { error: null };
    });
    await act(async () => { await ctx.signOut(); });
    expect(mock.signOut).toHaveBeenLastCalledWith({ scope: 'local' });
    expect(ctx.session).toBeNull();
    expect(ctx.sessionEnded).toBe(false);
    expect(ctx.signedOut).toBe(true);
  });
});
