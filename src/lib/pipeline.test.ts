import { describe, expect, it } from 'vitest';
import { describeMove, planMove } from './pipeline';

describe('planMove', () => {
  it('one step forward needs no confirmation', () => {
    expect(planMove('credit_review', 'income_verification')).toMatchObject({ kind: 'next', confirm: false });
  });

  it('skipping stages asks first and lists them', () => {
    const p = planMove('document_review', 'funding_review');
    expect(p).toMatchObject({ kind: 'skip', confirm: true, skipped: ['credit_review', 'income_verification'] });
    expect(describeMove('document_review', 'funding_review')).toMatch(/skips Credit Review, Income Verification/);
  });

  it('moving back explains which decisions are cleared', () => {
    expect(planMove('funding_review', 'credit_review')).toMatchObject({ kind: 'back', confirm: true, clears: ['the credit decision'] });
    expect(planMove('approved', 'income_verification').clears).toEqual(['the funding approval']);
    expect(planMove('approved', 'document_review').clears).toEqual(['the credit decision', 'the funding approval']);
    expect(planMove('income_verification', 'new_submission').clears).toEqual(['the credit decision']);
    expect(planMove('credit_review', 'document_review').clears).toEqual([]);
    expect(describeMove('approved', 'credit_review')).toMatch(/cleared: the credit decision and the funding approval/);
  });

  it('funded only from approved; declining goes through decline_deal', () => {
    expect(planMove('funding_review', 'funded')).toMatchObject({ kind: 'invalid' });
    expect(planMove('approved', 'funded')).toMatchObject({ kind: 'next' });
    expect(planMove('credit_review', 'declined')).toMatchObject({ kind: 'decline', confirm: true });
  });

  it('reopening a declined deal asks first', () => {
    expect(planMove('declined', 'credit_review')).toMatchObject({ kind: 'reopen', confirm: true, clears: ['the credit decision'] });
    expect(planMove('credit_review', 'credit_review').kind).toBe('same');
  });
});
