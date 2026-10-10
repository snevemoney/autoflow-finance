/**
 * Validation for the deal submission form (dealer portal and staff "New deal").
 * Form values are the raw input strings; `toSubmitPayload` turns valid values into the `submit_deal` payload.
 * The server validates again and answers "field: message" — `formFieldForServerField` maps that back.
 */
import { z } from 'zod';
import { parseAmount } from './income-math';

export const INCOME_TYPES = [
  { value: 'salaried', label: 'Employed (salary / hourly)' },
  { value: 'part_time', label: 'Part-time' },
  { value: 'self_employed', label: 'Self-employed' },
  { value: 'contractor', label: 'Contractor' },
  { value: 'seasonal', label: 'Seasonal' },
  { value: 'education', label: 'Education sector' },
  { value: 'pension', label: 'Pension / retired' },
  { value: 'government_assistance', label: 'Government assistance' },
] as const;

export const VEHICLE_CONDITIONS = ['new', 'used', 'certified'] as const;

export interface DealRules {
  minApr: number;
  maxApr: number;
  allowedTerms: number[];
  /** staff must pick the dealership; dealers submit for their own */
  requireDealer: boolean;
  now?: Date;
}

/** VIN: 17 characters, letters and digits, never I, O or Q. */
export const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;
/** Canadian postal code (Canada Post letters only). */
export const POSTAL_RE = /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z] ?\d[ABCEGHJ-NPRSTV-Z]\d$/;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function phoneDigits(raw: string): string {
  const d = (raw ?? '').replace(/\D/g, '');
  return d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
}

/** "5145550101" → "514-555-0101" (left as typed if it isn't 10 digits). */
export function formatPhone(raw: string): string {
  const d = phoneDigits(raw);
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : raw.trim();
}

/** "j4k2t4" → "J4K 2T4" */
export function formatPostalCode(raw: string): string {
  const s = (raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s.length === 6 ? `${s.slice(0, 3)} ${s.slice(3)}` : (raw ?? '').toUpperCase().trim();
}

export function normalizeVin(raw: string): string {
  return (raw ?? '').toUpperCase().replace(/[\s-]/g, '');
}

/** Whole years between a YYYY-MM-DD birth date and `now` (null if not a real date). */
export function ageOn(dob: string, now = new Date()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob ?? '');
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  let age = now.getUTCFullYear() - y;
  if (now.getUTCMonth() + 1 < mo || (now.getUTCMonth() + 1 === mo && now.getUTCDate() < d)) age -= 1;
  return age;
}

const blank = (s: string | undefined) => !s || !s.trim();
const amount = (s: string | undefined) => (blank(s) ? NaN : parseAmount(s as string));

/** Amount financed when the field is left blank: price − down payment − positive trade equity. */
export function suggestedLoan(v: Pick<DealFormValues, 'invoice_price' | 'down_payment' | 'has_trade_in' | 'ti_value' | 'ti_payoff'>): number {
  const price = amount(v.invoice_price) || 0;
  const down = amount(v.down_payment) || 0;
  const equity = v.has_trade_in ? (amount(v.ti_value) || 0) - (amount(v.ti_payoff) || 0) : 0;
  return Math.max(Math.round((price - down - Math.max(equity, 0)) * 100) / 100, 0);
}

export function effectiveLoan(v: DealFormValues): number {
  const typed = amount(v.loan_amount);
  return Number.isFinite(typed) ? typed : suggestedLoan(v);
}

const str = z.string();

