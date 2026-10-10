import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFERENCES, parseTerms, ratioTone, readPreferences } from './preferences';
import { statusConfig } from '@/types/deal';
import { KeyBatcher } from './batcher';
import { searchWords } from './search';

describe('readPreferences', () => {
  it('uses the defaults when nothing is stored', () => {
    expect(readPreferences(null)).toEqual(DEFAULT_PREFERENCES);
    expect(readPreferences({ stale_days: '3' }).max_dti).toBe(45);
    expect(readPreferences({}).max_pti).toBe(20);
    expect(readPreferences({}).require_staff_mfa).toBe(false);
    expect(readPreferences({}).decline_vehicle_for_work).toBe(true);
  });

  it('reads the contract keys and the older ones', () => {
    const p = readPreferences({ min_apr: 3.5, max_apr: '19.99', allowed_terms: [84, 60, 72], default_term_months: 60, funding_approval_limit: '50000', max_dti: 40 });
    expect([p.min_apr, p.max_apr]).toEqual([3.5, 19.99]);
    expect(p.allowed_terms).toEqual([60, 72, 84]);
    expect(p.default_term_months).toBe(60);
    expect(p.funding_approval_limit).toBe(50000);
    expect(p.max_dti).toBe(40);
    const legacy = readPreferences({ apr_min: '4.0', apr_max: '18.0', terms: '36, 48, 60', approval_limit: '45000' });
    expect([legacy.min_apr, legacy.max_apr, legacy.funding_approval_limit]).toEqual([4, 18, 45000]);
    expect(legacy.allowed_terms).toEqual([36, 48, 60]);
    expect(legacy.default_term_months).toBe(48); // 72 not allowed → middle option
  });

  it('parses term lists', () => {
    expect(parseTerms('36,48 abc 60')).toEqual([36, 48, 60]);
    expect(parseTerms([])).toBeNull();
  });
});

describe('ratio tones (PTI / DTI colours)', () => {
  it('ok within the limit, warning up to 10 points over, red beyond', () => {
    expect(ratioTone(18, 20)).toBe('ok');
    expect(ratioTone(25, 20)).toBe('warn');
    expect(ratioTone(31, 20)).toBe('bad'); // the old code could never show red
    expect(ratioTone(null, 20)).toBeNull();
  });
});

describe('status fallback', () => {
  it('known statuses use their config', () => {
    expect(statusConfig('credit_review').label).toBe('Credit Review');
  });
  it('unknown values get a neutral badge instead of crashing', () => {
    expect(statusConfig('on_hold')).toEqual({ label: 'On hold', color: 'text-muted-foreground', bgColor: 'bg-muted' });
    expect(statusConfig(undefined).label).toBe('Unknown');
  });
});

describe('KeyBatcher', () => {
  it('invalidates each key once per burst', async () => {
    const flushed: unknown[][][] = [];
    const b = new KeyBatcher((keys) => flushed.push(keys), 10);
    b.add(['deals', 'u1'], ['deal', 'u1', 'd1']);
    b.add(['deals', 'u1']);
    await new Promise((r) => setTimeout(r, 30));
    expect(flushed).toEqual([[['deals', 'u1'], ['deal', 'u1', 'd1']]]);
  });
});

describe('search words', () => {
  it('matches the accent-free, lower-case search_text column and strips wildcards', () => {
    expect(searchWords('  Émilie  TREMBLAY ')).toEqual(['emilie', 'tremblay']);
    expect(searchWords('AF-2026%_*')).toEqual(['af-2026']);
    expect(searchWords('')).toEqual([]);
  });
});
