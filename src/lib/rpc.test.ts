import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
const invoke = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a), functions: { invoke: (...a: unknown[]) => invoke(...a) } },
}));

import {
  adminMoveDeal, callRpc, chunk, declineDeal, documentUrl, normalizeDashboard, normalizeQueueCounts, normalizeReport, parseFieldError,
  percent, processDocuments, recordCreditDecision, retryDocument, safeHttpUrl, setCreditCondition, setUserAccess, setUserActive,
} from './rpc';

beforeEach(() => {
  rpc.mockReset();
  invoke.mockReset();
  rpc.mockResolvedValue({ data: null, error: null });
  invoke.mockResolvedValue({ data: {}, error: null });
});

describe('RPC wrappers', () => {
  it('admin_move_deal passes the contract argument names', async () => {
    rpc.mockResolvedValue({ data: 'credit_review', error: null });
    await expect(adminMoveDeal('d1', 'credit_review', '  back for a new score ')).resolves.toBe('credit_review');
    expect(rpc).toHaveBeenCalledWith('admin_move_deal', { _deal_id: 'd1', _status: 'credit_review', _note: 'back for a new score' });
  });

  it('decline_deal sends the internal reason and the dealer message separately', async () => {
    await declineDeal('d1', 'DTI 61%', 'We can’t approve this file as submitted.');
    expect(rpc).toHaveBeenCalledWith('decline_deal', { _deal_id: 'd1', _reason: 'DTI 61%', _dealer_message: 'We can’t approve this file as submitted.' });
    await declineDeal('d1', 'x', '   ');
    expect(rpc).toHaveBeenLastCalledWith('decline_deal', { _deal_id: 'd1', _reason: 'x', _dealer_message: null });
  });

  it('record_credit_decision sends conditions as [{label}] only for conditional', async () => {
    await recordCreditDecision({ dealId: 'd1', decision: 'conditional', conditions: [' Proof of residence ', '', 'Void cheque'], dealerMessage: 'Two items needed' });
    expect(rpc).toHaveBeenCalledWith('record_credit_decision', expect.objectContaining({
      _deal_id: 'd1', _decision: 'conditional',
      _conditions: [{ label: 'Proof of residence' }, { label: 'Void cheque' }], _dealer_message: 'Two items needed',
    }));
    await recordCreditDecision({ dealId: 'd1', decision: 'approved', conditions: ['ignored'], score: 702, tier: 'near_prime', bureau: 'equifax' });
    expect(rpc).toHaveBeenLastCalledWith('record_credit_decision', expect.objectContaining({ _conditions: null, _score: 702, _tier: 'near_prime' }));
  });

  it('refuses a conditional approval without 1–10 conditions before calling the server', async () => {
    await expect(recordCreditDecision({ dealId: 'd1', decision: 'conditional', conditions: [] })).rejects.toThrow(/1 to 10/);
    await expect(recordCreditDecision({ dealId: 'd1', decision: 'conditional', conditions: Array.from({ length: 11 }, (_, i) => `c${i}`) })).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('set_credit_condition returns the normalised conditions', async () => {
    rpc.mockResolvedValue({ data: [{ id: 'c1', label: 'Proof of residence', cleared_at: '2026-10-10T00:00:00Z', cleared_by: 'u1' }], error: null });
    const out = await setCreditCondition('d1', 'c1', true);
    expect(rpc).toHaveBeenCalledWith('set_credit_condition', { _deal_id: 'd1', _condition_id: 'c1', _cleared: true });
    expect(out[0]).toEqual({ id: 'c1', label: 'Proof of residence', cleared_at: '2026-10-10T00:00:00Z', cleared_by: 'u1' });
  });

  it('account RPCs', async () => {
    await setUserAccess('u2', 'credit_analyst', 'dl1');
    expect(rpc).toHaveBeenCalledWith('set_user_access', { _user_id: 'u2', _role: 'credit_analyst', _dealer_id: null });
    await setUserAccess('u3', 'dealer', 'dl1');
    expect(rpc).toHaveBeenLastCalledWith('set_user_access', { _user_id: 'u3', _role: 'dealer', _dealer_id: 'dl1' });
    await expect(setUserAccess('u3', 'dealer', null)).rejects.toThrow(/dealership/);
    await setUserActive('u2', false);
    expect(rpc).toHaveBeenLastCalledWith('set_user_active', { _user_id: 'u2', _active: false });
  });

  it('turns a PostgREST error into a thrown Error with its message', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Only admins can move deals', code: '42501' } });
    await expect(callRpc('admin_move_deal')).rejects.toMatchObject({ message: 'Only admins can move deals', code: '42501' });
  });
});

describe('aggregates', () => {
  it('queue counts default missing keys to 0 and coerce strings', () => {
    expect(normalizeQueueCounts({ credit_review: '4', approved: 2 })).toEqual({
      new_submission: 0, document_review: 0, credit_review: 4, income_verification: 0, funding_review: 0, approved: 2, open_requests: 0,
    });
    expect(normalizeQueueCounts(null).credit_review).toBe(0);
  });

  it('dashboard metrics', () => {
    const m = normalizeDashboard({ active: 7, approval_rate: 0.75, by_status: { funded: '2' }, automation_7d: { auto_sorted: 23 }, top_dealers: [{ dealer_id: 'dl1', name: 'Rive-Sud', funded: 2, submitted: 5, approval_rate: 0.8 }] });
    expect(m.active).toBe(7);
    expect(m.by_status.funded).toBe(2);
    expect(m.automation_7d).toEqual({ auto_sorted: 23, auto_filled: 0, requested: 0, auto_routed: 0 });
    expect(m.top_dealers[0].name).toBe('Rive-Sud');
    expect(normalizeDashboard({}).approval_rate).toBeNull();
  });

  it('report metrics', () => {
    const r = normalizeReport({ submitted: 10, funded_amount: '54990.5', by_month: [{ month: '2026-09', submitted: 4 }], by_dealer: [{ dealer_id: 'dl1', name: 'A', funded: 3 }] });
    expect(r.funded_amount).toBe(54990.5);
    expect(r.by_month[0]).toEqual({ month: '2026-09', submitted: 4, funded_count: 0, funded_amount: 0 });
    expect(r.by_dealer[0].funded_count).toBe(3);
    expect(r.avg_days_to_fund).toBeNull();
  });

  it('percent accepts 0..1 rates', () => {
    expect(percent(0.756)).toBe('76%');
    expect(percent(null)).toBe('—');
  });

  it('parses server field errors', () => {
    expect(parseFieldError('vin: VIN must be 17 characters')).toEqual({ field: 'vin', message: 'VIN must be 17 characters' });
    expect(parseFieldError('customer.zip: invalid postal code')).toEqual({ field: 'customer.zip', message: 'invalid postal code' });
    expect(parseFieldError('Dealer is not active')).toBeNull();
  });
});

describe('documents', () => {
  it('calls process-document in batches of at most five ids', async () => {
    const ids = Array.from({ length: 12 }, (_, i) => `doc${i}`);
    const out = await processDocuments(ids);
    expect(invoke).toHaveBeenCalledTimes(3);
    expect(invoke.mock.calls.map((c) => (c[1] as { body: { documentIds: string[] } }).body.documentIds.length)).toEqual([5, 5, 2]);
    expect(out.started).toHaveLength(12);
    expect(chunk([1, 2, 3], 5)).toEqual([[1, 2, 3]]);
  });

  it('reports the ids whose batch failed instead of throwing', async () => {
    invoke.mockResolvedValueOnce({ data: null, error: new Error('500') }).mockResolvedValue({ data: {}, error: null });
    const out = await processDocuments(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(out.failed).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(out.started).toEqual(['f']);
  });

  it('retry_document then process-document', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    await expect(retryDocument('doc1')).resolves.toEqual({ queued: true, started: true });
    expect(rpc).toHaveBeenCalledWith('retry_document', { _document_id: 'doc1' });
    expect(invoke).toHaveBeenCalledWith('process-document', { body: { documentIds: ['doc1'], force: false, background: true } });
  });

  it('file links only come from document-url and must be https', async () => {
    invoke.mockResolvedValue({ data: { url: 'https://x.supabase.co/storage/v1/object/sign/documents/d1/a.pdf?token=t' }, error: null });
    await expect(documentUrl('doc1')).resolves.toMatch(/^https:/);
    expect(invoke).toHaveBeenCalledWith('document-url', { body: { documentId: 'doc1', kind: 'file' } });
    invoke.mockResolvedValue({ data: { url: 'javascript:alert(1)' }, error: null });
    await expect(documentUrl('doc1')).rejects.toThrow();
    invoke.mockResolvedValue({ data: { url: 'http://evil.test/a.pdf' }, error: null });
    await expect(documentUrl('doc1', 'preview')).rejects.toThrow();
  });

  it('safeHttpUrl', () => {
    expect(safeHttpUrl('https://a.test/x')).toBe('https://a.test/x');
    expect(safeHttpUrl('http://127.0.0.1:54321/x')).toBe('http://127.0.0.1:54321/x');
    expect(safeHttpUrl('data:text/html,hi')).toBeNull();
    expect(safeHttpUrl('d1/a.pdf')).toBeNull();
  });
});
