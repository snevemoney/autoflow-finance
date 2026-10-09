import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import {
  CheckCircle2, XCircle, Loader2, Gavel, Wallet, BadgeCheck, CircleDollarSign, ShieldAlert, Clock, ArrowRightLeft,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAuth } from '@/contexts/AuthContext';
import {
  fundingItemsOf, useAppSettings, useApproveFunding, useCreditDecision, useFundingChecklist, useMarkFunded, useSetDealStatus,
} from '@/hooks/use-autoflow';
import { toast } from '@/hooks/use-toast';
import { DEAL_STATUS_CONFIG, type Deal, type DealStatus } from '@/types/deal';
import type { Database } from '@/integrations/supabase/types';

type Tier = Database['public']['Enums']['credit_tier'];
type Bureau = Database['public']['Enums']['credit_bureau'];

const money = (n: number) => `$${n.toLocaleString('en-CA', { maximumFractionDigits: 2 })}`;
const errText = (e: unknown) => (e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e));

function Waiting({ text }: { text: string }) {
  return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Clock className="h-4 w-4" />{text}</p>;
}

/** Business rules from Settings, applied to this deal as plain warnings. */
function RuleHints({ deal, prefs, score }: { deal: Deal; prefs: Record<string, string>; score?: number }) {
  const n = (k: string, d: number) => (Number.isFinite(parseFloat(prefs[k])) ? parseFloat(prefs[k]) : d);
  const ltvMax = deal.vehicle.condition === 'new' ? n('ltv_new', 120) : n('ltv_used', 110);
  const notes: { tone: 'warn' | 'ok'; text: string }[] = [];
  if (deal.ltv > ltvMax) notes.push({ tone: 'warn', text: `LTV ${deal.ltv}% is above the ${ltvMax}% limit for ${deal.vehicle.condition} vehicles` });
  if (deal.financingTerms.loanAmount > n('manager_above', 75000)) notes.push({ tone: 'warn', text: `Amount over ${money(n('manager_above', 75000))} — manager approval required` });
  if (score != null && score > 0) {
    if (score < n('min_score_decline', 550)) notes.push({ tone: 'warn', text: `Score below the ${n('min_score_decline', 550)} decline guideline` });
    else if (score < n('min_score_review', 620)) notes.push({ tone: 'warn', text: `Score below ${n('min_score_review', 620)} — full manual review` });
    else if (score >= n('min_score_auto', 720)) notes.push({ tone: 'ok', text: `Score meets the ${n('min_score_auto', 720)} fast-track guideline` });
  }
  if (!notes.length) return null;
  return (
    <ul className="space-y-1 text-xs">
      {notes.map((x) => (
        <li key={x.text} className={x.tone === 'warn' ? 'text-warning' : 'text-success'}>• {x.text}</li>
      ))}
    </ul>
  );
}

interface Props {
  deal: Deal;
  incomeVerified: number;
  incomeTotal: number;
  blockedReason?: string | null;
}

