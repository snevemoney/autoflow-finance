/**
 * Every react-query key starts with its kind and the signed-in user's id, so one user's cached data
 * is never shown to the next user who signs in on the same browser, and realtime updates can
 * invalidate exactly the keys a change touches.
 */
type Uid = string | null | undefined;

export const qk = {
  /** prefix of every deal list (pages, pipeline columns, counts) */
  deals: (uid: Uid) => ['deals', uid ?? null] as const,
  dealPage: (uid: Uid, params: unknown) => ['deals', uid ?? null, 'page', params] as const,
  dealCount: (uid: Uid, params: unknown) => ['deals', uid ?? null, 'count', params] as const,
  deal: (uid: Uid, id: string | undefined) => ['deal', uid ?? null, id ?? null] as const,
  queueCounts: (uid: Uid) => ['queue-counts', uid ?? null] as const,
  dashboard: (uid: Uid) => ['dashboard', uid ?? null] as const,
  report: (uid: Uid, from: string, to: string) => ['report', uid ?? null, from, to] as const,
  dealers: (uid: Uid) => ['dealers', uid ?? null] as const,
  dealerStats: (uid: Uid) => ['dealer-stats', uid ?? null] as const,
  users: (uid: Uid) => ['users', uid ?? null] as const,
  settings: (uid: Uid) => ['app-settings', uid ?? null] as const,
  preferences: (uid: Uid) => ['preferences', uid ?? null] as const,
  notifications: (uid: Uid) => ['notifications', uid ?? null] as const,
  checklist: (uid: Uid, dealId: string | undefined) => ['checklist', uid ?? null, dealId ?? null] as const,
  requests: (uid: Uid, dealId: string | undefined) => ['requests', uid ?? null, dealId ?? null] as const,
  dealerRequests: (uid: Uid) => ['dealer-requests', uid ?? null] as const,
  incomeSources: (uid: Uid, dealId: string | undefined) => ['income-sources', uid ?? null, dealId ?? null] as const,
  extractions: (uid: Uid, dealId: string | undefined) => ['extracted-income', uid ?? null, dealId ?? null] as const,
  incomeDocs: (uid: Uid, dealId: string | undefined) => ['income-docs', uid ?? null, dealId ?? null] as const,
  debts: (uid: Uid, dealId: string | undefined) => ['applicant-debts', uid ?? null, dealId ?? null] as const,
};
