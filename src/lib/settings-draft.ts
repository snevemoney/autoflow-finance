import { parseTerms, type AppPreferences } from './preferences';
import { EMAIL_RE } from './deal-schema';

/** Editable copy of the preferences: numbers as typed text until saved. */
export type Draft = Record<string, string | boolean>;

export const toDraft = (p: AppPreferences): Draft => ({
  company_name: p.company_name, support_email: p.support_email,
  min_apr: String(p.min_apr), max_apr: String(p.max_apr), allowed_terms: p.allowed_terms.join(', '),
  default_term_months: String(p.default_term_months), funding_approval_limit: p.funding_approval_limit == null ? '' : String(p.funding_approval_limit),
  max_dti: String(p.max_dti), max_pti: String(p.max_pti), decline_vehicle_for_work: p.decline_vehicle_for_work,
  require_staff_mfa: p.require_staff_mfa, stale_days: String(p.stale_days),
  notify_new: p.notify_new, notify_status: p.notify_status, notify_uploads: p.notify_uploads,
  min_score_auto: String(p.min_score_auto), min_score_review: String(p.min_score_review), min_score_decline: String(p.min_score_decline),
  ltv_new: String(p.ltv_new), ltv_used: String(p.ltv_used), manager_above: String(p.manager_above),
});

const LEGACY_KEYS = ['apr_min', 'apr_max', 'terms', 'approval_limit', 'notify_stale'];

/** Validates the draft; returns the preferences to store or the first problem. */
export function draftToPreferences(d: Draft, current: Record<string, unknown>): { prefs?: Record<string, unknown>; error?: string } {
  const num = (k: string) => Number(String(d[k] ?? '').replace(',', '.').trim());
  const minApr = num('min_apr'); const maxApr = num('max_apr');
  if (!Number.isFinite(minApr) || !Number.isFinite(maxApr) || minApr < 0 || maxApr > 40 || minApr > maxApr) return { error: 'The APR range must be between 0 and 40, lowest first.' };
  const terms = parseTerms(String(d.allowed_terms));
  if (!terms) return { error: 'List at least one term in months (e.g. 36, 48, 60, 72).' };
  const defTerm = num('default_term_months');
  if (!terms.includes(defTerm)) return { error: 'The default term must be one of the allowed terms.' };
  const limitText = String(d.funding_approval_limit ?? '').trim();
  const limit = limitText === '' ? null : num('funding_approval_limit');
  if (limit !== null && (!Number.isFinite(limit) || limit <= 0)) return { error: 'The funding approval limit must be a positive amount (or empty for none).' };
  for (const [k, label, max] of [['max_dti', 'Maximum DTI', 100], ['max_pti', 'Maximum PTI', 100], ['ltv_new', 'LTV limit (new)', 300], ['ltv_used', 'LTV limit (used)', 300]] as const) {
    const n = num(k);
    if (!Number.isFinite(n) || n <= 0 || n > max) return { error: `${label} must be between 1 and ${max}.` };
  }
  for (const k of ['min_score_auto', 'min_score_review', 'min_score_decline'] as const) {
    const n = num(k);
    if (!Number.isInteger(n) || n < 300 || n > 900) return { error: 'Credit score thresholds must be whole numbers between 300 and 900.' };
  }
  const stale = num('stale_days');
  if (!Number.isInteger(stale) || stale < 1 || stale > 60) return { error: 'Stale days must be between 1 and 60.' };
  const email = String(d.support_email ?? '').trim();
  if (email && !EMAIL_RE.test(email)) return { error: 'The support email is not a valid address.' };
  const manager = num('manager_above');
  if (!Number.isFinite(manager) || manager <= 0) return { error: 'The manager approval amount must be positive.' };

  const out: Record<string, unknown> = { ...current };
  for (const k of LEGACY_KEYS) delete out[k];
  Object.assign(out, {
    company_name: String(d.company_name ?? '').trim() || 'AutoFlow', support_email: email || null,
    min_apr: minApr, max_apr: maxApr, allowed_terms: terms, default_term_months: defTerm, funding_approval_limit: limit,
    max_dti: num('max_dti'), max_pti: num('max_pti'), decline_vehicle_for_work: d.decline_vehicle_for_work === true,
    require_staff_mfa: d.require_staff_mfa === true, stale_days: stale,
    notify_new: d.notify_new === true, notify_status: d.notify_status === true, notify_uploads: d.notify_uploads === true,
    min_score_auto: num('min_score_auto'), min_score_review: num('min_score_review'), min_score_decline: num('min_score_decline'),
    ltv_new: num('ltv_new'), ltv_used: num('ltv_used'), manager_above: manager,
  });
  return { prefs: out };
}

