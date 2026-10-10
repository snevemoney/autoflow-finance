import { describe, expect, it } from 'vitest';
import { formatMoneyShort } from './metrics';

// Dashboard / report figures now come from the dashboard_metrics() and report_metrics() RPCs
// (see rpc.test.ts); only formatting is left here.
describe('formatting', () => {
  it('shortens money', () => {
    expect(formatMoneyShort(2_450_000)).toBe('$2.45M');
    expect(formatMoneyShort(84_000)).toBe('$84K');
    expect(formatMoneyShort(950)).toBe('$950');
  });
});
