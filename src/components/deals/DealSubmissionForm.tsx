import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Controller, useForm, type FieldErrors, type FieldPath } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Send, User, Briefcase, Car, Calculator, ArrowLeftRight, FileUp, AlertTriangle } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DocumentUpload } from './DocumentUpload';
import { useDealers } from '@/hooks/use-deals';
import { usePreferences } from '@/hooks/use-autoflow';
import { uploadDealDocuments, type PendingUpload } from '@/lib/uploads';
import { callRpc, errorMessage, parseFieldError } from '@/lib/rpc';
import {
  FIELD_LABELS, INCOME_TYPES, defaultDealValues, effectiveLoan, formFieldForServerField, formatPhone, formatPostalCode,
  makeDealSchema, normalizeVin, suggestedLoan, toSubmitPayload, type DealFormValues,
} from '@/lib/deal-schema';
import { parseAmount } from '@/lib/income-math';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

function payment(principal: number, aprPct: number, months: number) {
  if (!(principal > 0) || !(months > 0)) return null;
  const r = aprPct / 100 / 12;
  return r === 0 ? principal / months : (principal * r) / (1 - Math.pow(1 + r, -months));
}

const money = (n: number) => n.toLocaleString('en-CA', { style: 'currency', currency: 'CAD' });
const amount = (s: string) => {
  const n = parseAmount(s ?? '');
  return Number.isFinite(n) ? n : 0;
};

type Field = FieldPath<DealFormValues>;

