import { QueryClient } from '@tanstack/react-query';

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: true } },
  });
}

/** The app's single query cache. */
export const queryClient = createQueryClient();

/**
 * Drops everything cached for the previous account: cancels in-flight queries (their late
 * results land in the discarded Query objects, never in the new cache) and clears all
 * queries and mutations.
 */
export function resetQueryCache(qc: QueryClient) {
  void qc.cancelQueries();
  qc.clear();
}

/**
 * Returns a function to call with the signed-in user id (null when signed out) on every auth
 * change, before React re-renders with the new user. Whenever the id differs from the one the
 * cache was filled for, the cache is reset, so the next account never sees the previous
 * account's deals or notifications — whether it's a sign-out, a sign-in, or a switch between
 * accounts. Same-user events (token refresh, profile update) keep the cache.
 * Returns true when it reset the cache.
 */
export function createCacheOwnerGuard(qc: QueryClient, reset: (qc: QueryClient) => void = resetQueryCache) {
  let owner: string | null = null;
  return (userId: string | null): boolean => {
    if (userId === owner) return false;
    owner = userId;
    reset(qc);
    return true;
  };
}
