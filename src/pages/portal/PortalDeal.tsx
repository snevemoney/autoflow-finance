import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { format } from 'date-fns';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, AlertTriangle, MessageSquare, Send, CircleDollarSign, XCircle, Car, User, Calculator, Info } from 'lucide-react';
import { AppHeader } from '@/components/layout/AppHeader';
import { StatusBadge } from '@/components/deals/StatusBadge';
import { StatusTracker } from '@/components/deals/StatusTracker';
import { DocumentUpload } from '@/components/deals/DocumentUpload';
import { DocumentList } from '@/components/deals/DocumentList';
import { DocumentViewer } from '@/components/deals/DocumentViewer';
import { DealChecklistCard } from '@/components/deals/DealChecklistCard';
import { PortalFooter } from '@/components/portal/PortalFooter';
import { QueryError } from '@/components/QueryError';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useDeal } from '@/hooks/use-deals';
import { useDealRequests } from '@/hooks/use-autoflow';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { qk } from '@/lib/query-keys';
import { ago } from '@/lib/utils';
import { statusConfig, type Document, type DocumentType } from '@/types/deal';

const STATUS_HELP: Record<string, string> = {
  new_submission: 'Received — we are opening the file.',
  document_review: 'We are checking the documents. Anything missing is listed below.',
  credit_review: 'The file is complete and with our credit team.',
  income_verification: 'Credit is approved; we are confirming income.',
  funding_review: 'Income is confirmed; we are preparing funding.',
  approved: 'Approved for funding — funds are on the way.',
  funded: 'Funded. Thank you!',
  declined: 'This application was declined.',
  incomplete: 'This file is on hold — see messages below.',
};