/** The one place staff move a deal forward: credit decision, funding checklist, funded. */
export function DealDecisionPanel({ deal, incomeVerified, incomeTotal, blockedReason }: Props) {
  const { hasRole, isAdmin } = useAuth();
  const { data: settings } = useAppSettings();
  const credit = useCreditDecision(deal.id);
  const checklist = useFundingChecklist(deal.id);
  const approve = useApproveFunding(deal.id);
  const funded = useMarkFunded(deal.id);
  const setStatus = useSetDealStatus();

  const [score, setScore] = useState(deal.creditInfo?.score?.toString() ?? '');
  const [tier, setTier] = useState<Tier | ''>(deal.creditInfo?.tier ?? '');
  const [bureau, setBureau] = useState<Bureau | ''>(deal.creditInfo?.bureau ?? '');
  const [notes, setNotes] = useState('');
  const [fundAmount, setFundAmount] = useState(String(deal.financingTerms.loanAmount));
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [moveTo, setMoveTo] = useState<DealStatus | ''>('');
  const [items, setItems] = useState<Record<string, boolean>>(deal.fundingChecklist ?? {});

  useEffect(() => setItems(deal.fundingChecklist ?? {}), [deal.fundingChecklist]);

  const fundingItems = fundingItemsOf(settings);
  const allChecked = fundingItems.length > 0 && fundingItems.every((i) => items[i.key]);
  const terminal = deal.status === 'funded' || deal.status === 'declined';
  const canCredit = hasRole('credit_analyst');
  const canFund = hasRole('funding_manager');

  const decide = async (decision: 'approved' | 'conditional' | 'declined') => {
    try {
      const next = await credit.mutateAsync({
        decision, notes: notes.trim() || undefined,
        score: score ? parseInt(score, 10) : null, tier: tier || null, bureau: bureau || null,
      });
      toast({ title: `Credit ${decision}`, description: next ? `Deal is now in ${DEAL_STATUS_CONFIG[next as DealStatus].label}.` : undefined });
      setNotes('');
    } catch (e) {
      toast({ title: 'Could not record decision', description: errText(e), variant: 'destructive' });
    }
  };

  const toggleItem = async (key: string, value: boolean) => {
    setItems((s) => ({ ...s, [key]: value }));
    try {
      await checklist.mutateAsync({ [key]: value });
    } catch (e) {
      setItems((s) => ({ ...s, [key]: !value }));
      toast({ title: 'Could not update checklist', description: errText(e), variant: 'destructive' });
    }
  };

  const onApprove = async () => {
    try {
      await approve.mutateAsync(notes.trim() || undefined);
      toast({ title: 'Approved for funding' });
    } catch (e) {
      toast({ title: 'Could not approve', description: errText(e), variant: 'destructive' });
    }
  };

  const onFunded = async () => {
    try {
      await funded.mutateAsync(parseFloat(fundAmount) || null);
      toast({ title: 'Loan funded', description: 'The dealer has been notified.' });
    } catch (e) {
      toast({ title: 'Could not mark funded', description: errText(e), variant: 'destructive' });
    }
  };

  const onDecline = async () => {
    try {
      await setStatus.mutateAsync({ dealId: deal.id, status: 'declined', notes: declineReason.trim() || undefined });
      toast({ title: 'Deal declined', variant: 'destructive' });
      setDeclineOpen(false);
    } catch (e) {
      toast({ title: 'Could not decline', description: errText(e), variant: 'destructive' });
    }
  };

  const onMove = async () => {
    if (!moveTo) return;
    try {
      await setStatus.mutateAsync({ dealId: deal.id, status: moveTo });
      toast({ title: `Moved to ${DEAL_STATUS_CONFIG[moveTo].label}` });
      setMoveTo('');
    } catch (e) {
      toast({ title: 'Could not move deal', description: errText(e), variant: 'destructive' });
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base"><Gavel className="h-5 w-5" /> Decision</CardTitle>
        <CardDescription>
          {deal.status === 'funded' ? 'This loan is funded.' : deal.status === 'declined' ? 'This deal was declined.'
            : 'AutoFlow moves the deal to the next queue as soon as each step is complete.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {blockedReason && !terminal && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" /> {blockedReason}
          </div>
        )}

        {(deal.status === 'new_submission' || deal.status === 'document_review') && (
          <Waiting text="Waiting for the documents on the checklist. Credit review starts automatically once the file is complete." />
        )}

        {deal.status === 'credit_review' && (canCredit ? (
          <div className="space-y-3">
            <RuleHints deal={deal} prefs={(settings?.preferences ?? {}) as Record<string, string>} score={score ? parseInt(score, 10) : deal.creditInfo?.score} />
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label htmlFor="score" className="text-xs">Score</Label>
                <Input id="score" inputMode="numeric" value={score} onChange={(e) => setScore(e.target.value.replace(/\D/g, '').slice(0, 3))} placeholder="e.g. 690" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Tier</Label>
                <Select value={tier} onValueChange={(v) => setTier(v as Tier)}>
                  <SelectTrigger><SelectValue placeholder="Tier" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="prime">Prime</SelectItem>
                    <SelectItem value="near_prime">Near prime</SelectItem>
                    <SelectItem value="subprime">Subprime</SelectItem>
                    <SelectItem value="deep_subprime">Deep subprime</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Bureau</Label>
                <Select value={bureau} onValueChange={(v) => setBureau(v as Bureau)}>
                  <SelectTrigger><SelectValue placeholder="Bureau" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="equifax">Equifax</SelectItem>
                    <SelectItem value="transunion">TransUnion</SelectItem>
                    <SelectItem value="experian">Experian</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Decision notes / conditions…" className="min-h-[64px]" />
            <div className="grid grid-cols-3 gap-2">
              <Button onClick={() => decide('approved')} disabled={credit.isPending || !!blockedReason}>
                {credit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-1" />} Approve
              </Button>
              <Button variant="secondary" onClick={() => decide('conditional')} disabled={credit.isPending || !!blockedReason}>Conditional</Button>
              <Button variant="outline" className="text-destructive" onClick={() => decide('declined')} disabled={credit.isPending}>
                <XCircle className="h-4 w-4 mr-1" /> Decline
              </Button>
            </div>
          </div>
        ) : <Waiting text="Waiting on a credit analyst's decision." />)}

        {deal.status === 'income_verification' && (
          <div className="space-y-2">
            <p className="text-sm">
              <span className="font-semibold">{incomeVerified} of {incomeTotal}</span> income source{incomeTotal === 1 ? '' : 's'} verified.
            </p>
            <p className="text-xs text-muted-foreground">
              Verify each source in Income Verification above. The deal moves to Funding Review when all are verified.
            </p>
          </div>
        )}

        {deal.status === 'funding_review' && (
          <div className="space-y-3">
            <div className="space-y-2">
              {fundingItems.map((item) => (
                <label key={item.key} className="flex items-start gap-2 text-sm cursor-pointer">
                  <Checkbox checked={!!items[item.key]} disabled={!canFund || checklist.isPending}
                    onCheckedChange={(v) => toggleItem(item.key, v === true)} className="mt-0.5" />
                  <span className={items[item.key] ? 'text-muted-foreground line-through' : ''}>{item.label}</span>
                </label>
              ))}
            </div>
            {canFund ? (
              <>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Funding notes (optional)" className="min-h-[56px]" />
                <Button className="w-full" onClick={onApprove} disabled={!allChecked || approve.isPending || !!blockedReason}>
                  {approve.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <BadgeCheck className="h-4 w-4 mr-2" />}
                  Approve for funding
                </Button>
                {!allChecked && <p className="text-xs text-muted-foreground text-center">Tick every item to approve.</p>}
              </>
            ) : <Waiting text="Waiting on the funding team." />}
          </div>
        )}

        {deal.status === 'approved' && (canFund ? (
          <div className="space-y-2">
            <Label htmlFor="fund-amount" className="text-xs">Funded amount</Label>
            <div className="flex gap-2">
              <Input id="fund-amount" inputMode="decimal" value={fundAmount} onChange={(e) => setFundAmount(e.target.value.replace(/[^\d.]/g, ''))} />
              <Button onClick={onFunded} disabled={funded.isPending}>
                {funded.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Wallet className="h-4 w-4 mr-2" />} Mark funded
              </Button>
            </div>
          </div>
        ) : <Waiting text="Approved — waiting to be funded." />)}

        {deal.status === 'funded' && (
          <div className="flex items-center gap-3 rounded-lg bg-accent/10 p-3">
            <CircleDollarSign className="h-6 w-6 text-accent" />
            <div className="text-sm">
              <p className="font-semibold">{money(deal.fundedAmount ?? deal.financingTerms.loanAmount)} funded</p>
              {deal.fundedAt && <p className="text-xs text-muted-foreground">{format(new Date(deal.fundedAt), 'MMM d, yyyy h:mm a')}</p>}
            </div>
          </div>
        )}

        {deal.status === 'declined' && deal.decisionNotes && (
          <p className="text-sm text-muted-foreground">Reason: {deal.decisionNotes}</p>
        )}

        {deal.creditDecision && deal.creditDecision !== 'pending' && deal.status !== 'credit_review' && (
          <p className="text-xs text-muted-foreground">
            Credit {deal.creditDecision}{deal.creditDecisionAt ? ` on ${format(new Date(deal.creditDecisionAt), 'MMM d')}` : ''}
            {deal.creditDecisionNotes ? ` — ${deal.creditDecisionNotes}` : ''}
          </p>
        )}

        {!terminal && (hasRole('credit_analyst', 'funding_manager') || isAdmin) && (
          <div className="flex flex-wrap items-center gap-2 border-t pt-3">
            {isAdmin && (
              <>
                <Select value={moveTo} onValueChange={(v) => setMoveTo(v as DealStatus)}>
                  <SelectTrigger className="h-8 w-44 text-xs"><ArrowRightLeft className="h-3 w-3 mr-1" /><SelectValue placeholder="Move to…" /></SelectTrigger>
                  <SelectContent>
                    {(['document_review', 'credit_review', 'income_verification', 'funding_review', 'approved', 'incomplete'] as DealStatus[])
                      .filter((s) => s !== deal.status)
                      .map((s) => <SelectItem key={s} value={s}>{DEAL_STATUS_CONFIG[s].label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button size="sm" variant="outline" className="h-8" disabled={!moveTo || setStatus.isPending} onClick={onMove}>Move</Button>
              </>
            )}
            <Button size="sm" variant="ghost" className="h-8 ml-auto text-destructive" onClick={() => setDeclineOpen(true)}>
              <XCircle className="h-4 w-4 mr-1" /> Decline deal
            </Button>
          </div>
        )}
      </CardContent>

      <AlertDialog open={declineOpen} onOpenChange={setDeclineOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Decline deal {deal.dealNumber}?</AlertDialogTitle>
            <AlertDialogDescription>The dealer is notified and open document requests are cancelled.</AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} placeholder="Reason (shared in the deal history)" />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onDecline} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Decline</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
