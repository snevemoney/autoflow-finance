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
import { DOCUMENT_TYPE_CONFIG, type DocumentType } from '@/types/deal';
import type { Json } from '@/integrations/supabase/types';

type Prefs = Record<string, string | boolean>;

const DEFAULT_PREFS: Prefs = {
  company_name: 'AutoFlow', support_email: '', apr_min: '4.0', apr_max: '18.0', terms: '36, 48, 60, 72, 84',
  notify_new: true, notify_status: true, notify_uploads: true, notify_stale: true, stale_days: '3',
  min_score_auto: '720', min_score_review: '620', min_score_decline: '550', ltv_new: '120', ltv_used: '110',
  approval_limit: '50000', manager_above: '75000',
};

const AUTOMATION_COPY: { key: keyof Automations; title: string; body: string }[] = [
  { key: 'auto_sort', title: 'Auto-sort documents', body: 'Sort every upload into its document type — from the file name when it is obvious, otherwise with one AI read.' },
  { key: 'auto_fill_income', title: 'Auto-fill income', body: 'Read pay stubs and statements and fill the income calculator (MI, YTD, Lower of) with review flags. An analyst still verifies.' },
  { key: 'auto_request_docs', title: 'Flag gaps & request from dealer', body: 'When a submission is missing a required document, ask the dealer for it in their portal automatically.' },
  { key: 'auto_route', title: 'Auto-route queues', body: 'Move deals to Credit, Income and Funding as soon as each step is complete — through to Funded.' },
];

const REQUIRABLE: DocumentType[] = ['credit_application', 'id_verification', 'vehicle_invoice', 'insurance', 'bank_statement', 'income_verification', 'trade_in'];

