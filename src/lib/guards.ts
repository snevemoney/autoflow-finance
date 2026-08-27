const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function isEmail(value: unknown): value is string {
  return typeof value === "string" && EMAIL_RE.test(value.trim()) && value.length <= 254;
}

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE_RE.test(value)) return false;
  const t = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(t);
}

/** Parse a money/amount input. Rejects NaN, Infinity, and empty strings. */
export function parseMoney(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}
