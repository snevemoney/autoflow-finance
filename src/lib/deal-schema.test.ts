import { describe, expect, it } from 'vitest';
import {
  ageOn, defaultDealValues, effectiveLoan, formatPhone, formatPostalCode, formFieldForServerField, makeDealSchema,
  toSubmitPayload, type DealFormValues,
} from './deal-schema';

const now = new Date('2026-10-10T12:00:00Z');
const rules = { minApr: 4, maxApr: 24.99, allowedTerms: [36, 48, 60, 72, 84], requireDealer: false, now };
const schema = makeDealSchema(rules);

const valid = (over: Partial<DealFormValues> = {}): DealFormValues => ({
  ...defaultDealValues(72),
  first_name: 'Émilie', last_name: 'Tremblay', email: 'emilie@courriel.test', phone: '514 555 0101',
  date_of_birth: '1990-05-14', zip: 'j4k2t4', make: 'Toyota', model: 'RAV4', year: '2023',
  vin: '2T3P1RFV8PW123456', invoice_price: '32,995', down_payment: '2495', loan_amount: '30500', apr: '8.99', term_months: '72',
  monthly_income: '5200',
  ...over,
});

const errorsOf = (v: DealFormValues, s = schema) => {
  const r = s.safeParse(v);
  return r.success ? {} : Object.fromEntries(r.error.issues.map((i) => [i.path.join('.'), i.message]));
};

