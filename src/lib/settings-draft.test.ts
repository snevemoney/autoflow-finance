import { describe, expect, it } from 'vitest';
import { draftToPreferences, toDraft } from './settings-draft';
import { readPreferences } from './preferences';

const base = () => toDraft(readPreferences({}));

describe('settings draft', () => {
  it('saves canonical keys and drops legacy ones', () => {
    const d = { ...base(), min_apr: '4', max_apr: '19,99', allowed_terms: '36 48, 60', default_term_months: '60', funding_approval_limit: '' };
    const { prefs, error } = draftToPreferences(d, { apr_min: '2', terms: '12', other: 'kept' });
    expect(error).toBeUndefined();
    expect(prefs).toMatchObject({ min_apr: 4, max_apr: 19.99, allowed_terms: [36, 48, 60], default_term_months: 60, funding_approval_limit: null, other: 'kept' });
    expect(prefs).not.toHaveProperty('apr_min');
    expect(prefs).not.toHaveProperty('terms');
  });
  it('refuses inconsistent values', () => {
    expect(draftToPreferences({ ...base(), min_apr: '20', max_apr: '10' }, {}).error).toMatch(/APR/);
    expect(draftToPreferences({ ...base(), default_term_months: '90' }, {}).error).toMatch(/default term/);
    expect(draftToPreferences({ ...base(), allowed_terms: 'abc' }, {}).error).toMatch(/term/);
    expect(draftToPreferences({ ...base(), support_email: 'nope' }, {}).error).toMatch(/email/);
    expect(draftToPreferences({ ...base(), max_dti: '0' }, {}).error).toMatch(/DTI/);
    expect(draftToPreferences({ ...base(), funding_approval_limit: '-5' }, {}).error).toMatch(/limit/);
    expect(draftToPreferences({ ...base(), min_score_auto: '950' }, {}).error).toMatch(/score/);
  });
});