export function makeDealSchema(rules: DealRules) {
  const now = rules.now ?? new Date();
  const maxYear = now.getFullYear() + 2;

  return z.object({
    dealer_id: str,
    first_name: str,
    last_name: str,
    email: str,
    phone: str,
    date_of_birth: str,
    street: str,
    city: str,
    state: str,
    zip: str,
    income_type: z.enum(INCOME_TYPES.map((t) => t.value) as [string, ...string[]]),
    employer: str,
    job_title: str,
    monthly_income: str,
    years_employed: str,
    year: str,
    make: str,
    model: str,
    trim: str,
    vin: str,
    mileage: str,
    condition: z.enum(VEHICLE_CONDITIONS),
    color: str,
    invoice_price: str,
    msrp: str,
    down_payment: str,
    loan_amount: str,
    apr: str,
    term_months: str,
    has_trade_in: z.boolean(),
    ti_year: str,
    ti_make: str,
    ti_model: str,
    ti_vin: str,
    ti_mileage: str,
    ti_value: str,
    ti_payoff: str,
  }).superRefine((v, ctx) => {
    const issue = (path: keyof DealFormValues, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });

    // every check lives here (not in the shape) so all problems are reported at once
    if (rules.requireDealer && blank(v.dealer_id)) issue('dealer_id', 'Choose the dealership');
    if (blank(v.first_name)) issue('first_name', 'Enter the first name');
    if (blank(v.last_name)) issue('last_name', 'Enter the last name');
    if (blank(v.make)) issue('make', 'Enter the make');
    if (blank(v.model)) issue('model', 'Enter the model');
    const maxLen: [keyof DealFormValues, number][] = [
      ['first_name', 80], ['last_name', 80], ['street', 200], ['city', 100], ['state', 40], ['employer', 120], ['job_title', 120],
      ['make', 60], ['model', 80], ['trim', 80], ['color', 40], ['ti_make', 60], ['ti_model', 80],
    ];
    for (const [k, n] of maxLen) if (String(v[k] ?? '').trim().length > n) issue(k, `Keep it under ${n} characters`);

    if (!blank(v.email) && !EMAIL_RE.test(v.email.trim())) issue('email', 'Enter a valid email address');
    if (!blank(v.phone) && phoneDigits(v.phone).length !== 10) issue('phone', 'Enter a 10-digit phone number');
    if (!blank(v.date_of_birth)) {
      const age = ageOn(v.date_of_birth, now);
      if (age == null) issue('date_of_birth', 'Enter a valid date');
      else if (age < 18) issue('date_of_birth', 'The customer must be at least 18');
      else if (age > 100) issue('date_of_birth', 'Check the date of birth (over 100 years)');
    }
    if (!blank(v.zip) && !POSTAL_RE.test(formatPostalCode(v.zip))) issue('zip', 'Use a Canadian postal code like A1A 1A1');

    if (!blank(v.monthly_income)) {
      const n = amount(v.monthly_income);
      if (!Number.isFinite(n) || n < 0) issue('monthly_income', 'Enter an amount of 0 or more');
    }
    if (!blank(v.years_employed)) {
      const n = amount(v.years_employed);
      if (!Number.isFinite(n) || n < 0 || n > 70) issue('years_employed', 'Enter years between 0 and 70');
    }

    const year = Number(v.year);
    if (blank(v.year) || !Number.isInteger(year) || year < 1980 || year > maxYear) issue('year', `Enter a year from 1980 to ${maxYear}`);
    if (!blank(v.vin) && !VIN_RE.test(normalizeVin(v.vin))) issue('vin', 'A VIN has 17 letters and digits (never I, O or Q)');
    if (!blank(v.mileage)) {
      const n = amount(v.mileage);
      if (!Number.isFinite(n) || n < 0 || n > 2_000_000) issue('mileage', 'Enter the odometer in km');
    }

    const price = amount(v.invoice_price);
    if (!Number.isFinite(price) || price <= 0) issue('invoice_price', 'Enter the selling price');
    if (!blank(v.msrp)) {
      const n = amount(v.msrp);
      if (!Number.isFinite(n) || n < 0) issue('msrp', 'Enter an amount of 0 or more');
    }
    const down = blank(v.down_payment) ? 0 : amount(v.down_payment);
    if (!Number.isFinite(down) || down < 0) issue('down_payment', 'Enter an amount of 0 or more');

    const loan = effectiveLoan(v);
    if (!Number.isFinite(loan) || loan <= 0) issue('loan_amount', 'Enter the amount financed');

    const apr = amount(v.apr);
    if (!Number.isFinite(apr)) issue('apr', 'Enter the rate');
    else if (apr < rules.minApr || apr > rules.maxApr) issue('apr', `The rate must be between ${rules.minApr}% and ${rules.maxApr}%`);

    const term = Number(v.term_months);
    if (!rules.allowedTerms.includes(term)) issue('term_months', `Choose a term: ${rules.allowedTerms.join(', ')} months`);

    if (v.has_trade_in) {
      if (!blank(v.ti_year)) {
        const ty = Number(v.ti_year);
        if (!Number.isInteger(ty) || ty < 1980 || ty > maxYear) issue('ti_year', `Enter a year from 1980 to ${maxYear}`);
      }
      if (!blank(v.ti_vin) && !VIN_RE.test(normalizeVin(v.ti_vin))) issue('ti_vin', 'A VIN has 17 letters and digits (never I, O or Q)');
      for (const k of ['ti_value', 'ti_payoff', 'ti_mileage'] as const) {
        if (!blank(v[k])) {
          const n = amount(v[k]);
          if (!Number.isFinite(n) || n < 0) issue(k, 'Enter an amount of 0 or more');
        }
      }
    }
  });
}

export type DealFormValues = z.input<ReturnType<typeof makeDealSchema>>;

export function defaultDealValues(defaultTerm: number): DealFormValues {
  return {
    dealer_id: '', first_name: '', last_name: '', email: '', phone: '', date_of_birth: '', street: '', city: '', state: 'QC', zip: '',
    income_type: 'salaried', employer: '', job_title: '', monthly_income: '', years_employed: '',
    year: String(new Date().getFullYear()), make: '', model: '', trim: '', vin: '', mileage: '', condition: 'used', color: '',
    invoice_price: '', msrp: '', down_payment: '0', loan_amount: '', apr: '', term_months: String(defaultTerm),
    has_trade_in: false, ti_year: '', ti_make: '', ti_model: '', ti_vin: '', ti_mileage: '', ti_value: '', ti_payoff: '',
  };
}

