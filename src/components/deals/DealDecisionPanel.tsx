import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import {
  CheckCircle2, XCircle, Loader2, Gavel, Wallet, BadgeCheck, CircleDollarSign, ShieldAlert, Clock, Plus, Trash2, AlertTriangle, Lock, MessageSquare,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/contexts/AuthContext';
import {
  fundingItemsOf, useAppSettings, useApproveFunding, useCreditDecision, useFundingChecklist, useMarkFunded, usePreferences, useSetCreditCondition,
} from '@/hooks/use-autoflow';
import { toast } from '@/hooks/use-toast';
import { MoveToMenu } from './DealMover';
import { useDealMover } from '@/hooks/use-deal-mover';
import { errorMessage, MAX_CONDITIONS, type CreditBureau, type CreditDecisionValue, type CreditTier } from '@/lib/rpc';
import type { AppPreferences } from '@/lib/preferences';
import { cn } from '@/lib/utils';
import { statusConfig, type Deal, type TimelineEvent } from '@/types/deal';

const money = (n: number) => `$${n.toLocaleString('en-CA', { maximumFractionDigits: 2 })}`;

function Waiting({ text }: { text: string }) {
  return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Clock className="h-4 w-4 shrink-0" aria-hidden />{text}</p>;
}

/** Business rules from Settings, applied to this deal as plain warnings. */
function RuleHints({ deal, prefs, score }: { deal: Deal; prefs: AppPreferences; score?: number }) {
  const ltvMax = deal.vehicle.condition === 'new' ? prefs.ltv_new : prefs.ltv_used;
  const notes: { tone: 'warn' | 'ok'; text: string }[] = [];
  if (deal.ltv > ltvMax) notes.push({ tone: 'warn', text: `LTV ${deal.ltv}% is above the ${ltvMax}% limit for ${deal.vehicle.condition} vehicles` });
  if (deal.financingTerms.loanAmount > prefs.manager_above) notes.push({ tone: 'warn', text: `Amount over ${money(prefs.manager_above)} — manager approval required` });
  if (score != null && score > 0) {
    if (score < prefs.min_score_decline) notes.push({ tone: 'warn', text: `Score below the ${prefs.min_score_decline} decline guideline` });
    else if (score < prefs.min_score_review) notes.push({ tone: 'warn', text: `Score below ${prefs.min_score_review} — full manual review` });
    else if (score >= prefs.min_score_auto) notes.push({ tone: 'ok', text: `Score meets the ${prefs.min_score_auto} fast-track guideline` });
  }
  if (!notes.length) return null;
  return (
    <ul className="space-y-1 text-xs">
      {notes.map((x) => <li key={x.text} className={x.tone === 'warn' ? 'text-warning' : 'text-success'}>• {x.text}</li>)}
    </ul>
  );
}

/** The latest decision entry in the staff-only history — where internal notes live now. */
function latestDecision(timeline: TimelineEvent[]): TimelineEvent | null {
  return [...timeline]
    .filter((t) => t.type === 'decision' || (t.metadata && typeof t.metadata === 'object' && ('decision' in t.metadata || 'reason' in t.metadata)))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] ?? null;
}

function InternalNote({ entry }: { entry: TimelineEvent | null }) {
  if (!entry) return null;
  const meta = (entry.metadata ?? {}) as Record<string, unknown>;
  const extra = [meta.notes, meta.reason].find((v) => typeof v === 'string' && v && !entry.description.includes(v)) as string | undefined;
  return (
    <div className="rounded-md border bg-muted/40 p-2.5 text-xs space-y-0.5">
      <p className="flex items-center gap-1 font-medium text-muted-foreground"><Lock className="h-3 w-3" aria-hidden /> Internal (staff only)</p>
      <p className="whitespace-pre-wrap">{entry.description}{extra ? ` — ${extra}` : ''}</p>
      <p className="text-muted-foreground">{entry.createdBy} · {format(new Date(entry.createdAt), 'MMM d, h:mm a')}</p>
    </div>
  );
}

function DealerMessage({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <div className="rounded-md border border-info/30 bg-info/5 p-2.5 text-xs">
      <p className="flex items-center gap-1 font-medium text-info"><MessageSquare className="h-3 w-3" aria-hidden /> Dealer was told</p>
      <p className="whitespace-pre-wrap mt-0.5">{text}</p>
    </div>
  );
}

