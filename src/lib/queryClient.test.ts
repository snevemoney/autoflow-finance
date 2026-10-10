import { describe, expect, it, vi } from 'vitest';
import { createCacheOwnerGuard, createQueryClient, resetQueryCache } from './queryClient';

const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
};

describe('resetQueryCache', () => {
  it('removes cached data', async () => {
    const qc = createQueryClient();
    qc.setQueryData(['deals'], [{ id: 'a-deal' }]);
    qc.setQueryData(['notifications'], [{ id: 'a-note' }]);
    resetQueryCache(qc);
    expect(qc.getQueryData(['deals'])).toBeUndefined();
    expect(qc.getQueryData(['notifications'])).toBeUndefined();
    expect(qc.getQueryCache().getAll()).toHaveLength(0);
  });

  it('cancels in-flight queries so a late response never reaches the new cache', async () => {
    const qc = createQueryClient();
    const slow = deferred<string[]>();
    let aborted = false;
    const fetching = qc.fetchQuery({
      queryKey: ['deals'],
      queryFn: ({ signal }) => {
        signal.addEventListener('abort', () => { aborted = true; });
        return slow.promise;
      },
    }).catch(() => 'cancelled');

    resetQueryCache(qc);
    slow.resolve(['previous user deal']);
    await fetching;

    expect(aborted).toBe(true);
    expect(qc.getQueryData(['deals'])).toBeUndefined();
  });
});

describe('createCacheOwnerGuard', () => {
  it('resets when the signed-in user changes, including sign-out', () => {
    const qc = createQueryClient();
    const reset = vi.fn();
    const onUser = createCacheOwnerGuard(qc, reset);

    expect(onUser('user-a')).toBe(true); // first sign-in
    expect(onUser('user-a')).toBe(false); // token refresh, same user
    expect(onUser(null)).toBe(true); // sign-out
    expect(onUser(null)).toBe(false);
    expect(onUser('user-b')).toBe(true); // someone else signs in
    expect(onUser('user-a')).toBe(true); // direct switch without a sign-out event
    expect(reset).toHaveBeenCalledTimes(4);
    expect(reset).toHaveBeenCalledWith(qc);
  });

  it('does nothing while nobody is signed in', () => {
    const reset = vi.fn();
    const onUser = createCacheOwnerGuard(createQueryClient(), reset);
    expect(onUser(null)).toBe(false);
    expect(reset).not.toHaveBeenCalled();
  });

  it('really clears the previous user data with the default reset', () => {
    const qc = createQueryClient();
    const onUser = createCacheOwnerGuard(qc);
    onUser('user-a');
    qc.setQueryData(['deals'], ['deal of user a']);
    onUser('user-a');
    expect(qc.getQueryData(['deals'])).toEqual(['deal of user a']);
    onUser('user-b');
    expect(qc.getQueryData(['deals'])).toBeUndefined();
  });
});
