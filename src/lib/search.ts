/** Lower-case, accent-free words (matches `deals.search_text`), wildcard characters removed. */
export function searchWords(q: string | null | undefined): string[] {
  return (q ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[%_*(),\\"'.:]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6);
}

