import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * A search box bound to `?q=` both ways: typing updates the URL after a short pause (so the query
 * and the address bar agree), and a URL change from elsewhere — the header search, back/forward —
 * updates the box. Changing the search resets `?page`.
 */
export function useUrlSearch(key = 'q', delay = 300) {
  const [params, setParams] = useSearchParams();
  const urlValue = params.get(key) ?? '';
  const [input, setInput] = useState(urlValue);
  const lastSeen = useRef(urlValue);

  useEffect(() => {
    if (urlValue !== lastSeen.current) {
      lastSeen.current = urlValue;
      setInput(urlValue);
    }
  }, [urlValue]);

  useEffect(() => {
    if (input.trim() === urlValue.trim()) return;
    const t = setTimeout(() => {
      const value = input.trim();
      lastSeen.current = value;
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        next.delete('page');
        return next;
      }, { replace: true });
    }, delay);
    return () => clearTimeout(t);
  }, [input, urlValue, key, delay, setParams]);

  return { input, setInput, value: urlValue.trim() };
}

/** Read/write a few plain `?key=value` params; setting one resets `?page` unless it is the page itself. */
export function useUrlParams() {
  const [params, setParams] = useSearchParams();
  const get = useCallback((key: string) => params.get(key) ?? '', [params]);
  const set = useCallback((patch: Record<string, string | number | null | undefined>, opts: { replace?: boolean } = {}) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(patch)) {
        if (v == null || v === '' || v === 0 && k === 'page') next.delete(k);
        else next.set(k, String(v));
      }
      if (!('page' in patch)) next.delete('page');
      return next;
    }, { replace: opts.replace ?? false });
  }, [setParams]);
  return { params, get, set };
}
