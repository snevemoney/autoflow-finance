import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
  ArrowLeft, User, Car, DollarSign, Clock, Building2, CreditCard, Mail, Phone, MapPin, AlertCircle, Loader2, ArrowLeftRight, Lock, Users, Ban,
} from 'lucide-react';
import { AppHeader } from '@/components/layout/AppHeader';
import { StatusBadge } from '@/components/deals/StatusBadge';
import { DealTimeline } from '@/components/deals/DealTimeline';
import { DocumentUpload } from '@/components/deals/DocumentUpload';
import { DocumentViewer } from '@/components/deals/DocumentViewer';
import { DocumentList } from '@/components/deals/DocumentList';
import { DealChecklistCard } from '@/components/deals/DealChecklistCard';
import { DealDecisionPanel } from '@/components/deals/DealDecisionPanel';
import { StatusTracker } from '@/components/deals/StatusTracker';
import { DealSummaryCard } from '@/components/deals/DealSummaryCard';
import { IncomeVerificationCard } from '@/components/deals/IncomeVerificationCard';
import { EmployerVerificationCard } from '@/components/deals/EmployerVerificationCard';
import { ApplicantDebtsCard } from '@/components/deals/ApplicantDebtsCard';
import type { ExtractedData } from '@/components/deals/ExtractedDataBadge';
import { QueryError } from '@/components/QueryError';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { useDeal } from '@/hooks/use-deals';
import { usePreferences } from '@/hooks/use-autoflow';
import { useApplicantDebts, useExtractions, useIncomeSources } from '@/hooks/use-income';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { qk } from '@/lib/query-keys';
import { cn } from '@/lib/utils';
import type { Document } from '@/types/deal';

function Field({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-sm text-muted-foreground">{label}</p>
      <div className={cn('font-medium break-words', mono && 'font-mono text-sm font-normal')}>{children || '—'}</div>
    </div>
  );
}

const money = (n: number | undefined) => (n == null ? '—' : `$${n.toLocaleString('en-CA')}`);