/** One form for both the dealer portal and staff ("New deal"). Validated here and again on the server. */
export function DealSubmissionForm({ mode }: { mode: 'dealer' | 'staff' }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: dealers = [] } = useDealers();
  const { prefs } = usePreferences();
  const [files, setFiles] = useState<PendingUpload[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const rules = useMemo(() => ({
    minApr: prefs.min_apr, maxApr: prefs.max_apr, allowedTerms: prefs.allowed_terms, requireDealer: mode === 'staff',
  }), [prefs.min_apr, prefs.max_apr, prefs.allowed_terms, mode]);
  const schema = useMemo(() => makeDealSchema(rules), [rules]);

  const form = useForm<DealFormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaultDealValues(prefs.default_term_months),
    mode: 'onTouched',
  });
  const { register, control, handleSubmit, watch, setValue, setError, getFieldState, formState: { errors, isSubmitted } } = form;

  // settings arrive after the first render: use the configured default term unless one was chosen
  useEffect(() => {
    if (!getFieldState('term_months').isDirty) setValue('term_months', String(prefs.default_term_months));
  }, [prefs.default_term_months, getFieldState, setValue]);

  const v = watch();
  const loan = effectiveLoan(v);
  const price = amount(v.invoice_price);
  const monthly = payment(loan, amount(v.apr), Number(v.term_months) || 0);
  const highLtv = price > 0 && loan > price * 1.5;

  const onSubmit = async (values: DealFormValues) => {
    setBusy('Submitting deal…');
    try {
      const dealId = await callRpc<string>('submit_deal', { _payload: toSubmitPayload(values, mode) });
      if (files.length) {
        setBusy(`Uploading ${files.length} document${files.length === 1 ? '' : 's'}…`);
        const result = await uploadDealDocuments(dealId, files, undefined, { logTimeline: mode === 'staff' });
        if (result.failed.length) {
          toast({ title: `${result.failed.length} file(s) could not be uploaded`,
                  description: result.failed.map((f) => `${f.name}: ${f.error}`).join('\n'), variant: 'destructive' });
        }
        if (result.notStarted.length) {
          toast({ title: 'Uploaded, but automatic reading didn\'t start', description: 'Open the deal and press Retry on the documents.' });
        }
      }
      qc.invalidateQueries({ queryKey: ['deals'] });
      toast({
        title: 'Deal submitted',
        description: files.length ? 'AutoFlow is sorting the documents and will ask for anything missing.' : 'Add documents from the deal page.',
      });
      navigate(mode === 'dealer' ? `/portal/deals/${dealId}` : `/deals/${dealId}`);
    } catch (err) {
      const msg = errorMessage(err);
      const fe = parseFieldError(msg);
      const field = fe ? formFieldForServerField(fe.field) : null;
      if (fe && field) {
        setError(field, { type: 'server', message: fe.message.charAt(0).toUpperCase() + fe.message.slice(1) }, { shouldFocus: true });
        toast({ title: 'Please check the form', description: `${FIELD_LABELS[field]}: ${fe.message}`, variant: 'destructive' });
      } else {
        toast({ title: 'Could not submit the deal', description: msg, variant: 'destructive' });
      }
    } finally {
      setBusy(null);
    }
  };

  const onInvalid = (errs: FieldErrors<DealFormValues>) => {
    const first = Object.keys(errs)[0] as Field | undefined;
    if (first) document.getElementById(first)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const err = (k: Field) => (errors as Record<string, { message?: string } | undefined>)[k]?.message;

  const field = (k: Field, label: string, opts: { type?: string; numeric?: boolean; placeholder?: string; required?: boolean;
    onBlurFormat?: (s: string) => string; className?: string } = {}) => (
    <div className={cn('space-y-1.5', opts.className)}>
      <Label htmlFor={k}>{label}{opts.required && <span className="text-destructive" aria-hidden> *</span>}</Label>
      <Input
        id={k}
        type={opts.type ?? 'text'}
        inputMode={opts.numeric ? 'decimal' : undefined}
        placeholder={opts.placeholder}
        autoComplete="off"
        aria-invalid={!!err(k)}
        aria-required={opts.required || undefined}
        aria-describedby={err(k) ? `${k}-error` : undefined}
        className={cn(err(k) && 'border-destructive focus-visible:ring-destructive')}
        {...register(k, opts.onBlurFormat ? {
          onBlur: (e) => {
            const formatted = opts.onBlurFormat!(e.target.value);
            if (formatted !== e.target.value) setValue(k, formatted as never, { shouldValidate: true });
          },
        } : undefined)}
      />
      {err(k) && <p id={`${k}-error`} className="text-xs text-destructive">{err(k)}</p>}
    </div>
  );

  const errorList = Object.keys(errors) as Field[];

  return (
    <form onSubmit={handleSubmit(onSubmit, onInvalid)} className="space-y-4 max-w-4xl" noValidate>
      {mode === 'staff' && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Dealer</CardTitle></CardHeader>
          <CardContent className="space-y-1.5">
            <Label htmlFor="dealer_id">Dealership <span className="text-destructive" aria-hidden>*</span></Label>
            <Controller control={control} name="dealer_id" render={({ field: f }) => (
              <Select value={f.value} onValueChange={f.onChange}>
                <SelectTrigger id="dealer_id" className={cn('max-w-sm', err('dealer_id') && 'border-destructive')} aria-invalid={!!err('dealer_id')}>
                  <SelectValue placeholder="Choose the dealership" />
                </SelectTrigger>
                <SelectContent>
                  {dealers.filter((d) => d.status !== 'suspended').map((d) => <SelectItem key={d.id} value={d.id}>{d.name} ({d.code})</SelectItem>)}
                </SelectContent>
              </Select>
            )} />
            {err('dealer_id') && <p className="text-xs text-destructive">{err('dealer_id')}</p>}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><User className="h-4 w-4" aria-hidden /> Customer</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {field('first_name', 'First name', { required: true })}
          {field('last_name', 'Last name', { required: true })}
          {field('email', 'Email', { type: 'email', onBlurFormat: (s) => s.trim() })}
          {field('phone', 'Phone', { type: 'tel', placeholder: '514-555-0123', onBlurFormat: formatPhone })}
          {field('date_of_birth', 'Date of birth', { type: 'date' })}
          {field('street', 'Street address')}
          {field('city', 'City')}
          <div className="grid grid-cols-2 gap-3">
            {field('state', 'Province')}
            {field('zip', 'Postal code', { placeholder: 'A1A 1A1', onBlurFormat: formatPostalCode })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Briefcase className="h-4 w-4" aria-hidden /> Employment &amp; income</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="income_type">Income type</Label>
            <Controller control={control} name="income_type" render={({ field: f }) => (
              <Select value={f.value} onValueChange={f.onChange}>
                <SelectTrigger id="income_type"><SelectValue /></SelectTrigger>
                <SelectContent>{INCOME_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
            )} />
          </div>
          {field('employer', 'Employer')}
          {field('job_title', 'Job title')}
          {field('monthly_income', 'Stated gross monthly income ($)', { numeric: true })}
          {field('years_employed', 'Years with employer', { numeric: true })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Car className="h-4 w-4" aria-hidden /> Vehicle</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {field('year', 'Year', { numeric: true, required: true })}
          {field('make', 'Make', { required: true })}
          {field('model', 'Model', { required: true })}
          {field('trim', 'Trim')}
          {field('vin', 'VIN', { className: 'col-span-2', placeholder: '17 characters', onBlurFormat: normalizeVin })}
          {field('mileage', 'Odometer (km)', { numeric: true })}
          <div className="space-y-1.5">
            <Label htmlFor="condition">Condition</Label>
            <Controller control={control} name="condition" render={({ field: f }) => (
              <Select value={f.value} onValueChange={f.onChange}>
                <SelectTrigger id="condition"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">New</SelectItem>
                  <SelectItem value="used">Used</SelectItem>
                  <SelectItem value="certified">Certified pre-owned</SelectItem>
                </SelectContent>
              </Select>
            )} />
          </div>
          {field('color', 'Colour')}
          {field('invoice_price', 'Selling price ($)', { numeric: true, required: true })}
          {field('msrp', 'MSRP ($)', { numeric: true })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-base"><ArrowLeftRight className="h-4 w-4" aria-hidden /> Trade-in</CardTitle>
            <div className="flex items-center gap-2 text-sm">
              <Controller control={control} name="has_trade_in" render={({ field: f }) => (
                <Switch id="has_trade_in" checked={f.value} onCheckedChange={f.onChange} />
              )} />
              <Label htmlFor="has_trade_in">Customer has a trade-in</Label>
            </div>
          </div>
        </CardHeader>
        {v.has_trade_in && (
          <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {field('ti_year', 'Year', { numeric: true })}
            {field('ti_make', 'Make')}
            {field('ti_model', 'Model')}
            {field('ti_mileage', 'Odometer (km)', { numeric: true })}
            {field('ti_vin', 'VIN', { className: 'col-span-2', onBlurFormat: normalizeVin })}
            {field('ti_value', 'Trade value ($)', { numeric: true })}
            {field('ti_payoff', 'Lien payoff ($)', { numeric: true })}
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Calculator className="h-4 w-4" aria-hidden /> Financing</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {field('down_payment', 'Down payment ($)', { numeric: true })}
            {field('loan_amount', 'Amount financed ($)', { numeric: true, placeholder: suggestedLoan(v) ? suggestedLoan(v).toFixed(2) : '' })}
            {field('apr', `Rate (APR %) · ${prefs.min_apr}–${prefs.max_apr}`, { numeric: true, required: true, placeholder: 'e.g. 8.99' })}
            <div className="space-y-1.5">
              <Label htmlFor="term_months">Term</Label>
              <Controller control={control} name="term_months" render={({ field: f }) => (
                <Select value={f.value} onValueChange={f.onChange}>
                  <SelectTrigger id="term_months" className={cn(err('term_months') && 'border-destructive')}><SelectValue /></SelectTrigger>
                  <SelectContent>{prefs.allowed_terms.map((m) => <SelectItem key={m} value={String(m)}>{m} months</SelectItem>)}</SelectContent>
                </Select>
              )} />
              {err('term_months') && <p className="text-xs text-destructive">{err('term_months')}</p>}
            </div>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm rounded-lg bg-muted/60 px-3 py-2" aria-live="polite">
            <span>Financed: <strong>{money(loan || 0)}</strong></span>
            {monthly != null && <span>Payment: <strong>{money(monthly)}</strong>/mo</span>}
            {price > 0 && <span>LTV: <strong>{((loan / price) * 100).toFixed(1)}%</strong></span>}
          </div>
          {highLtv && (
            <p className="flex items-center gap-2 text-sm text-warning"><AlertTriangle className="h-4 w-4" aria-hidden />
              The amount financed is more than 150% of the selling price — double-check it.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><FileUp className="h-4 w-4" aria-hidden /> Documents</CardTitle>
          <CardDescription>
            Add everything you have — credit application, ID, pay stubs, bank statements, bill of sale, insurance.
            You don't need to name them; AutoFlow sorts them and tells you if anything is missing.
          </CardDescription>
        </CardHeader>
        <CardContent><DocumentUpload onChange={setFiles} /></CardContent>
      </Card>

      {isSubmitted && errorList.length > 0 && (
        <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <p className="font-medium text-destructive">Please fix {errorList.length === 1 ? 'this field' : `these ${errorList.length} fields`}:</p>
          <ul className="mt-1 list-disc pl-5">
            {errorList.map((k) => (
              <li key={k}>
                <button type="button" className="underline-offset-2 hover:underline" onClick={() => form.setFocus(k)}>
                  {FIELD_LABELS[k as keyof typeof FIELD_LABELS] ?? k}
                </button>: {err(k)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center justify-end gap-3 pb-6">
        <Button type="submit" size="lg" disabled={!!busy} className="w-full sm:w-auto">
          {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden /> : <Send className="h-4 w-4 mr-2" aria-hidden />}
          {busy ?? 'Submit deal'}
        </Button>
      </div>
    </form>
  );
}
