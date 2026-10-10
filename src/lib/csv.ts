/** CSV export helpers: spreadsheet-safe cells and a paged "fetch everything" loop with a cap. */

export type CsvValue = string | number | boolean | null | undefined;

/**
 * One CSV cell. Text that a spreadsheet would run as a formula (starts with = + - @, tab or CR)
 * is prefixed with a single quote; numbers are left alone so "-12.5" stays a number.
 */
export function escapeCsvCell(value: CsvValue): string {
  if (value == null) return '';
  let s = typeof value === 'number' ? (Number.isFinite(value) ? String(value) : '') : String(value);
  if (typeof value !== 'number' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Record<string, CsvValue>[], columns?: string[]): string {
  if (!rows.length && !columns?.length) return '';
  const cols = columns ?? Object.keys(rows[0]);
  return [cols.map(escapeCsvCell).join(','), ...rows.map((r) => cols.map((c) => escapeCsvCell(r[c])).join(','))].join('\n');
}

export interface FetchAllOptions {
  pageSize?: number;
  /** stop after this many rows (the export says it was cut) */
  cap?: number;
  onProgress?: (loaded: number, total: number | null) => void;
  signal?: AbortSignal;
}

/**
 * Calls `fetchPage(from, to)` (inclusive range, like PostgREST `.range()`) until a short page,
 * the reported total, or the cap is reached.
 */
export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => Promise<{ rows: T[]; total: number | null }>,
  { pageSize = 500, cap = 10_000, onProgress, signal }: FetchAllOptions = {},
): Promise<{ rows: T[]; total: number | null; truncated: boolean }> {
  const rows: T[] = [];
  let total: number | null = null;
  for (let from = 0; from < cap; from += pageSize) {
    if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
    const to = Math.min(from + pageSize, cap) - 1;
    const page = await fetchPage(from, to);
    if (page.total != null) total = page.total;
    rows.push(...page.rows);
    onProgress?.(rows.length, total);
    if (page.rows.length < to - from + 1) break;
    if (total != null && rows.length >= total) break;
  }
  const truncated = total != null ? rows.length < total : rows.length >= cap;
  return { rows, total, truncated };
}

export function downloadCsv(filename: string, csv: string) {
  // BOM so Excel opens accented names (Émilie, Québec) correctly
  const url = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