/** Labels for the error summary. */
export const FIELD_LABELS: Record<keyof DealFormValues, string> = {
  dealer_id: 'Dealership', first_name: 'First name', last_name: 'Last name', email: 'Email', phone: 'Phone',
  date_of_birth: 'Date of birth', street: 'Street address', city: 'City', state: 'Province', zip: 'Postal code',
  income_type: 'Income type', employer: 'Employer', job_title: 'Job title', monthly_income: 'Stated monthly income',
  years_employed: 'Years with employer', year: 'Vehicle year', make: 'Make', model: 'Model', trim: 'Trim', vin: 'VIN',
  mileage: 'Odometer', condition: 'Condition', color: 'Colour', invoice_price: 'Selling price', msrp: 'MSRP',
  down_payment: 'Down payment', loan_amount: 'Amount financed', apr: 'Rate (APR)', term_months: 'Term',
  has_trade_in: 'Trade-in', ti_year: 'Trade-in year', ti_make: 'Trade-in make', ti_model: 'Trade-in model',
  ti_vin: 'Trade-in VIN', ti_mileage: 'Trade-in odometer', ti_value: 'Trade value', ti_payoff: 'Lien payoff',
};

const num = (s: string) => {
  const n = amount(s);
  return Number.isFinite(n) ? String(n) : '';
};

/** The `submit_deal` payload for valid form values. */
export function toSubmitPayload(v: DealFormValues, mode: 'dealer' | 'staff') {
  return {
    dealer_id: mode === 'staff' ? v.dealer_id : undefined,
    customer: {
      first_name: v.first_name.trim(), last_name: v.last_name.trim(), email: v.email.trim().toLowerCase(),
      phone: blank(v.phone) ? '' : formatPhone(v.phone), date_of_birth: v.date_of_birth || '',
      street: v.street.trim(), city: v.city.trim(), state: v.state.trim(), zip: blank(v.zip) ? '' : formatPostalCode(v.zip),
    },
    employment: {
      income_type: v.income_type, employer: v.employer.trim(), job_title: v.job_title.trim(),
      monthly_income: num(v.monthly_income), years_employed: num(v.years_employed),
    },
    vehicle: {
      year: v.year.trim(), make: v.make.trim(), model: v.model.trim(), trim: v.trim.trim(), vin: normalizeVin(v.vin),
      mileage: num(v.mileage) ? String(Math.round(Number(num(v.mileage)))) : '', condition: v.condition, color: v.color.trim(),
      invoice_price: num(v.invoice_price), msrp: num(v.msrp),
    },
    financing: {
      down_payment: num(v.down_payment) || '0', loan_amount: String(effectiveLoan(v)), apr: num(v.apr), term_months: v.term_months,
    },
    trade_in: v.has_trade_in ? {
      year: v.ti_year.trim(), make: v.ti_make.trim(), model: v.ti_model.trim(), vin: normalizeVin(v.ti_vin),
      mileage: num(v.ti_mileage) ? String(Math.round(Number(num(v.ti_mileage)))) : '', value: num(v.ti_value), payoff: num(v.ti_payoff),
    } : undefined,
  };
}

const SERVER_FIELD_ALIASES: Record<string, keyof DealFormValues> = {
  postal_code: 'zip', zip: 'zip', province: 'state', state: 'state',
  price: 'invoice_price', selling_price: 'invoice_price', invoice_price: 'invoice_price',
  amount_financed: 'loan_amount', loan_amount: 'loan_amount', down_payment: 'down_payment',
  apr: 'apr', rate: 'apr', term: 'term_months', term_months: 'term_months',
  dob: 'date_of_birth', date_of_birth: 'date_of_birth', income: 'monthly_income', monthly_income: 'monthly_income',
  stated_income: 'monthly_income', dealer: 'dealer_id', dealer_id: 'dealer_id', odometer: 'mileage',
};

/** "customer.zip" / "zip" / "trade_in.vin" → the form field it belongs to (or null). */
export function formFieldForServerField(field: string): keyof DealFormValues | null {
  const parts = field.toLowerCase().split('.');
  const leaf = parts[parts.length - 1];
  const tradeIn = parts.length > 1 && /^trade_?in$/.test(parts[0]);
  if (tradeIn) {
    const map: Record<string, keyof DealFormValues> = {
      year: 'ti_year', make: 'ti_make', model: 'ti_model', vin: 'ti_vin', mileage: 'ti_mileage', value: 'ti_value', payoff: 'ti_payoff',
    };
    return map[leaf] ?? null;
  }
  if (leaf in SERVER_FIELD_ALIASES) return SERVER_FIELD_ALIASES[leaf];
  return leaf in FIELD_LABELS ? (leaf as keyof DealFormValues) : null;
}
