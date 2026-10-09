import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Send, User, Briefcase, Car, Calculator, ArrowLeftRight, FileUp } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DocumentUpload } from './DocumentUpload';
import { supabase } from '@/integrations/supabase/client';
import { useDealers } from '@/hooks/use-deals';
import { uploadDealDocuments, type PendingUpload } from '@/lib/uploads';
import { toast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';

const INCOME_TYPES: { value: string; label: string }[] = [
  { value: 'salaried', label: 'Employed (salary / hourly)' },
  { value: 'part_time', label: 'Part-time' },
  { value: 'self_employed', label: 'Self-employed' },
  { value: 'contractor', label: 'Contractor' },
  { value: 'seasonal', label: 'Seasonal' },
  { value: 'education', label: 'Education sector' },
  { value: 'pension', label: 'Pension / retired' },
  { value: 'government_assistance', label: 'Government assistance' },
];

type Form = Record<string, string>;

const initial: Form = {
  dealer_id: '', first_name: '', last_name: '', email: '', phone: '', date_of_birth: '', street: '', city: '', state: 'QC', zip: '',
  income_type: 'salaried', employer: '', job_title: '', monthly_income: '', years_employed: '',
  year: String(new Date().getFullYear()), make: '', model: '', trim: '', vin: '', mileage: '', condition: 'used', color: '', invoice_price: '', msrp: '',
  down_payment: '0', loan_amount: '', apr: '', term_months: '72',
  ti_year: '', ti_make: '', ti_model: '', ti_vin: '', ti_mileage: '', ti_value: '', ti_payoff: '',
};

function payment(principal: number, aprPct: number, months: number) {
  if (!(principal > 0) || !(months > 0)) return null;
  const r = aprPct / 100 / 12;
  return r === 0 ? principal / months : (principal * r) / (1 - Math.pow(1 + r, -months));
}

const money = (n: number) => n.toLocaleString('en-CA', { style: 'currency', currency: 'CAD' });

/** One form for both the dealer portal and staff ("New deal"). */
export function DealSubmissionForm({ mode }: { mode: 'dealer' | 'staff' }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: dealers = [] } = useDealers();
  const [f, setF] = useState<Form>(initial);
  const [tradeIn, setTradeIn] = useState(false);
  const [files, setFiles] = useState<PendingUpload[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  const num = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setF((s) => ({ ...s, [k]: e.target.value.replace(/[^\d.]/g, '') }));

  const price = parseFloat(f.invoice_price) || 0;
  const down = parseFloat(f.down_payment) || 0;
  const tradeCredit = tradeIn ? (parseFloat(f.ti_value) || 0) - (parseFloat(f.ti_payoff) || 0) : 0;
  const suggestedLoan = Math.max(price - down - Math.max(tradeCredit, 0), 0);
  const loan = f.loan_amount ? parseFloat(f.loan_amount) || 0 : suggestedLoan;
  const monthly = useMemo(() => payment(loan, parseFloat(f.apr) || 0, parseInt(f.term_months) || 0), [loan, f.apr, f.term_months]);

  const missing = [
    !f.first_name.trim() && 'customer first name',
    !f.last_name.trim() && 'customer last name',
    !f.make.trim() && 'vehicle make',
    !f.model.trim() && 'vehicle model',
    !(price > 0) && 'selling price',
    !(loan > 0) && 'loan amount',
    mode === 'staff' && !f.dealer_id && 'dealer',
  ].filter(Boolean) as string[];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (missing.length) {
      toast({ title: 'A few details are missing', description: missing.join(', '), variant: 'destructive' });
      return;
    }
    setBusy('Submitting deal…');
    try {
      const payload = {
        dealer_id: mode === 'staff' ? f.dealer_id : undefined,
        customer: {
          first_name: f.first_name.trim(), last_name: f.last_name.trim(), email: f.email.trim(), phone: f.phone.trim(),
          date_of_birth: f.date_of_birth, street: f.street, city: f.city, state: f.state, zip: f.zip,
        },
        employment: {
          income_type: f.income_type, employer: f.employer.trim(), job_title: f.job_title.trim(),
          monthly_income: f.monthly_income, years_employed: f.years_employed,
        },
        vehicle: {
          year: f.year, make: f.make.trim(), model: f.model.trim(), trim: f.trim, vin: f.vin.trim().toUpperCase(),
          mileage: f.mileage, condition: f.condition, color: f.color, invoice_price: f.invoice_price, msrp: f.msrp,
        },
        financing: { down_payment: String(down), loan_amount: String(loan), apr: f.apr || '0', term_months: f.term_months },
        trade_in: tradeIn ? {
          year: f.ti_year, make: f.ti_make, model: f.ti_model, vin: f.ti_vin.trim().toUpperCase(), mileage: f.ti_mileage,
          value: f.ti_value, payoff: f.ti_payoff,
        } : undefined,
      };
      const { data: dealId, error } = await supabase.rpc('submit_deal', { _payload: payload });
      if (error) throw error;

      if (files.length) {
        setBusy(`Uploading ${files.length} document${files.length === 1 ? '' : 's'}…`);
        const result = await uploadDealDocuments(dealId as string, files, undefined, { logTimeline: mode === 'staff' });
        if (result.failed.length) {
          toast({ title: `${result.failed.length} file(s) could not be uploaded`, description: 'You can add them from the deal page.', variant: 'destructive' });
        }
      }
      qc.invalidateQueries({ queryKey: ['deals'] });
      toast({
        title: 'Deal submitted',
        description: files.length ? 'AutoFlow is sorting the documents and will ask for anything missing.' : 'Add documents from the deal page.',
      });
      navigate(mode === 'dealer' ? `/portal/deals/${dealId}` : `/deals/${dealId}`);
    } catch (err) {
      toast({ title: 'Could not submit the deal', description: err instanceof Error ? err.message : String((err as { message?: string })?.message ?? err), variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const field = (k: string, label: string, opts: { type?: string; numeric?: boolean; placeholder?: string; required?: boolean } = {}) => (
    <div className="space-y-1.5">
      <Label htmlFor={k}>{label}{opts.required && <span className="text-destructive"> *</span>}</Label>
      <Input id={k} type={opts.type ?? 'text'} inputMode={opts.numeric ? 'decimal' : undefined} value={f[k]}
        onChange={opts.numeric ? num(k) : set(k)} placeholder={opts.placeholder} />
    </div>
  );

  return (
    <form onSubmit={submit} className="space-y-4 max-w-4xl">
      {mode === 'staff' && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Dealer</CardTitle></CardHeader>
          <CardContent>
            <Select value={f.dealer_id} onValueChange={(v) => setF((s) => ({ ...s, dealer_id: v }))}>
              <SelectTrigger className="max-w-sm"><SelectValue placeholder="Choose the dealership" /></SelectTrigger>
              <SelectContent>
                {dealers.filter((d) => d.status !== 'suspended').map((d) => <SelectItem key={d.id} value={d.id}>{d.name} ({d.code})</SelectItem>)}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><User className="h-4 w-4" /> Customer</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {field('first_name', 'First name', { required: true })}
          {field('last_name', 'Last name', { required: true })}
          {field('email', 'Email', { type: 'email' })}
          {field('phone', 'Phone', { type: 'tel' })}
          {field('date_of_birth', 'Date of birth', { type: 'date' })}
          {field('street', 'Street address')}
          {field('city', 'City')}
          <div className="grid grid-cols-2 gap-3">
            {field('state', 'Province')}
            {field('zip', 'Postal code')}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Briefcase className="h-4 w-4" /> Employment &amp; income</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Income type</Label>
            <Select value={f.income_type} onValueChange={(v) => setF((s) => ({ ...s, income_type: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{INCOME_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {field('employer', 'Employer')}
          {field('job_title', 'Job title')}
          {field('monthly_income', 'Stated gross monthly income ($)', { numeric: true })}
          {field('years_employed', 'Years with employer', { numeric: true })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Car className="h-4 w-4" /> Vehicle</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {field('year', 'Year', { numeric: true })}
          {field('make', 'Make', { required: true })}
          {field('model', 'Model', { required: true })}
          {field('trim', 'Trim')}
          <div className="col-span-2">{field('vin', 'VIN')}</div>
          {field('mileage', 'Odometer (km)', { numeric: true })}
          <div className="space-y-1.5">
            <Label>Condition</Label>
            <Select value={f.condition} onValueChange={(v) => setF((s) => ({ ...s, condition: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="new">New</SelectItem>
                <SelectItem value="used">Used</SelectItem>
                <SelectItem value="certified">Certified pre-owned</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {field('color', 'Colour')}
          {field('invoice_price', 'Selling price ($)', { numeric: true, required: true })}
          {field('msrp', 'MSRP ($)', { numeric: true })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base"><ArrowLeftRight className="h-4 w-4" /> Trade-in</CardTitle>
            <div className="flex items-center gap-2 text-sm"><Switch checked={tradeIn} onCheckedChange={setTradeIn} id="tradein" /><Label htmlFor="tradein">Customer has a trade-in</Label></div>
          </div>
        </CardHeader>
        {tradeIn && (
          <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {field('ti_year', 'Year', { numeric: true })}
            {field('ti_make', 'Make')}
            {field('ti_model', 'Model')}
            {field('ti_mileage', 'Odometer (km)', { numeric: true })}
            <div className="col-span-2">{field('ti_vin', 'VIN')}</div>
            {field('ti_value', 'Trade value ($)', { numeric: true })}
            {field('ti_payoff', 'Lien payoff ($)', { numeric: true })}
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Calculator className="h-4 w-4" /> Financing</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {field('down_payment', 'Down payment ($)', { numeric: true })}
            <div className="space-y-1.5">
              <Label htmlFor="loan_amount">Amount financed ($)</Label>
              <Input id="loan_amount" inputMode="decimal" value={f.loan_amount} onChange={num('loan_amount')}
                placeholder={suggestedLoan ? suggestedLoan.toFixed(2) : ''} />
            </div>
            {field('apr', 'Rate (APR %)', { numeric: true, placeholder: 'e.g. 8.99' })}
            <div className="space-y-1.5">
              <Label>Term</Label>
              <Select value={f.term_months} onValueChange={(v) => setF((s) => ({ ...s, term_months: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{[36, 48, 60, 72, 84, 96].map((m) => <SelectItem key={m} value={String(m)}>{m} months</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm rounded-lg bg-muted/60 px-3 py-2">
            <span>Financed: <strong>{money(loan)}</strong></span>
            {monthly != null && <span>Payment: <strong>{money(monthly)}</strong>/mo</span>}
            {price > 0 && <span>LTV: <strong>{((loan / price) * 100).toFixed(1)}%</strong></span>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><FileUp className="h-4 w-4" /> Documents</CardTitle>
          <CardDescription>
            Add everything you have — credit application, ID, pay stubs, bank statements, bill of sale, insurance.
            You don't need to name them; AutoFlow sorts them and tells you if anything is missing.
          </CardDescription>
        </CardHeader>
        <CardContent><DocumentUpload onChange={setFiles} /></CardContent>
      </Card>

      <div className="flex items-center justify-end gap-3 pb-6">
        {missing.length > 0 && <p className="text-xs text-muted-foreground">Still needed: {missing.join(', ')}</p>}
        <Button type="submit" size="lg" disabled={!!busy}>
          {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
          {busy ?? 'Submit deal'}
        </Button>
      </div>
    </form>
  );
}