export default function Settings() {
  const [params] = useSearchParams();
  const { isAdmin } = useAuth();
  const { data: settings, isLoading } = useAppSettings();
  const save = useSaveSettings();

  const [automations, setAutomations] = useState<Automations>(DEFAULT_AUTOMATIONS);
  const [required, setRequired] = useState<DocumentType[]>([]);
  const [fundingItems, setFundingItems] = useState<FundingChecklistItem[]>([]);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);

  useEffect(() => {
    if (!settings) return;
    setAutomations({ ...DEFAULT_AUTOMATIONS, ...(settings.automations as Partial<Automations>) });
    setRequired(settings.required_documents as DocumentType[]);
    setFundingItems(fundingItemsOf(settings));
    setPrefs({ ...DEFAULT_PREFS, ...((settings.preferences ?? {}) as Prefs) });
  }, [settings]);

  const persist = async (patch: Parameters<typeof save.mutateAsync>[0], label = 'Settings saved') => {
    try {
      await save.mutateAsync(patch);
      toast({ title: label });
    } catch (e) {
      toast({ title: 'Could not save', description: e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e), variant: 'destructive' });
    }
  };

  const toggleAutomation = (key: keyof Automations, value: boolean) => {
    const next = { ...automations, [key]: value };
    setAutomations(next);
    persist({ automations: next as unknown as Json }, `${AUTOMATION_COPY.find((a) => a.key === key)?.title} ${value ? 'on' : 'off'}`);
  };

  const savePrefs = () => persist({ preferences: prefs as unknown as Json });
  const p = (k: string) => String(prefs[k] ?? '');
  const setP = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setPrefs((s) => ({ ...s, [k]: e.target.value }));
  const bool = (k: string) => prefs[k] === true;

  const SaveButton = ({ onClick, label = 'Save Changes' }: { onClick: () => void; label?: string }) => (
    <Button onClick={onClick} disabled={!isAdmin || save.isPending}>
      {save.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
      {label}
    </Button>
  );

  return (
    <div className="flex flex-col h-full">
      <AppHeader title="Settings" subtitle="Automations, requirements and preferences" />

      <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
        {!isAdmin && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border p-3 text-sm text-muted-foreground">
            <Lock className="h-4 w-4" /> Only admins can change settings.
          </div>
        )}
        <Tabs defaultValue={params.get('tab') ?? 'automations'} className="space-y-6">
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="automations"><Sparkles className="h-4 w-4 mr-2" />Automations</TabsTrigger>
            <TabsTrigger value="general"><Sliders className="h-4 w-4 mr-2" />General</TabsTrigger>
            <TabsTrigger value="notifications"><Bell className="h-4 w-4 mr-2" />Notifications</TabsTrigger>
            <TabsTrigger value="rules"><Shield className="h-4 w-4 mr-2" />Business Rules</TabsTrigger>
          </TabsList>

          <TabsContent value="automations" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>AI automations</CardTitle>
                <CardDescription>From the dealer's submission to funding. Changes apply immediately.</CardDescription>
              </CardHeader>
              <CardContent className="divide-y">
                {isLoading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : AUTOMATION_COPY.map((a) => (
                  <div key={a.key} className="flex items-start justify-between gap-6 py-4 first:pt-0 last:pb-0">
                    <div>
                      <p className="font-medium">{a.title}</p>
                      <p className="text-sm text-muted-foreground max-w-2xl">{a.body}</p>
                    </div>
                    <Switch checked={automations[a.key]} onCheckedChange={(v) => toggleAutomation(a.key, v)} disabled={!isAdmin} aria-label={a.title} />
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Required documents</CardTitle>
                <CardDescription>
                  Every deal needs these before credit review. Proof of income is added automatically from the
                  applicant's income type (pay stub, bank statements for self-employed, benefit letter for pensions).
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {REQUIRABLE.map((t) => (
                    <label key={t} className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox checked={required.includes(t)} disabled={!isAdmin}
                        onCheckedChange={(v) => setRequired((r) => (v === true ? [...r, t] : r.filter((x) => x !== t)))} />
                      {DOCUMENT_TYPE_CONFIG[t].label}
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
                    <Input value={item.label} disabled={!isAdmin}
                      onChange={(e) => setFundingItems((s) => s.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                    <Button variant="ghost" size="icon" disabled={!isAdmin} aria-label="Remove item"
                      onClick={() => setFundingItems((s) => s.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                ))}
                <div className="flex gap-2">
                  <Button variant="outline" disabled={!isAdmin}
                    onClick={() => setFundingItems((s) => [...s, { key: `item_${Date.now().toString(36)}`, label: 'New item' }])}>
                    <Plus className="h-4 w-4 mr-2" /> Add item
                  </Button>
                  <SaveButton onClick={() => persist({ funding_checklist_items: fundingItems.filter((i) => i.label.trim()) as unknown as Json }, 'Funding checklist saved')} label="Save checklist" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>AI service</CardTitle>
                <CardDescription>All AI runs through one OpenRouter key, kept on the server in Supabase (an edge-function secret or the encrypted Vault), never in the browser.</CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground space-y-2">
                <p><span className="font-mono text-foreground">OPENROUTER_API_KEY</span> — required.</p>
                <p><span className="font-mono text-foreground">AI_MODELS</span> — model chain, tried in order (free models first).</p>
                <p><span className="font-mono text-foreground">AI_ESCALATION_MODELS</span> — re-reads documents the first pass was unsure about.</p>
                <p><span className="font-mono text-foreground">AI_DATA_COLLECTION=deny</span> — only use providers that don't keep data (recommended for live borrower files).</p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="general">
            <Card>
              <CardHeader>
                <CardTitle>General Settings</CardTitle>
                <CardDescription>Basic preferences</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2"><Label>Company Name</Label><Input value={p('company_name')} onChange={setP('company_name')} disabled={!isAdmin} /></div>
                  <div className="space-y-2"><Label>Support Email</Label><Input type="email" value={p('support_email')} onChange={setP('support_email')} disabled={!isAdmin} /></div>
                  <div className="space-y-2">
                    <Label>Default APR Range</Label>
                    <div className="flex items-center gap-2">
                      <Input inputMode="decimal" value={p('apr_min')} onChange={setP('apr_min')} className="w-24" disabled={!isAdmin} />
                      <span>to</span>
                      <Input inputMode="decimal" value={p('apr_max')} onChange={setP('apr_max')} className="w-24" disabled={!isAdmin} />
                      <span>%</span>
                    </div>
                  </div>
                  <div className="space-y-2"><Label>Default Term Options</Label><Input value={p('terms')} onChange={setP('terms')} disabled={!isAdmin} /></div>
                </div>
                <SaveButton onClick={savePrefs} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="notifications">
            <Card>
              <CardHeader>
                <CardTitle>Notification Preferences</CardTitle>
                <CardDescription>Staff notifications (dealers are always told about requests and status changes)</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {[
                  ['notify_new', 'New Deal Submissions', 'Notify admins when a dealer submits a deal'],
                  ['notify_status', 'Deal Status Changes', 'Notify the next department when a deal reaches its queue'],
                  ['notify_uploads', 'Document Uploads', 'Notify staff when a dealer answers a document request'],
                ].map(([k, title, body]) => (
                  <div key={k} className="flex items-center justify-between">
                    <div><p className="font-medium">{title}</p><p className="text-sm text-muted-foreground">{body}</p></div>
                    <Switch checked={bool(k)} onCheckedChange={(v) => setPrefs((s) => ({ ...s, [k]: v }))} disabled={!isAdmin} />
                  </div>
                ))}
                <div className="space-y-2">
                  <Label>Flag deals stuck in a stage after</Label>
                  <Select value={p('stale_days')} onValueChange={(v) => setPrefs((s) => ({ ...s, stale_days: v }))} disabled={!isAdmin}>
                    <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                    <SelectContent>{['1', '2', '3', '5', '7'].map((d) => <SelectItem key={d} value={d}>{d} days</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <SaveButton onClick={savePrefs} label="Save Preferences" />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="rules">
            <Card>
              <CardHeader>
                <CardTitle>Business Rules</CardTitle>
                <CardDescription>Guidelines shown to analysts during credit and funding review</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-4">
                  <h3 className="font-semibold">Credit Score Thresholds</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-2"><Label>Fast-track at or above</Label><Input inputMode="numeric" value={p('min_score_auto')} onChange={setP('min_score_auto')} disabled={!isAdmin} /></div>
                    <div className="space-y-2"><Label>Manual review below</Label><Input inputMode="numeric" value={p('min_score_review')} onChange={setP('min_score_review')} disabled={!isAdmin} /></div>
                    <div className="space-y-2"><Label>Decline below</Label><Input inputMode="numeric" value={p('min_score_decline')} onChange={setP('min_score_decline')} disabled={!isAdmin} /></div>
                  </div>
                </div>
                <div className="space-y-4">
                  <h3 className="font-semibold">LTV Limits (%)</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2"><Label>New vehicles</Label><Input inputMode="numeric" value={p('ltv_new')} onChange={setP('ltv_new')} disabled={!isAdmin} /></div>
                    <div className="space-y-2"><Label>Used vehicles</Label><Input inputMode="numeric" value={p('ltv_used')} onChange={setP('ltv_used')} disabled={!isAdmin} /></div>
                  </div>
                </div>
                <div className="space-y-4">
                  <h3 className="font-semibold">Approval Tiers ($)</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2"><Label>Standard Approval Limit</Label><Input inputMode="numeric" value={p('approval_limit')} onChange={setP('approval_limit')} disabled={!isAdmin} /></div>
                    <div className="space-y-2"><Label>Manager Approval Required Above</Label><Input inputMode="numeric" value={p('manager_above')} onChange={setP('manager_above')} disabled={!isAdmin} /></div>
                  </div>
                </div>
                <SaveButton onClick={savePrefs} label="Save Rules" />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
