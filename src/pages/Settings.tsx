import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AppHeader } from '@/components/layout/AppHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/hooks/use-toast';
import { Save, Bell, Shield, Sliders, Sparkles, Plus, Trash2, Loader2, Lock } from 'lucide-react';
import {
  DEFAULT_AUTOMATIONS, fundingItemsOf, useAppSettings, useSaveSettings, type Automations, type FundingChecklistItem,
} from '@/hooks/use-autoflow';
import { useAuth } from '@/contexts/AuthContext';
import { QueryError } from '@/components/QueryError';
import { DOCUMENT_TYPE_CONFIG, type DocumentType } from '@/types/deal';
import { readPreferences } from '@/lib/preferences';
import { draftToPreferences, toDraft, type Draft } from '@/lib/settings-draft';
import { errorMessage } from '@/lib/rpc';
import type { Json } from '@/integrations/supabase/types';

const AUTOMATION_COPY: { key: keyof Automations; title: string; body: string }[] = [
  { key: 'auto_sort', title: 'Auto-sort documents', body: 'Sort every upload into its document type — from the file name when it is obvious, otherwise with one AI read.' },
  { key: 'auto_fill_income', title: 'Auto-fill income', body: 'Read pay stubs and statements and fill the income calculator (MI, YTD, Lower of) with review flags. A verifier still confirms.' },
  { key: 'auto_request_docs', title: 'Flag gaps & request from dealer', body: 'When a file is missing a required document, ask the dealer for it in their portal automatically.' },
  { key: 'auto_route', title: 'Auto-route queues', body: 'Move deals to Credit, Income and Funding as soon as each step is complete — through to Funded.' },
];

const REQUIRABLE: DocumentType[] = ['credit_application', 'id_verification', 'vehicle_invoice', 'insurance', 'bank_statement', 'income_verification', 'trade_in'];

