import { describe, expect, it, vi } from 'vitest';
import { escapeCsvCell, fetchAllPages, toCsv } from './csv';

describe('escapeCsvCell', () => {
  it('quotes commas, quotes and new lines', () => {
    expect(escapeCsvCell('x,y')).toBe('"x,y"');
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvCell('a\nb')).toBe('"a\nb"');
    expect(escapeCsvCell(null)).toBe('');
    expect(escapeCsvCell(undefined)).toBe('');
  });

  it('neutralises spreadsheet formulas (= + - @, tab, CR)', () => {
    expect(escapeCsvCell('=HYPERLINK("http://x","y")')).toBe(`"'=HYPERLINK(""http://x"",""y"")"`);
    expect(escapeCsvCell('+1 514 555 0101')).toBe("'+1 514 555 0101");
    expect(escapeCsvCell('-2+3')).toBe("'-2+3");
    expect(escapeCsvCell('@SUM(A1:A2)')).toBe("'@SUM(A1:A2)");
    expect(escapeCsvCell('\t=1')).toBe("'\t=1");
    expect(escapeCsvCell('Tremblay')).toBe('Tremblay');
  });

  it('leaves real numbers alone, including negatives', () => {
    expect(escapeCsvCell(-12.5)).toBe('-12.5');
    expect(escapeCsvCell(30500)).toBe('30500');
    expect(escapeCsvCell(NaN)).toBe('');
  });
});

describe('toCsv', () => {
  it('writes a header and rows', () => {
    expect(toCsv([{ a: 'x,y', b: 'say "hi"', c: null }])).toBe('a,b,c\n"x,y","say ""hi""",');
    expect(toCsv([], ['a', 'b'])).toBe('a,b');
    expect(toCsv([])).toBe('');
  });
});

describe('fetchAllPages', () => {
  const source = Array.from({ length: 1234 }, (_, i) => i);
  const page = async (from: number, to: number) => ({ rows: source.slice(from, to + 1), total: source.length });

  it('loops until every row is loaded and reports progress', async () => {
    const progress = vi.fn();
    const out = await fetchAllPages(page, { pageSize: 500, onProgress: progress });
    expect(out.rows).toHaveLength(1234);
    expect(out.truncated).toBe(false);
    expect(progress).toHaveBeenCalledTimes(3);
    expect(progress).toHaveBeenLastCalledWith(1234, 1234);
  });

  it('stops at the cap and says it was cut', async () => {
    const fetchPage = vi.fn(page);
    const out = await fetchAllPages(fetchPage, { pageSize: 500, cap: 1000 });
    expect(out.rows).toHaveLength(1000);
    expect(out.truncated).toBe(true);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(fetchPage).toHaveBeenLastCalledWith(500, 999);
  });

  it('stops on a short page when the total is unknown', async () => {
    const out = await fetchAllPages(async (from, to) => ({ rows: source.slice(from, Math.min(to + 1, 700)), total: null }), { pageSize: 500 });
    expect(out.rows).toHaveLength(700);
    expect(out.truncated).toBe(false);
  });
});
