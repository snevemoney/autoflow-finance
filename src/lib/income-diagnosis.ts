/** Why MI and YTD may disagree, which method to prefer and which documents settle it (pure). */
import type { PayFrequency } from './income-math';

export interface GapDiagnosis {
  reasons: string[];
  docs: string[];
  method: 'mi' | 'ytd';
  why: string;
}

export function diagnoseGap(input: {
  sourceType: string;
  mi: number;
  ytd: number;
  ytdMonths: number;
  payFrequency: PayFrequency;
  contractMonths?: number | null;
}): GapDiagnosis {
  const { sourceType, mi, ytd, ytdMonths, payFrequency, contractMonths } = input;
  const miHigher = mi > ytd;
  const months = Number.isInteger(ytdMonths) ? String(ytdMonths) : ytdMonths.toFixed(1);
  const reasons: string[] = [];
  const docs: string[] = [];
  const add = (...d: string[]) => d.forEach((x) => { if (!docs.includes(x)) docs.push(x); });

  if (sourceType === 'seasonal') {
    reasons.push(miHigher
      ? 'Seasonal worker — YTD may include off-season months with little or no pay.'
      : 'Seasonal worker — the current stub may be from the off-season; YTD includes peak earnings.');
    add('12 months bank statements', 'Prior year T4');
  }
  if (sourceType === 'education') {
    reasons.push(contractMonths && contractMonths < 12
      ? `Education employee on a ${contractMonths}-month contract; YTD divides by ${months} calendar months.`
      : 'Education employee — check the academic calendar against the calendar year.');
    add('Employment contract', 'Prior year T4');
  }
  if (sourceType === 'part_time') {
    reasons.push(miHigher
      ? 'Hourly worker — the current stub may have more hours than usual.'
      : 'Hourly worker — the current stub may have fewer hours than usual.');
    add('3 months pay stubs', '3 months bank statements');
  }
  if (sourceType === 'self_employed' || sourceType === 'contractor') {
    reasons.push('Self-employed or contractor income is often irregular — compare with 12 months of deposits.');
    add('12 months bank statements', 'Most recent tax return', 'Profit & loss statement');
  }
  if (ytdMonths <= 2) {
    reasons.push(`Only ${months} month${ytdMonths === 1 ? '' : 's'} of YTD — recent hire or new position.`);
    add('Offer letter / employment verification');
  }
  if (miHigher && payFrequency === 'biweekly') {
    reasons.push('Bi-weekly pay has 26 periods a year; some months have 3 pay days.');
    if (!docs.length) add('3 months pay stubs');
  }
  if (!reasons.length) {
    reasons.push(miHigher
      ? 'The current stub may include overtime, bonuses or commissions not in the YTD average.'
      : 'Earlier months may have had overtime, bonuses or a higher rate before a pay change.');
  }
  if (!docs.length) add('3 months pay stubs', '3 months bank statements');

  let method: 'mi' | 'ytd';
  let why: string;
  if (sourceType === 'seasonal' || sourceType === 'part_time' || sourceType === 'self_employed' || sourceType === 'contractor') {
    method = 'ytd';
    why = 'YTD averages out irregular pay.';
  } else if (sourceType === 'education') {
    method = 'mi';
    why = 'MI reflects the contract pay; YTD divides by calendar months.';
  } else if (ytdMonths <= 2) {
    method = 'mi';
    why = 'Too little YTD history — the current stub is more reliable for now.';
  } else {
    method = miHigher ? 'ytd' : 'mi';
    why = 'Using the lower figure is the conservative choice.';
  }
  return { reasons, docs, method, why };
}
