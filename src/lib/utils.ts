import { formatDistanceToNow } from "date-fns";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Relative time ("3 hours ago"). Server timestamps can be a few seconds ahead of the
 * browser clock, so future times are clamped to now instead of reading "in 3 seconds".
 */
export function ago(value: string | number | Date, opts: { addSuffix?: boolean } = { addSuffix: true }) {
  const t = Math.min(new Date(value).getTime(), Date.now());
  return formatDistanceToNow(t, opts);
}
