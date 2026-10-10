import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));

import { requestPasswordReset } from './passwordReset';

describe('requestPasswordReset', () => {
  beforeEach(() => { invoke.mockReset(); });

  it('calls auth-email with a recovery request pointing back to /reset-password', async () => {
    invoke.mockResolvedValue({ data: { ok: true }, error: null });
    await requestPasswordReset('marie@example.test', 'https://app.example');
    expect(invoke).toHaveBeenCalledWith('auth-email', {
      body: { type: 'recovery', email: 'marie@example.test', redirectTo: 'https://app.example/reset-password' },
    });
  });

  it('resolves the same way on an error reply or a network failure', async () => {
    invoke.mockResolvedValue({ data: null, error: { message: 'User not found' } });
    await expect(requestPasswordReset('nobody@example.test', 'https://app.example')).resolves.toBeUndefined();
    invoke.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(requestPasswordReset('x@example.test', 'https://app.example')).resolves.toBeUndefined();
  });
});
