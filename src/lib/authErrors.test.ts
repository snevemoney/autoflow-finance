import { describe, expect, it } from 'vitest';
import { passwordUpdateErrorMessage, safeReturnPath, signInErrorKind, signInErrorMessage } from './authErrors';

describe('signInErrorKind', () => {
  it('recognises wrong credentials', () => {
    expect(signInErrorKind({ name: 'AuthApiError', status: 400, code: 'invalid_credentials', message: 'Invalid login credentials' })).toBe('credentials');
    expect(signInErrorKind({ status: 400, message: 'Invalid login credentials' })).toBe('credentials');
  });

  it('recognises too many attempts', () => {
    expect(signInErrorKind({ status: 429, code: 'over_request_rate_limit', message: 'Request rate limit reached' })).toBe('rate_limit');
    expect(signInErrorKind({ status: 429, message: 'Too many requests' })).toBe('rate_limit');
  });

  it('recognises network failures', () => {
    expect(signInErrorKind({ name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' })).toBe('network');
    expect(signInErrorKind(new TypeError('Failed to fetch'))).toBe('network');
  });

  it('recognises unconfirmed and deactivated accounts', () => {
    expect(signInErrorKind({ code: 'email_not_confirmed', message: 'Email not confirmed' })).toBe('unconfirmed');
    expect(signInErrorKind({ code: 'user_banned', message: 'User is banned' })).toBe('deactivated');
  });

  it('falls back to a generic message', () => {
    expect(signInErrorKind({ status: 500, message: 'Database error' })).toBe('unknown');
    expect(signInErrorKind(undefined)).toBe('unknown');
    expect(signInErrorMessage({ status: 500 })).toMatch(/try again/);
  });

  it('gives distinct messages for credentials, rate limits and network', () => {
    const msgs = new Set([
      signInErrorMessage({ code: 'invalid_credentials' }),
      signInErrorMessage({ status: 429 }),
      signInErrorMessage({ name: 'AuthRetryableFetchError' }),
    ]);
    expect(msgs.size).toBe(3);
  });
});

describe('passwordUpdateErrorMessage', () => {
  it('explains the common failures', () => {
    expect(passwordUpdateErrorMessage({ code: 'same_password', status: 422 })).toMatch(/haven.t used/);
    expect(passwordUpdateErrorMessage({ code: 'weak_password', status: 422 })).toMatch(/too easy/);
    expect(passwordUpdateErrorMessage({ code: 'session_not_found', status: 403 })).toMatch(/expired/);
    expect(passwordUpdateErrorMessage({ name: 'AuthRetryableFetchError', status: 0 })).toMatch(/internet/);
    expect(passwordUpdateErrorMessage({ status: 500, message: 'boom' })).toMatch(/try again/);
  });
});

describe('safeReturnPath', () => {
  it('keeps in-app paths with their query', () => {
    expect(safeReturnPath('/deals/abc')).toBe('/deals/abc');
    expect(safeReturnPath('/deals?q=roy')).toBe('/deals?q=roy');
  });

  it('refuses external or odd targets', () => {
    expect(safeReturnPath('https://evil.example')).toBe('/');
    expect(safeReturnPath('//evil.example/x')).toBe('/');
    expect(safeReturnPath('/\\evil.example')).toBe('/');
    expect(safeReturnPath(undefined)).toBe('/');
    expect(safeReturnPath({ pathname: '/deals' })).toBe('/');
  });

  it('never returns to an auth page', () => {
    expect(safeReturnPath('/auth')).toBe('/');
    expect(safeReturnPath('/reset-password#x')).toBe('/');
    expect(safeReturnPath('/accept-invite', '/portal')).toBe('/portal');
  });
});