describe('deal submission schema', () => {
  it('accepts a complete deal', () => {
    expect(errorsOf(valid())).toEqual({});
  });

  it('reports every problem at once, including required fields', () => {
    const e = errorsOf({ ...defaultDealValues(72), apr: '8', term_months: '72' });
    expect(Object.keys(e)).toEqual(expect.arrayContaining(['first_name', 'last_name', 'make', 'model', 'invoice_price', 'loan_amount']));
  });

  it('VIN is optional, but 17 characters without I, O or Q', () => {
    expect(errorsOf(valid({ vin: '' })).vin).toBeUndefined();
    expect(errorsOf(valid({ vin: '2t3p1rfv8pw123456' })).vin).toBeUndefined();
    expect(errorsOf(valid({ vin: '123' })).vin).toMatch(/17/);
    expect(errorsOf(valid({ vin: '2T3P1RFV8PW12345O' })).vin).toBeDefined();
    expect(errorsOf(valid({ vin: '2T3P1RFV8PW1234I6' })).vin).toBeDefined();
    expect(errorsOf(valid({ vin: '2T3P1RFV8PW1234Q6' })).vin).toBeDefined();
  });

  it('Canadian postal code A1A 1A1', () => {
    expect(errorsOf(valid({ zip: 'H2X 1Y4' })).zip).toBeUndefined();
    expect(errorsOf(valid({ zip: 'h2x1y4' })).zip).toBeUndefined();
    expect(errorsOf(valid({ zip: '90210' })).zip).toBeDefined();
    expect(errorsOf(valid({ zip: 'D2X 1Y4' })).zip).toBeDefined(); // D is never used
    expect(formatPostalCode('j4k2t4')).toBe('J4K 2T4');
  });

  it('phone: 10 digits, formatted on blur', () => {
    expect(errorsOf(valid({ phone: '(514) 555-0101' })).phone).toBeUndefined();
    expect(errorsOf(valid({ phone: '1-514-555-0101' })).phone).toBeUndefined();
    expect(errorsOf(valid({ phone: 'call me maybe' })).phone).toBeDefined();
    expect(errorsOf(valid({ phone: '555-0101' })).phone).toBeDefined();
    expect(formatPhone('5145550101')).toBe('514-555-0101');
    expect(formatPhone('+1 (514) 555 0101')).toBe('514-555-0101');
  });

  it('email', () => {
    expect(errorsOf(valid({ email: '' })).email).toBeUndefined();
    expect(errorsOf(valid({ email: 'a@b' })).email).toBeDefined();
  });

  it('date of birth → age 18 to 100', () => {
    expect(ageOn('2008-10-10', now)).toBe(18);
    expect(ageOn('2008-10-11', now)).toBe(17);
    expect(ageOn('2026-02-30', now)).toBeNull();
    expect(errorsOf(valid({ date_of_birth: '2008-10-11' })).date_of_birth).toMatch(/18/);
    expect(errorsOf(valid({ date_of_birth: '1920-01-01' })).date_of_birth).toBeDefined();
    expect(errorsOf(valid({ date_of_birth: '2008-10-10' })).date_of_birth).toBeUndefined();
  });

  it('vehicle year 1980 to next year + 1', () => {
    expect(errorsOf(valid({ year: '1979' })).year).toBeDefined();
    expect(errorsOf(valid({ year: '2028' })).year).toBeUndefined();
    expect(errorsOf(valid({ year: '2029' })).year).toBeDefined();
    expect(errorsOf(valid({ year: '1850' })).year).toBeDefined();
  });

  it('money: price > 0, down ≥ 0, financed > 0, income ≥ 0', () => {
    expect(errorsOf(valid({ invoice_price: '0' })).invoice_price).toBeDefined();
    expect(errorsOf(valid({ down_payment: '-1' })).down_payment).toBeDefined();
    expect(errorsOf(valid({ loan_amount: '0' })).loan_amount).toBeDefined();
    expect(errorsOf(valid({ monthly_income: '-5' })).monthly_income).toBeDefined();
    expect(errorsOf(valid({ monthly_income: '1.2.3' })).monthly_income).toBeDefined();
  });

  it('a blank amount financed uses price − down payment − trade equity', () => {
    const v = valid({ loan_amount: '', invoice_price: '30000', down_payment: '2000', has_trade_in: true, ti_value: '5000', ti_payoff: '1000' });
    expect(effectiveLoan(v)).toBe(24000);
    expect(errorsOf(v).loan_amount).toBeUndefined();
  });

  it('APR within the configured range; term from the allowed list', () => {
    expect(errorsOf(valid({ apr: '999' })).apr).toMatch(/between 4% and 24.99%/);
    expect(errorsOf(valid({ apr: '3.99' })).apr).toBeDefined();
    expect(errorsOf(valid({ apr: '' })).apr).toBeDefined();
    expect(errorsOf(valid({ term_months: '96' })).term_months).toBeDefined();
  });

  it('staff must choose the dealership', () => {
    const staff = makeDealSchema({ ...rules, requireDealer: true });
    expect(errorsOf(valid(), staff).dealer_id).toBeDefined();
    expect(errorsOf(valid({ dealer_id: 'dl1' }), staff).dealer_id).toBeUndefined();
  });

  it('builds the submit_deal payload with normalised values', () => {
    const p = toSubmitPayload(valid({ vin: '2t3p1rfv8pw123456' }), 'dealer');
    expect(p.dealer_id).toBeUndefined();
    expect(p.customer.phone).toBe('514-555-0101');
    expect(p.customer.zip).toBe('J4K 2T4');
    expect(p.vehicle.vin).toBe('2T3P1RFV8PW123456');
    expect(p.vehicle.invoice_price).toBe('32995');
    expect(p.financing).toEqual({ down_payment: '2495', loan_amount: '30500', apr: '8.99', term_months: '72' });
    expect(p.trade_in).toBeUndefined();
  });

  it('maps server "field: message" errors back onto form fields', () => {
    expect(formFieldForServerField('vin')).toBe('vin');
    expect(formFieldForServerField('customer.zip')).toBe('zip');
    expect(formFieldForServerField('postal_code')).toBe('zip');
    expect(formFieldForServerField('trade_in.vin')).toBe('ti_vin');
    expect(formFieldForServerField('financing.apr')).toBe('apr');
    expect(formFieldForServerField('nonsense')).toBeNull();
  });
});