export default function PortalDeal() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data: deal, isLoading, isError, error, refetch, isFetching } = useDeal(id, { staff: false });
  const requests = useDealRequests(id);
  const [viewer, setViewer] = useState<Document | null>(null);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

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
        <div className="p-4 lg:p-6 space-y-4" aria-busy="true"><Skeleton className="h-8 w-full max-w-xl" /><Skeleton className="h-48" /><Skeleton className="h-64" /></div>
      </div>
    );
  }
  if (!deal) {
    return (
      <div className="flex flex-col h-full items-center justify-center gap-4 p-6 text-center">
        <h1 className="text-2xl font-bold">Deal not found</h1>
        <Button onClick={() => navigate('/portal')}>Back to my deals</Button>
      </div>
    );
  }

  const open = (requests.data ?? []).filter((r) => r.status === 'open');
  const reading = deal.documents.some((d) => d.processingStatus === 'pending' || d.processingStatus === 'processing');
  const closed = deal.status === 'funded' || deal.status === 'declined';

  const send = async () => {
    if (!message.trim() || !user) return;
    setSending(true);
    const { error: err } = await supabase.from('deal_notes').insert({ deal_id: deal.id, content: message.trim(), created_by: user.id, is_internal: false });
    setSending(false);
    if (err) { toast({ title: 'Message not sent', description: err.message, variant: 'destructive' }); return; }
    setMessage('');
    qc.invalidateQueries({ queryKey: qk.deal(user.id, deal.id) });
  };

  return (
    <div className="flex flex-col h-full">
      <AppHeader title={`Deal ${deal.dealNumber}`} subtitle={`${deal.customer.firstName} ${deal.customer.lastName} · ${deal.vehicle.year || ''} ${deal.vehicle.make} ${deal.vehicle.model}`} />
      <div className="flex-1 overflow-y-auto p-4 lg:p-6 scrollbar-thin">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <Button variant="ghost" onClick={() => navigate('/portal')} className="-ml-2"><ArrowLeft className="h-4 w-4 mr-2" aria-hidden /> My deals</Button>
          <StatusBadge status={deal.status} size="lg" />
        </div>
        <StatusTracker status={deal.status} className="mb-2 pb-1" />
        <p className="text-sm text-muted-foreground mb-5">{STATUS_HELP[deal.status] ?? ''}</p>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          <div className="lg:col-span-3 space-y-4 min-w-0">
            {deal.status === 'funded' && (
              <Card className="border-accent/40">
                <CardContent className="flex items-center gap-3 p-4">
                  <CircleDollarSign className="h-8 w-8 text-accent shrink-0" aria-hidden />
                  <div>
                    <p className="font-semibold">${(deal.fundedAmount ?? deal.financingTerms.loanAmount).toLocaleString('en-CA')} funded</p>
                    {deal.fundedAt && <p className="text-sm text-muted-foreground">{format(new Date(deal.fundedAt), 'MMMM d, yyyy')}</p>}
                  </div>
                </CardContent>
              </Card>
            )}
            {deal.status === 'declined' && (
              <Card className="border-destructive/40">
                <CardContent className="flex items-start gap-3 p-4">
                  <XCircle className="h-6 w-6 text-destructive shrink-0" aria-hidden />
                  <div>
                    <p className="font-semibold">Declined</p>
                    {/* dealers only ever see the dealer message, never internal notes */}
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">{deal.dealerMessage || 'Contact us if you have questions about this decision.'}</p>
                  </div>
                </CardContent>
              </Card>
            )}
            {deal.status !== 'declined' && deal.dealerMessage && (
              <Card className="border-info/40">
                <CardContent className="flex items-start gap-3 p-4">
                  <Info className="h-5 w-5 text-info shrink-0 mt-0.5" aria-hidden />
                  <div>
                    <p className="font-semibold">Message from the lender</p>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">{deal.dealerMessage}</p>
                  </div>
                </CardContent>
              </Card>
            )}

            {requests.isError && <QueryError compact what="the document requests" error={requests.error} onRetry={() => requests.refetch()} />}
            {open.map((r) => (
              <Card key={r.id} className="border-warning/50">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base text-warning"><AlertTriangle className="h-4 w-4" aria-hidden /> {r.label} needed</CardTitle>
                  <CardDescription>
                    Requested {ago(r.created_at)}{r.message && r.message !== 'Missing from submission' ? ` — ${r.message}` : ''}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <DocumentUpload dealId={deal.id} defaultType={r.doc_type as DocumentType} compact submitLabel={`Send ${r.label}`} />
                </CardContent>
              </Card>
            ))}

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Documents</CardTitle>
                <CardDescription>Add anything else here — no need to sort or rename files.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {!closed && <DocumentUpload dealId={deal.id} compact />}
                <DocumentList dealId={deal.id} documents={deal.documents} staff={false} onView={setViewer} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><MessageSquare className="h-4 w-4" aria-hidden /> Messages</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {deal.notes.length === 0 && <p className="text-sm text-muted-foreground">No messages yet.</p>}
                <ul className="space-y-3">
                  {deal.notes.map((n) => (
                    <li key={n.id} className="border-l-2 border-muted pl-3">
                      <p className="text-sm whitespace-pre-wrap break-words">{n.content}</p>
                      <p className="text-xs text-muted-foreground mt-1">{n.createdBy} · {format(new Date(n.createdAt), 'MMM d, h:mm a')}</p>
                    </li>
                  ))}
                </ul>
                <Label htmlFor="portal-message" className="sr-only">Message to the lender</Label>
                <Textarea id="portal-message" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Write to the lender…" className="min-h-[70px]" />
                <div className="flex justify-end">
                  <Button onClick={send} disabled={sending || !message.trim()}>
                    {sending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden /> : <Send className="h-4 w-4 mr-2" aria-hidden />} Send
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="lg:col-span-2 space-y-4 min-w-0">
            <DealChecklistCard dealId={deal.id} staff={false} documentsReading={reading} />
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">Deal summary</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p className="flex items-center gap-2"><User className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden /> {deal.customer.firstName} {deal.customer.lastName}</p>
                <p className="flex items-center gap-2"><Car className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden /> {deal.vehicle.year || ''} {deal.vehicle.make} {deal.vehicle.model} {deal.vehicle.trim}</p>
                <p className="flex items-start gap-2"><Calculator className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" aria-hidden />
                  <span>${deal.financingTerms.loanAmount.toLocaleString('en-CA')} · {deal.financingTerms.apr}% · {deal.financingTerms.termMonths} mo · ${deal.financingTerms.monthlyPayment.toLocaleString('en-CA')}/mo</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  Submitted {format(new Date(deal.createdAt), 'MMM d, yyyy')} · {statusConfig(deal.status).label} since {ago(deal.statusChangedAt ?? deal.updatedAt, { addSuffix: false })}
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
        <PortalFooter />
      </div>
      <DocumentViewer open={!!viewer} onOpenChange={(o) => !o && setViewer(null)}
        document={viewer ? { id: viewer.id, name: viewer.name, mimeType: viewer.mimeType } : null} />
    </div>
  );
}
