/** The app_settings.preferences keys the app uses, with their defaults (contract "Settings"). */

export interface AppPreferences {
  company_name: string;
  support_email: string;
  min_apr: number;
  max_apr: number;
  default_term_months: number;
  allowed_terms: number[];
  /** funding above this shows a warning to the funding manager (null = no limit) */
  funding_approval_limit: number | null;
  max_dti: number;
  max_pti: number;
  decline_vehicle_for_work: boolean;
  require_staff_mfa: boolean;
  stale_days: number;
  notify_new: boolean;
  notify_status: boolean;
  notify_uploads: boolean;
  notify_stale: boolean;
  min_score_auto: number;
  min_score_review: number;
  min_score_decline: number;
  ltv_new: number;
  ltv_used: number;
  manager_above: number;
}

export const DEFAULT_PREFERENCES: AppPreferences = {
  company_name: 'AutoFlow',
  support_email: '',
  min_apr: 0,
  max_apr: 29.99,
  default_term_months: 72,
  allowed_terms: [36, 48, 60, 72, 84],
  funding_approval_limit: null,
  max_dti: 45,
  max_pti: 20,
  decline_vehicle_for_work: true,
  require_staff_mfa: false,
  stale_days: 3,
  notify_new: true,
  notify_status: true,
  notify_uploads: true,
  notify_stale: true,
  min_score_auto: 720,
  min_score_review: 620,
  min_score_decline: 550,
  ltv_new: 120,
  ltv_used: 110,
  manager_above: 75000,
};

const toNum = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  return null;
};
const toBool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : d);

export function parseTerms(v: unknown): number[] | null {
  const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,\s]+/) : null;
  if (!list) return null;
  const terms = [...new Set(list.map(toNum).filter((n): n is number => n != null && Number.isInteger(n) && n > 0 && n <= 120))]
    .sort((a, b) => a - b);
  return terms.length ? terms : null;
}

/** Reads stored preferences (also the older apr_min/apr_max/terms/approval_limit keys) over the defaults. */
export function readPreferences(raw: unknown): AppPreferences {
  const p = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_PREFERENCES;
  const n = (key: keyof AppPreferences, ...legacy: string[]) => {
    for (const k of [key, ...legacy]) {
      const v = toNum(p[k]);
      if (v != null) return v;
    }
    return d[key] as number;
  };
  const allowed = parseTerms(p.allowed_terms) ?? parseTerms(p.terms) ?? d.allowed_terms;
  const defTerm = n('default_term_months');
  const limit = toNum(p.funding_approval_limit) ?? toNum(p.approval_limit);
  let minApr = n('min_apr', 'apr_min');
  let maxApr = n('max_apr', 'apr_max');
  if (minApr > maxApr) [minApr, maxApr] = [maxApr, minApr];
  return {
    company_name: typeof p.company_name === 'string' && p.company_name.trim() ? p.company_name.trim() : d.company_name,
    support_email: typeof p.support_email === 'string' ? p.support_email.trim() : d.support_email,
    min_apr: minApr,
    max_apr: maxApr,
    allowed_terms: allowed,
    default_term_months: allowed.includes(defTerm) ? defTerm : allowed.includes(72) ? 72 : allowed[Math.floor(allowed.length / 2)],
    funding_approval_limit: limit != null && limit > 0 ? limit : null,
    max_dti: n('max_dti'),
    max_pti: n('max_pti'),
    decline_vehicle_for_work: toBool(p.decline_vehicle_for_work, d.decline_vehicle_for_work),
    require_staff_mfa: toBool(p.require_staff_mfa, d.require_staff_mfa),
    stale_days: Math.max(1, Math.round(n('stale_days'))),
    notify_new: toBool(p.notify_new, d.notify_new),
    notify_status: toBool(p.notify_status, d.notify_status),
    notify_uploads: toBool(p.notify_uploads, d.notify_uploads),
    notify_stale: toBool(p.notify_stale, d.notify_stale),
    min_score_auto: n('min_score_auto'),
    min_score_review: n('min_score_review'),
    min_score_decline: n('min_score_decline'),
    ltv_new: n('ltv_new'),
    ltv_used: n('ltv_used'),
    manager_above: n('manager_above'),
  };
}

/** Ratio helpers so every screen colours DTI / PTI the same way. */
export type RatioTone = 'ok' | 'warn' | 'bad';

/** Within the limit: ok; up to 10 points over: warn; further over: bad. */
export function ratioTone(valuePct: number | null | undefined, limitPct: number): RatioTone | null {
  if (valuePct == null || !Number.isFinite(valuePct)) return null;
  if (valuePct <= limitPct) return 'ok';
  if (valuePct <= limitPct + 10) return 'warn';
  return 'bad';
}

export const TONE_TEXT: Record<RatioTone, string> = { ok: 'text-success', warn: 'text-warning', bad: 'text-destructive' };