const DECISIONS: { value: CreditDecisionValue; label: string }[] = [
  { value: 'approved', label: 'Approve' },
  { value: 'conditional', label: 'Conditional' },
  { value: 'declined', label: 'Decline' },
];

interface Props {
  deal: Deal;
  incomeVerified: number;
  incomeTotal: number;
  /** policy problem the server acts on (e.g. vehicle used for work) — shown, never acted on here */
  blockedReason?: string | null;
}

/** The one place staff move a deal forward: credit decision, conditions, funding checklist, funded. */
export function DealDecisionPanel({ deal, incomeVerified, incomeTotal, blockedReason }: Props) {
  const { hasRole, isAdmin } = useAuth();
  const { data: settings } = useAppSettings();
  const { prefs } = usePreferences();
  const credit = useCreditDecision(deal.id);
  const checklist = useFundingChecklist(deal.id);
  const condition = useSetCreditCondition(deal.id);
  const approve = useApproveFunding(deal.id);
  const funded = useMarkFunded(deal.id);
  const mover = useDealMover();

  const [score, setScore] = useState(deal.creditInfo?.score?.toString() ?? '');
  const [tier, setTier] = useState<CreditTier | ''>(deal.creditInfo?.tier ?? '');
  const [bureau, setBureau] = useState<CreditBureau | ''>(deal.creditInfo?.bureau ?? '');
  const [decision, setDecision] = useState<CreditDecisionValue>('approved');
  const [notes, setNotes] = useState('');
  const [dealerMessage, setDealerMessage] = useState('');
  const [conditions, setConditions] = useState<string[]>(['']);
  const [fundingNotes, setFundingNotes] = useState('');
  const [fundAmount, setFundAmount] = useState(String(deal.financingTerms.loanAmount));
  const [items, setItems] = useState<Record<string, boolean>>(deal.fundingChecklist ?? {});
  const [cleared, setCleared] = useState<Record<string, boolean>>({});

  useEffect(() => setItems(deal.fundingChecklist ?? {}), [deal.fundingChecklist]);
  useEffect(() => setCleared(Object.fromEntries(deal.creditConditions.map((c) => [c.id, !!c.cleared_at]))), [deal.creditConditions]);

  const fundingItems = fundingItemsOf(settings);
  const itemsLeft = fundingItems.filter((i) => !items[i.key]).length;
  const conditionsLeft = deal.creditConditions.filter((c) => !cleared[c.id]).length;
  const terminal = deal.status === 'funded' || deal.status === 'declined';
  const canCredit = hasRole('credit_analyst');
  const canFund = hasRole('funding_manager');
  const canClearConditions = hasRole('credit_analyst', 'funding_manager');
  const canDecline = hasRole('credit_analyst', 'funding_manager');
  const overLimit = prefs.funding_approval_limit != null && deal.financingTerms.loanAmount > prefs.funding_approval_limit;
  const lastDecision = latestDecision(deal.timeline);
  const filledConditions = conditions.map((c) => c.trim()).filter(Boolean);

  const approveBlocker = blockedReason
    ? blockedReason
    : conditionsLeft > 0
      ? `Clear ${conditionsLeft} credit condition${conditionsLeft === 1 ? '' : 's'} first.`
      : !fundingItems.length
        ? 'No funding checklist is set up (Settings → Automations).'
        : itemsLeft > 0
          ? `Tick every funding checklist item (${itemsLeft} left).`
          : null;

  const decide = async () => {
    if (decision === 'conditional' && !filledConditions.length) {
      toast({ title: 'Add at least one condition', description: 'A conditional approval needs the conditions the dealer must meet.', variant: 'destructive' });
      return;
    }
    if (decision === 'declined' && !notes.trim()) {
      toast({ title: 'Add an internal reason for the decline', variant: 'destructive' });
      return;
    }
    try {
      const next = await credit.mutateAsync({
        decision, notes, dealerMessage,
        conditions: decision === 'conditional' ? filledConditions : null,
        score: score ? parseInt(score, 10) : null, tier: tier || null, bureau: bureau || null,
      });
      toast({ title: decision === 'declined' ? 'Deal declined' : `Credit ${decision === 'conditional' ? 'conditionally approved' : 'approved'}`,
        description: next ? `Deal is now in ${statusConfig(next).label}.` : undefined });
      setNotes('');
      setDealerMessage('');
      setConditions(['']);
    } catch (e) {
      toast({ title: 'Could not record the decision', description: errorMessage(e), variant: 'destructive' });
    }
  };

  const toggleItem = async (key: string, value: boolean) => {
    setItems((s) => ({ ...s, [key]: value }));
    try {
      await checklist.mutateAsync({ [key]: value });
    } catch (e) {
      setItems((s) => ({ ...s, [key]: !value }));
      toast({ title: 'Could not update the checklist', description: errorMessage(e), variant: 'destructive' });
    }
  };

  const toggleCondition = async (id: string, value: boolean) => {
    setCleared((s) => ({ ...s, [id]: value }));
    try {
      const next = await condition.mutateAsync({ conditionId: id, cleared: value });
      setCleared(Object.fromEntries(next.map((c) => [c.id, !!c.cleared_at])));
    } catch (e) {
      setCleared((s) => ({ ...s, [id]: !value }));
      toast({ title: 'Could not update the condition', description: errorMessage(e), variant: 'destructive' });
    }
  };

  const onApprove = async () => {
    try {
      await approve.mutateAsync(fundingNotes.trim() || undefined);
      toast({ title: 'Approved for funding' });
      setFundingNotes('');
    } catch (e) {
      toast({ title: 'Could not approve', description: errorMessage(e), variant: 'destructive' });
    }
  };

  const onFunded = async () => {
    const amount = parseFloat(fundAmount);
    if (!(amount > 0)) {
      toast({ title: 'Enter the funded amount', variant: 'destructive' });
      return;
    }
    try {
      await funded.mutateAsync(amount);
      toast({ title: 'Loan funded', description: 'The dealer has been notified.' });
    } catch (e) {
      toast({ title: 'Could not mark funded', description: errorMessage(e), variant: 'destructive' });
    }
  };

  const conditionList = deal.creditConditions.length > 0 && (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium mb-1">Credit conditions {conditionsLeft ? <span className="text-warning">({conditionsLeft} open)</span> : <span className="text-success">(all cleared)</span>}</legend>
      {deal.creditConditions.map((c) => (
        <div key={c.id} className="flex items-start gap-2 text-sm">
          <Checkbox id={`cond-${c.id}`} checked={!!cleared[c.id]} disabled={!canClearConditions || condition.isPending}
            onCheckedChange={(v) => toggleCondition(c.id, v === true)} className="mt-0.5" />
          <Label htmlFor={`cond-${c.id}`} className={cn('font-normal cursor-pointer leading-snug', cleared[c.id] && 'text-muted-foreground line-through')}>{c.label}</Label>
        </div>
      ))}
    </fieldset>
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base"><Gavel className="h-5 w-5" aria-hidden /> Decision</CardTitle>
          {isAdmin && <MoveToMenu deal={deal} onPick={(to) => mover.request(deal, to)} />}
        </div>
        <CardDescription>
          {deal.status === 'funded' ? 'This loan is funded.' : deal.status === 'declined' ? 'This deal was declined.'
            : 'AutoFlow moves the deal to the next queue as soon as each step is complete.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {blockedReason && !terminal && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="status">
            <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" aria-hidden /> {blockedReason}
          </div>
        )}

        {(deal.status === 'new_submission' || deal.status === 'document_review') && (
          <Waiting text="Waiting for the documents on the checklist. Credit review starts automatically once the file is complete." />
        )}

        {deal.status === 'credit_review' && (canCredit ? (
          <div className="space-y-3">
            <RuleHints deal={deal} prefs={prefs} score={score ? parseInt(score, 10) : deal.creditInfo?.score} />
            <div className="grid grid-cols-1 min-[420px]:grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label htmlFor="credit-score" className="text-xs">Score</Label>
                <Input id="credit-score" inputMode="numeric" value={score} onChange={(e) => setScore(e.target.value.replace(/\D/g, '').slice(0, 3))} placeholder="e.g. 690" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="credit-tier" className="text-xs">Tier</Label>
                <Select value={tier} onValueChange={(v) => setTier(v as CreditTier)}>
                  <SelectTrigger id="credit-tier"><SelectValue placeholder="Tier" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="prime">Prime</SelectItem>
                    <SelectItem value="near_prime">Near prime</SelectItem>
                    <SelectItem value="subprime">Subprime</SelectItem>
                    <SelectItem value="deep_subprime">Deep subprime</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="credit-bureau" className="text-xs">Bureau</Label>
                <Select value={bureau} onValueChange={(v) => setBureau(v as CreditBureau)}>
                  <SelectTrigger id="credit-bureau"><SelectValue placeholder="Bureau" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="equifax">Equifax</SelectItem>
                    <SelectItem value="transunion">TransUnion</SelectItem>
                    <SelectItem value="experian">Experian</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div role="radiogroup" aria-label="Credit decision" className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
              {DECISIONS.map((d) => (
                <button key={d.value} type="button" role="radio" aria-checked={decision === d.value} onClick={() => setDecision(d.value)}
                  className={cn('rounded-md px-2 py-1.5 text-sm font-medium transition-colors',
                    decision === d.value ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground',
                    decision === d.value && d.value === 'declined' && 'text-destructive')}>
                  {d.label}
                </button>
              ))}
            </div>

            {decision === 'conditional' && (
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Conditions <span className="text-destructive">*</span> <span className="text-xs font-normal text-muted-foreground">(up to {MAX_CONDITIONS})</span></legend>
                {conditions.map((c, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Label htmlFor={`condition-${i}`} className="sr-only">Condition {i + 1}</Label>
                    <Input id={`condition-${i}`} value={c} maxLength={200} placeholder={i === 0 ? 'e.g. Proof of residence' : 'Another condition'}
                      onChange={(e) => setConditions((s) => s.map((x, j) => (j === i ? e.target.value : x)))} />
                    <Button type="button" variant="ghost" size="icon" aria-label={`Remove condition ${i + 1}`} disabled={conditions.length === 1}
                      onClick={() => setConditions((s) => s.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" aria-hidden /></Button>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" disabled={conditions.length >= MAX_CONDITIONS}
                  onClick={() => setConditions((s) => [...s, ''])}><Plus className="h-3.5 w-3.5 mr-1" aria-hidden /> Add condition</Button>
                <p className="text-xs text-muted-foreground">The funding team ticks these off before the deal can be approved for funding.</p>
              </fieldset>
            )}

            <div className="space-y-1">
              <Label htmlFor="credit-notes" className="text-xs flex items-center gap-1"><Lock className="h-3 w-3" aria-hidden /> Internal notes (staff only){decision === 'declined' && <span className="text-destructive">*</span>}</Label>
              <Textarea id="credit-notes" value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-[56px]"
                placeholder={decision === 'declined' ? 'Why the deal is declined — kept in the staff history' : 'Kept in the staff history'} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="credit-dealer-message" className="text-xs flex items-center gap-1"><MessageSquare className="h-3 w-3" aria-hidden /> Message to the dealer</Label>
              <Textarea id="credit-dealer-message" value={dealerMessage} onChange={(e) => setDealerMessage(e.target.value)} className="min-h-[56px]"
                placeholder={decision === 'conditional' ? 'e.g. Approved once we receive proof of residence.' : 'Shown in the dealer portal (optional)'} />
            </div>

            <Button className="w-full" variant={decision === 'declined' ? 'destructive' : 'default'} onClick={decide}
              disabled={credit.isPending || (decision !== 'declined' && !!blockedReason) || (decision === 'conditional' && !filledConditions.length)}>
              {credit.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden />
                : decision === 'declined' ? <XCircle className="h-4 w-4 mr-2" aria-hidden /> : <CheckCircle2 className="h-4 w-4 mr-2" aria-hidden />}
              {decision === 'approved' ? 'Record approval' : decision === 'conditional' ? `Approve with ${filledConditions.length || ''} condition${filledConditions.length === 1 ? '' : 's'}` : 'Decline deal'}
            </Button>
          </div>
        ) : <Waiting text="Waiting on a credit analyst's decision." />)}

        {deal.status === 'income_verification' && (
          <div className="space-y-2">
            <p className="text-sm">
              <span className="font-semibold">{incomeVerified} of {incomeTotal}</span> income source{incomeTotal === 1 ? '' : 's'} verified.
            </p>
            <p className="text-xs text-muted-foreground">Verify each source in Income Verification. The deal moves to Funding Review when all are verified.</p>
            {conditionList}
          </div>
        )}

        {deal.status === 'funding_review' && (
          <div className="space-y-4">
            {overLimit && (
              <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm text-warning" role="status">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
                <span>This loan ({money(deal.financingTerms.loanAmount)}) is above the {money(prefs.funding_approval_limit!)} funding approval limit. Get a second approval before funding.</span>
              </div>
            )}
            {conditionList}
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium mb-1">Funding checklist</legend>
              {fundingItems.map((item) => (
                <div key={item.key} className="flex items-start gap-2 text-sm">
                  <Checkbox id={`fund-${item.key}`} checked={!!items[item.key]} disabled={!canFund || checklist.isPending}
                    onCheckedChange={(v) => toggleItem(item.key, v === true)} className="mt-0.5" />
                  <Label htmlFor={`fund-${item.key}`} className={cn('font-normal cursor-pointer leading-snug', items[item.key] && 'text-muted-foreground line-through')}>{item.label}</Label>
                </div>
              ))}
              {!fundingItems.length && <p className="text-xs text-muted-foreground">No funding checklist items are set up.</p>}
            </fieldset>
            {canFund ? (
              <>
                <div className="space-y-1">
                  <Label htmlFor="funding-notes" className="text-xs">Funding notes (staff only, optional)</Label>
                  <Textarea id="funding-notes" value={fundingNotes} onChange={(e) => setFundingNotes(e.target.value)} className="min-h-[56px]" />
                </div>
                <Button className="w-full" onClick={onApprove} disabled={!!approveBlocker || approve.isPending} aria-describedby={approveBlocker ? 'approve-blocker' : undefined}>
                  {approve.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden /> : <BadgeCheck className="h-4 w-4 mr-2" aria-hidden />}
                  Approve for funding
                </Button>
                {approveBlocker && <p id="approve-blocker" className="text-xs text-muted-foreground text-center">{approveBlocker}</p>}
              </>
            ) : <Waiting text="Waiting on the funding team." />}
          </div>
        )}

        {deal.status === 'approved' && (canFund ? (
          <div className="space-y-2">
            {overLimit && (
              <p className="text-xs text-warning flex items-start gap-1"><AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" aria-hidden />Above the {money(prefs.funding_approval_limit!)} funding approval limit.</p>
            )}
            <Label htmlFor="fund-amount" className="text-xs">Funded amount ($)</Label>
            <div className="flex flex-col min-[420px]:flex-row gap-2">
              <Input id="fund-amount" inputMode="decimal" value={fundAmount} onChange={(e) => setFundAmount(e.target.value.replace(/[^\d.]/g, ''))} />
              <Button onClick={onFunded} disabled={funded.isPending}>
                {funded.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden /> : <Wallet className="h-4 w-4 mr-2" aria-hidden />} Mark funded
              </Button>
            </div>
          </div>
        ) : <Waiting text="Approved — waiting to be funded." />)}

        {deal.status === 'funded' && (
          <div className="flex items-center gap-3 rounded-lg bg-accent/10 p-3">
            <CircleDollarSign className="h-6 w-6 text-accent" aria-hidden />
            <div className="text-sm">
              <p className="font-semibold">{money(deal.fundedAmount ?? deal.financingTerms.loanAmount)} funded</p>
              {deal.fundedAt && <p className="text-xs text-muted-foreground">{format(new Date(deal.fundedAt), 'MMM d, yyyy h:mm a')}</p>}
            </div>
          </div>
        )}

        {deal.creditDecision && deal.creditDecision !== 'pending' && deal.status !== 'credit_review' && (
          <p className="text-xs text-muted-foreground">
            Credit {deal.creditDecision}{deal.creditDecisionAt ? ` on ${format(new Date(deal.creditDecisionAt), 'MMM d')}` : ''}
            {deal.creditConditions.length ? ` · ${deal.creditConditions.length} condition${deal.creditConditions.length === 1 ? '' : 's'}` : ''}
          </p>
        )}

        {(deal.status === 'declined' || (lastDecision && deal.status !== 'credit_review')) && (
          <div className="space-y-2">
            <InternalNote entry={lastDecision} />
            {!lastDecision && deal.decisionNotes && <p className="text-xs text-muted-foreground">Reason: {deal.decisionNotes}</p>}
            <DealerMessage text={deal.dealerMessage} />
          </div>
        )}

        {!terminal && canDecline && deal.status !== 'credit_review' && (
          <div className="flex justify-end border-t pt-3">
            <Button size="sm" variant="ghost" className="h-8 text-destructive" onClick={() => mover.openDecline(deal)}>
              <XCircle className="h-4 w-4 mr-1" aria-hidden /> Decline deal
            </Button>
          </div>
        )}
      </CardContent>
      {mover.dialogs}
    </Card>
  );
}
