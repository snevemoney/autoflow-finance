import { describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));

import { linkErrorInUrl } from './use-email-link';
import { isChunkLoadError } from '@/lib/lazyPage';

describe('linkErrorInUrl', () => {
  it('spots the error Supabase puts in an expired or used link', () => {
    expect(linkErrorInUrl({ hash: '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid', search: '' })).toBe(true);
    expect(linkErrorInUrl({ hash: '', search: '?error=server_error' })).toBe(true);
  });

  it('accepts links carrying a session or a token', () => {
    expect(linkErrorInUrl({ hash: '#access_token=a&refresh_token=b&type=recovery', search: '' })).toBe(false);
    expect(linkErrorInUrl({ hash: '', search: '?token_hash=abc&type=invite' })).toBe(false);
    expect(linkErrorInUrl({ hash: '', search: '' })).toBe(false);
  });
});

describe('isChunkLoadError', () => {
  it('recognises a missing chunk after a new deploy', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/Pipeline-abc.js'))).toBe(true);
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
  });
});