export default function DealDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const qc = useQueryClient();
  const { prefs } = usePreferences();
  const { data: deal, isLoading, isError, error, refetch, isFetching } = useDeal(id);
  const incomeSources = useIncomeSources(deal?.id);
  const debts = useApplicantDebts(deal?.id);
  const extractions = useExtractions(deal?.id);
  const [note, setNote] = useState('');
  const [noteShared, setNoteShared] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [viewerDoc, setViewerDoc] = useState<Document | null>(null);

  if (isError) {
    return (
      <div className="flex flex-col h-full">
        <AppHeader title="Deal" />
        <div className="p-4 lg:p-6"><QueryError what="this deal" error={error} onRetry={() => refetch()} retrying={isFetching} /></div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex flex-col h-full">
        <AppHeader title="Deal" subtitle="Loading…" />
        <div className="p-4 lg:p-6 space-y-4" aria-busy="true">
          <Skeleton className="h-8 w-full max-w-xl" />
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            <div className="lg:col-span-3 space-y-4"><Skeleton className="h-64" /><Skeleton className="h-48" /></div>
            <div className="lg:col-span-2 space-y-4"><Skeleton className="h-56" /><Skeleton className="h-40" /></div>
          </div>
        </div>
      </div>
    );
  }

  if (!deal) {
    return (
      <div className="flex flex-col h-full items-center justify-center gap-4 p-6 text-center">
        <h1 className="text-2xl font-bold">Deal not found</h1>
        <p className="text-muted-foreground">It may have been removed, or you don't have access to it.</p>
        <Button onClick={() => navigate('/deals')}>Back to deals</Button>
      </div>
    );
  }

  const sources = incomeSources.data ?? [];
  const extractionMap: Record<string, ExtractedData> = Object.fromEntries((extractions.data ?? []).map((e) => [e.document_id, e]));
  const hasVehicleForWork = sources.some((s) => s.vehicle_for_work);
  const open = deal.status !== 'declined' && deal.status !== 'funded';
  const vehicleNotice = hasVehicleForWork && open
    ? prefs.decline_vehicle_for_work
      ? 'The vehicle is used for rideshare/commercial work, which policy does not allow. AutoFlow declines this deal automatically.'
      : 'The vehicle is used for rideshare/commercial work — check the policy before approving.'
    : null;

  const handleAddNote = async () => {
    if (!note.trim() || !user) return;
    setSavingNote(true);
    const { error: err } = await supabase.from('deal_notes').insert({
      deal_id: deal.id, content: note.trim(), created_by: user.id, is_internal: !noteShared,
    });
    setSavingNote(false);
    if (err) {
      toast({ title: 'Could not add the note', description: err.message, variant: 'destructive' });
      return;
    }
    toast({ title: noteShared ? 'Message sent to the dealer' : 'Internal note added' });
    setNote('');
    qc.invalidateQueries({ queryKey: qk.deal(user.id, deal.id) });
  };

  const documentsReading = deal.documents.some((d) => d.processingStatus === 'pending' || d.processingStatus === 'processing');
  const incomeVerified = sources.filter((s) => s.verification_status === 'verified').length;
  const customer = deal.customer;

  return (
    <div className="flex flex-col h-full">
      <AppHeader title={`Deal ${deal.dealNumber}`} subtitle={`${customer.firstName} ${customer.lastName}`} />

      <div className="flex-1 overflow-y-auto p-4 lg:p-6 scrollbar-thin">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <Button variant="ghost" onClick={() => navigate(-1)} className="-ml-2">
            <ArrowLeft className="h-4 w-4 mr-2" aria-hidden /> Back
          </Button>
          <StatusBadge status={deal.status} size="lg" />
        </div>
        <StatusTracker status={deal.status} className="mb-4 pb-1" />

        {vehicleNotice && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="status">
            <Ban className="h-4 w-4 mt-0.5 shrink-0" aria-hidden /> {vehicleNotice}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          <div className="lg:col-span-3 space-y-4 min-w-0">
            <IncomeVerificationCard deal={deal} />

            <Tabs defaultValue="overview">
              <TabsList className="w-full sm:w-auto overflow-x-auto justify-start">
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="documents">Documents ({deal.documents.length})</TabsTrigger>
                <TabsTrigger value="notes">Notes ({deal.notes.length})</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="space-y-4 mt-4">
                <Card>
                  <CardHeader><CardTitle className="flex items-center gap-2"><User className="h-5 w-5" aria-hidden /> Customer</CardTitle></CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <Field label="Full name">{customer.firstName} {customer.lastName}</Field>
                      <Field label="Email">{customer.email && <span className="flex items-center gap-1"><Mail className="h-3 w-3 shrink-0" aria-hidden />{customer.email}</span>}</Field>
                      <Field label="Phone">{customer.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3 shrink-0" aria-hidden />{customer.phone}</span>}</Field>
                      <Field label="Address">
                        {(customer.address.city || customer.address.street) && (
                          <span className="flex items-center gap-1"><MapPin className="h-3 w-3 shrink-0" aria-hidden />
                            {[customer.address.street, customer.address.city, customer.address.state, customer.address.zip].filter(Boolean).join(', ')}
                          </span>
                        )}
                      </Field>
                      {customer.dateOfBirth && <Field label="Date of birth">{format(new Date(`${customer.dateOfBirth}T00:00:00`), 'MMM d, yyyy')}</Field>}
                      {customer.employmentInfo && (
                        <>
                          <Field label="Employer">{customer.employmentInfo.employer}</Field>
                          <Field label="Stated monthly income">{money(customer.employmentInfo.monthlyIncome)}</Field>
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader><CardTitle className="flex items-center gap-2"><Car className="h-5 w-5" aria-hidden /> Vehicle</CardTitle></CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <Field label="Vehicle">{deal.vehicle.year || ''} {deal.vehicle.make} {deal.vehicle.model} {deal.vehicle.trim}</Field>
                      <Field label="VIN" mono>{deal.vehicle.vin}</Field>
                      <Field label="Condition"><span className="capitalize">{deal.vehicle.condition}</span></Field>
                      <Field label="Odometer">{deal.vehicle.mileage ? `${deal.vehicle.mileage.toLocaleString('en-CA')} km` : ''}</Field>
                      <Field label="Selling price">{money(deal.vehicle.invoicePrice)}</Field>
                      <Field label="Colour">{deal.vehicle.color}</Field>
                    </div>
                  </CardContent>
                </Card>

                {deal.tradeIn && (
                  <Card>
                    <CardHeader><CardTitle className="flex items-center gap-2"><ArrowLeftRight className="h-5 w-5" aria-hidden /> Trade-in</CardTitle></CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <Field label="Vehicle">{deal.tradeIn.year || ''} {deal.tradeIn.make} {deal.tradeIn.model}</Field>
                        <Field label="VIN" mono>{deal.tradeIn.vin}</Field>
                        <Field label="Value">{money(deal.tradeIn.estimatedValue)}</Field>
                        <Field label="Payoff">{money(deal.tradeIn.payoffAmount ?? 0)}</Field>
                      </div>
                    </CardContent>
                  </Card>
                )}

                <Card>
                  <CardHeader><CardTitle className="flex items-center gap-2"><DollarSign className="h-5 w-5" aria-hidden /> Financing</CardTitle></CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-3 gap-2 sm:gap-4">
                      {[
                        [money(deal.financingTerms.loanAmount), 'Loan amount'],
                        [`${deal.financingTerms.apr}%`, 'APR'],
                        [`${deal.financingTerms.termMonths}`, 'Months'],
                      ].map(([v, l]) => (
                        <div key={l} className="text-center p-2 sm:p-4 rounded-lg bg-muted min-w-0">
                          <p className="text-base sm:text-2xl font-bold truncate">{v}</p>
                          <p className="text-xs sm:text-sm text-muted-foreground">{l}</p>
                        </div>
                      ))}
                    </div>
                    <div className="grid grid-cols-2 gap-4 mt-4">
                      <Field label="Down payment">{money(deal.financingTerms.downPayment)}</Field>
                      <Field label="Monthly payment">{money(deal.financingTerms.monthlyPayment)}</Field>
                      <Field label="Total interest">{money(deal.financingTerms.totalInterest)}</Field>
                      <Field label="LTV">{deal.ltv ? `${deal.ltv}%` : ''}</Field>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="documents" className="mt-4 space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Upload documents</CardTitle>
                    <CardDescription>Drop files in any order — AutoFlow sorts them, reads income documents and updates the checklist.</CardDescription>
                  </CardHeader>
                  <CardContent><DocumentUpload dealId={deal.id} /></CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle>Documents ({deal.documents.length})</CardTitle></CardHeader>
                  <CardContent>
                    <DocumentList dealId={deal.id} documents={deal.documents} staff extractions={extractionMap} onView={setViewerDoc} />
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="notes" className="mt-4">
                <Card>
                  <CardHeader><CardTitle>Add a note</CardTitle></CardHeader>
                  <CardContent>
                    <Label htmlFor="deal-note" className="sr-only">{noteShared ? 'Message to the dealer' : 'Internal note'}</Label>
                    <Textarea id="deal-note" placeholder={noteShared ? 'Message to the dealer…' : 'Internal note (staff only)…'}
                      value={note} onChange={(e) => setNote(e.target.value)} className="mb-3" />
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-sm">
                        <Switch id="note-shared" checked={noteShared} onCheckedChange={setNoteShared} />
                        <Label htmlFor="note-shared">Visible to dealer</Label>
                      </div>
                      <Button onClick={handleAddNote} disabled={savingNote || !note.trim()}>
                        {savingNote && <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden />}
                        {noteShared ? 'Send to dealer' : 'Add note'}
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                <Card className="mt-4">
                  <CardHeader><CardTitle>Notes history</CardTitle></CardHeader>
                  <CardContent>
                    {deal.notes.length > 0 ? (
                      <ul className="space-y-4">
                        {deal.notes.map((n) => (
                          <li key={n.id} className="border-l-2 border-muted pl-4">
                            <p className="text-sm whitespace-pre-wrap break-words">{n.content}</p>
                            <p className="text-xs text-muted-foreground mt-1 flex flex-wrap items-center gap-1">
                              {n.isInternal ? <Lock className="h-3 w-3" aria-hidden /> : <Users className="h-3 w-3" aria-hidden />}
                              {n.isInternal ? 'Internal' : 'Shared with dealer'} · {n.createdBy} · {format(new Date(n.createdAt), 'MMM d, yyyy h:mm a')}
                            </p>
                          </li>
                        ))}
                      </ul>
                    ) : <p className="text-sm text-muted-foreground">No notes yet</p>}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>

          <div className="lg:col-span-2 space-y-4 min-w-0">
            <DealDecisionPanel deal={deal} incomeVerified={incomeVerified} incomeTotal={sources.length} blockedReason={vehicleNotice} />
            <DealChecklistCard dealId={deal.id} documentsReading={documentsReading} />
            <DealSummaryCard deal={deal} incomeSources={sources} debts={debts.data} />
            <ApplicantDebtsCard dealId={deal.id} customerId={customer.id} />
            {customer.employmentInfo?.employer && (
              <EmployerVerificationCard employer={customer.employmentInfo.employer} city={customer.address.city} state={customer.address.state} customerId={customer.id} />
            )}

            {deal.creditInfo && (
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2"><CreditCard className="h-5 w-5" aria-hidden /> Credit</CardTitle></CardHeader>
                <CardContent>
                  <div className="text-center mb-4">
                    <p className="text-4xl font-bold">{deal.creditInfo.score}</p>
                    <span className={cn('status-badge',
                      deal.creditInfo.tier === 'prime' && 'bg-success/10 text-success',
                      deal.creditInfo.tier === 'near_prime' && 'bg-info/10 text-info',
                      deal.creditInfo.tier === 'subprime' && 'bg-warning/10 text-warning',
                      deal.creditInfo.tier === 'deep_subprime' && 'bg-destructive/10 text-destructive')}>
                      {deal.creditInfo.tier.replace('_', ' ')}
                    </span>
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">Bureau</span><span className="capitalize">{deal.creditInfo.bureau}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Pulled</span><span>{format(new Date(deal.creditInfo.pulledAt), 'MMM d, yyyy')}</span></div>
                  </div>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Building2 className="h-5 w-5" aria-hidden /> Dealer</CardTitle></CardHeader>
              <CardContent>
                <p className="font-medium">{deal.dealerName}</p>
                {deal.dealerContact && <p className="text-sm text-muted-foreground mt-1">Contact: {deal.dealerContact}</p>}
              </CardContent>
            </Card>

            {deal.flags.length > 0 && (
              <Card className="border-warning">
                <CardHeader><CardTitle className="flex items-center gap-2 text-warning"><AlertCircle className="h-5 w-5" aria-hidden /> Attention required</CardTitle></CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {deal.flags.map((flag, i) => (
                      <li key={i} className="flex items-center gap-2 text-sm text-warning"><AlertCircle className="h-4 w-4 shrink-0" aria-hidden />{flag}</li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Clock className="h-5 w-5" aria-hidden /> Activity (staff only)</CardTitle></CardHeader>
              <CardContent><DealTimeline events={deal.timeline} /></CardContent>
            </Card>
          </div>
        </div>
      </div>

      <DocumentViewer open={!!viewerDoc} onOpenChange={(o) => !o && setViewerDoc(null)}
        document={viewerDoc ? { id: viewerDoc.id, name: viewerDoc.name, mimeType: viewerDoc.mimeType } : null} />
    </div>
  );
}