export default function Settings() {
  const [params] = useSearchParams();
  const { isAdmin } = useAuth();
  const settingsQ = useAppSettings();
  const settings = settingsQ.data;
  const save = useSaveSettings();

  const [automations, setAutomations] = useState<Automations>(DEFAULT_AUTOMATIONS);
  const [required, setRequired] = useState<DocumentType[]>([]);
  const [fundingItems, setFundingItems] = useState<FundingChecklistItem[]>([]);
  const [draft, setDraft] = useState<Draft>(toDraft(readPreferences({})));

  useEffect(() => {
    if (!settings) return;
    setAutomations({ ...DEFAULT_AUTOMATIONS, ...(settings.automations as Partial<Automations>) });
    setRequired(settings.required_documents as DocumentType[]);
    setFundingItems(fundingItemsOf(settings));
    setDraft(toDraft(readPreferences(settings.preferences)));
  }, [settings]);

  const persist = async (patch: Parameters<typeof save.mutateAsync>[0], label = 'Settings saved') => {
    try {
      await save.mutateAsync(patch);
      toast({ title: label });
    } catch (e) {
      toast({ title: 'Could not save', description: errorMessage(e), variant: 'destructive' });
    }
  };

  const toggleAutomation = (key: keyof Automations, value: boolean) => {
    const next = { ...automations, [key]: value };
    setAutomations(next);
    persist({ automations: next as unknown as Json }, `${AUTOMATION_COPY.find((a) => a.key === key)?.title} ${value ? 'on' : 'off'}`);
  };

  const savePrefs = (label?: string) => {
    const { prefs, error } = draftToPreferences(draft, (settings?.preferences ?? {}) as Record<string, unknown>);
    if (error) { toast({ title: 'Please check the settings', description: error, variant: 'destructive' }); return; }
    persist({ preferences: prefs as unknown as Json }, label);
  };
  const t = (k: string) => String(draft[k] ?? '');
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setDraft((s) => ({ ...s, [k]: e.target.value }));
  const flag = (k: string) => draft[k] === true;
  const setFlag = (k: string) => (v: boolean) => setDraft((s) => ({ ...s, [k]: v }));

  const numField = (k: string, label: string, opts: { suffix?: string; hint?: string; width?: string } = {}) => (
    <div className="space-y-1.5">
      <Label htmlFor={`set-${k}`}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input id={`set-${k}`} inputMode="decimal" value={t(k)} onChange={set(k)} disabled={!isAdmin} className={opts.width ?? 'w-32'} />
        {opts.suffix && <span className="text-sm text-muted-foreground">{opts.suffix}</span>}
      </div>
      {opts.hint && <p className="text-xs text-muted-foreground">{opts.hint}</p>}
    </div>
  );

  const SaveButton = ({ onClick, label = 'Save changes' }: { onClick: () => void; label?: string }) => (
    <Button onClick={onClick} disabled={!isAdmin || save.isPending}>
      {save.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden /> : <Save className="h-4 w-4 mr-2" aria-hidden />}
      {label}
    </Button>
  );

  return (
    <div className="flex flex-col h-full">
      <AppHeader title="Settings" subtitle="Automations, requirements and rules" />

      <div className="flex-1 overflow-y-auto p-4 md:p-6 scrollbar-thin">
        {!isAdmin && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border p-3 text-sm text-muted-foreground">
            <Lock className="h-4 w-4" aria-hidden /> Only admins can change settings.
          </div>
        )}
        {settingsQ.isError ? (
          <QueryError what="the settings" error={settingsQ.error} onRetry={() => settingsQ.refetch()} retrying={settingsQ.isFetching} />
        ) : (
        <Tabs defaultValue={params.get('tab') ?? 'automations'} className="space-y-6">
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="automations"><Sparkles className="h-4 w-4 mr-2" aria-hidden />Automations</TabsTrigger>
            <TabsTrigger value="general"><Sliders className="h-4 w-4 mr-2" aria-hidden />Deals &amp; portal</TabsTrigger>
            <TabsTrigger value="notifications"><Bell className="h-4 w-4 mr-2" aria-hidden />Notifications</TabsTrigger>
            <TabsTrigger value="rules"><Shield className="h-4 w-4 mr-2" aria-hidden />Rules &amp; security</TabsTrigger>
          </TabsList>

          <TabsContent value="automations" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>AI automations</CardTitle>
                <CardDescription>From the dealer's submission to funding. Changes apply immediately; switching one back on re-checks every open deal.</CardDescription>
              </CardHeader>
              <CardContent className="divide-y">
                {settingsQ.isLoading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading" /> : AUTOMATION_COPY.map((a) => (
                  <div key={a.key} className="flex items-start justify-between gap-6 py-4 first:pt-0 last:pb-0">
                    <div>
                      <p className="font-medium" id={`auto-${a.key}`}>{a.title}</p>
                      <p className="text-sm text-muted-foreground max-w-2xl">{a.body}</p>
                    </div>
                    <Switch checked={automations[a.key]} onCheckedChange={(v) => toggleAutomation(a.key, v)} disabled={!isAdmin} aria-labelledby={`auto-${a.key}`} />
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Required documents</CardTitle>
                <CardDescription>
                  Every deal needs these before credit review. Proof of income is added automatically from each income source
                  (pay stubs, bank statements for self-employed, a benefit letter for pensions), and trade-in documents when there is a trade-in.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {REQUIRABLE.map((dt) => (
                    <label key={dt} className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox checked={required.includes(dt)} disabled={!isAdmin}
                        onCheckedChange={(v) => setRequired((r) => (v === true ? [...r, dt] : r.filter((x) => x !== dt)))} />
                      {DOCUMENT_TYPE_CONFIG[dt].label}
                    </label>
                  ))}
                </div>
                <SaveButton onClick={() => persist({ required_documents: required }, 'Required documents saved')} label="Save requirements" />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Funding checklist</CardTitle>
                <CardDescription>Every item must be ticked before a deal can be approved for funding.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {fundingItems.map((item, i) => (
                  <div key={item.key} className="flex items-center gap-2">
                    <Input value={item.label} disabled={!isAdmin} aria-label={`Checklist item ${i + 1}`}
                      onChange={(e) => setFundingItems((s) => s.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                    <Button variant="ghost" size="icon" disabled={!isAdmin} aria-label={`Remove “${item.label}”`}
                      onClick={() => setFundingItems((s) => s.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" aria-hidden /></Button>
                  </div>
                ))}
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" disabled={!isAdmin}
                    onClick={() => setFundingItems((s) => [...s, { key: `item_${Date.now().toString(36)}`, label: 'New item' }])}>
                    <Plus className="h-4 w-4 mr-2" aria-hidden /> Add item
                  </Button>
                  <SaveButton onClick={() => persist({ funding_checklist_items: fundingItems.filter((i) => i.label.trim()) as unknown as Json }, 'Funding checklist saved')} label="Save checklist" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>AI service</CardTitle>
                <CardDescription>All AI runs through one OpenRouter key kept on the server (Supabase secrets or the encrypted Vault), never in the browser.</CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground space-y-2">
                <p>Borrower documents only go to providers that don't keep or train on them (zero data retention). Each deal is limited to a daily number of AI reads.</p>
                <p>Documents that can't be read automatically are retried by AutoFlow; staff can always sort and enter figures by hand.</p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="general">
            <Card>
              <CardHeader>
                <CardTitle>Deals &amp; dealer portal</CardTitle>
                <CardDescription>What dealers see and what the deal form allows. The server checks the same limits.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-1.5">
                    <Label htmlFor="set-company_name">Company name</Label>
                    <Input id="set-company_name" value={t('company_name')} onChange={set('company_name')} disabled={!isAdmin} />
                    <p className="text-xs text-muted-foreground">Shown in the dealer portal and in emails.</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="set-support_email">Support email</Label>
                    <Input id="set-support_email" type="email" value={t('support_email')} onChange={set('support_email')} disabled={!isAdmin} />
                    <p className="text-xs text-muted-foreground">Shown to dealers as “Questions? …”.</p>
                  </div>
                  <div className="space-y-1.5">
                    <span className="text-sm font-medium" id="apr-range">APR range</span>
                    <div className="flex items-center gap-2" role="group" aria-labelledby="apr-range">
                      <Input inputMode="decimal" value={t('min_apr')} onChange={set('min_apr')} className="w-24" disabled={!isAdmin} aria-label="Lowest APR" />
                      <span>to</span>
                      <Input inputMode="decimal" value={t('max_apr')} onChange={set('max_apr')} className="w-24" disabled={!isAdmin} aria-label="Highest APR" />
                      <span>%</span>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="set-allowed_terms">Allowed terms (months)</Label>
                    <Input id="set-allowed_terms" value={t('allowed_terms')} onChange={set('allowed_terms')} disabled={!isAdmin} />
                  </div>
                  {numField('default_term_months', 'Default term', { suffix: 'months' })}
                </div>
                <SaveButton onClick={() => savePrefs()} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="notifications">
            <Card>
              <CardHeader>
                <CardTitle>Staff notifications</CardTitle>
                <CardDescription>Dealers are always told about document requests and status changes.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {[
                  ['notify_new', 'New deals', 'Tell admins when a dealer submits a deal'],
                  ['notify_status', 'Deals reaching a queue', 'Tell the next department when a deal reaches it'],
                  ['notify_uploads', 'Dealer answers', 'Tell staff when a dealer sends a requested document'],
                ].map(([k, title, body]) => (
                  <div key={k} className="flex items-center justify-between gap-4">
                    <div><p className="font-medium" id={`n-${k}`}>{title}</p><p className="text-sm text-muted-foreground">{body}</p></div>
                    <Switch checked={flag(k)} onCheckedChange={setFlag(k)} disabled={!isAdmin} aria-labelledby={`n-${k}`} />
                  </div>
                ))}
                <div className="space-y-1.5">
                  <Label htmlFor="set-stale_days">Flag deals stuck in a stage after</Label>
                  <Select value={t('stale_days')} onValueChange={(v) => setDraft((s) => ({ ...s, stale_days: v }))} disabled={!isAdmin}>
                    <SelectTrigger id="set-stale_days" className="w-32"><SelectValue /></SelectTrigger>
                    <SelectContent>{['1', '2', '3', '5', '7', '14'].map((d) => <SelectItem key={d} value={d}>{d} days</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <SaveButton onClick={() => savePrefs('Notifications saved')} label="Save notifications" />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="rules">
            <Card>
              <CardHeader>
                <CardTitle>Underwriting rules</CardTitle>
                <CardDescription>Guidelines shown to analysts and the funding team, and the policy AutoFlow applies.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                  {numField('max_dti', 'Maximum debt-to-income', { suffix: '%' })}
                  {numField('max_pti', 'Maximum payment-to-income', { suffix: '%' })}
                  {numField('funding_approval_limit', 'Warn when funding above', { suffix: '$', width: 'w-36', hint: 'Leave empty for no warning.' })}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {numField('min_score_auto', 'Fast-track at or above')}
                  {numField('min_score_review', 'Manual review below')}
                  {numField('min_score_decline', 'Decline below')}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {numField('ltv_new', 'LTV limit, new', { suffix: '%' })}
                  {numField('ltv_used', 'LTV limit, used', { suffix: '%' })}
                  {numField('manager_above', 'Manager approval above', { suffix: '$', width: 'w-36' })}
                </div>
                <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
                  <div>
                    <p className="font-medium" id="r-vfw">Decline vehicles used for work</p>
                    <p className="text-sm text-muted-foreground">Rideshare or commercial use is declined automatically when an income source says so.</p>
                  </div>
                  <Switch checked={flag('decline_vehicle_for_work')} onCheckedChange={setFlag('decline_vehicle_for_work')} disabled={!isAdmin} aria-labelledby="r-vfw" />
                </div>
                <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
                  <div>
                    <p className="font-medium" id="r-mfa">Require two-step sign-in for staff</p>
                    <p className="text-sm text-muted-foreground">Staff must confirm a code from an authenticator app to see borrower files.</p>
                  </div>
                  <Switch checked={flag('require_staff_mfa')} onCheckedChange={setFlag('require_staff_mfa')} disabled aria-labelledby="r-mfa" />
                </div>
                <SaveButton onClick={() => savePrefs('Rules saved')} label="Save rules" />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
        )}
      </div>
    </div>
  );
}
