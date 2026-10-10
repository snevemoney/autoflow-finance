import { describe, expect, it } from 'vitest';
import { headerSearchTarget, titleForPath } from './route-meta';

describe('titleForPath', () => {
  it('names each page', () => {
    expect(titleForPath('/')).toBe('Dashboard · AutoFlow');
    expect(titleForPath('/pipeline')).toBe('Pipeline · AutoFlow');
    expect(titleForPath('/deals')).toBe('All deals · AutoFlow');
    expect(titleForPath('/deals/new')).toBe('New deal · AutoFlow');
    expect(titleForPath('/deals/7f9c')).toBe('Deal · AutoFlow');
    expect(titleForPath('/portal')).toBe('My deals · AutoFlow');
    expect(titleForPath('/portal/deals/7f9c')).toBe('Deal · AutoFlow');
    expect(titleForPath('/auth')).toBe('Sign in · AutoFlow');
    expect(titleForPath('/reset-password')).toBe('Choose a new password · AutoFlow');
  });

  it('falls back to "Page not found"', () => {
    expect(titleForPath('/nope')).toBe('Page not found · AutoFlow');
    expect(titleForPath('/deals/1/extra')).toBe('Page not found · AutoFlow');
  });
});

describe('headerSearchTarget', () => {
  it('opens the staff deal list with the search', () => {
    expect(headerSearchTarget({ pathname: '/pipeline', search: '', term: '  Roy ', isDealer: false }))
      .toEqual({ pathname: '/deals', search: '?q=Roy' });
  });

  it('opens the dealer portal list with the search', () => {
    expect(headerSearchTarget({ pathname: '/portal/deals/x', search: '', term: 'AF-2026', isDealer: true }))
      .toEqual({ pathname: '/portal', search: '?q=AF-2026' });
  });

  it('on the list already: keeps the filters, replaces q and goes back to page 1', () => {
    expect(headerSearchTarget({ pathname: '/deals', search: '?status=credit_review&q=old&page=3', term: 'new', isDealer: false }))
      .toEqual({ pathname: '/deals', search: '?status=credit_review&q=new' });
  });

  it('an empty search clears q on the list and does nothing elsewhere', () => {
    expect(headerSearchTarget({ pathname: '/deals', search: '?q=old&status=funded', term: ' ', isDealer: false }))
      .toEqual({ pathname: '/deals', search: '?status=funded' });
    expect(headerSearchTarget({ pathname: '/portal', search: '?q=old', term: '', isDealer: true }))
      .toEqual({ pathname: '/portal', search: '' });
    expect(headerSearchTarget({ pathname: '/', search: '', term: '', isDealer: false })).toBeNull();
  });

  it('encodes the term', () => {
    expect(headerSearchTarget({ pathname: '/', search: '', term: 'Émilie & Co', isDealer: false })?.search)
      .toBe('?q=%C3%89milie+%26+Co');
  });
});
