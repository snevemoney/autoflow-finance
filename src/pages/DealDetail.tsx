import { useParams, useNavigate } from 'react-router-dom';
import { AppHeader } from '@/components/layout/AppHeader';
import { StatusBadge } from '@/components/deals/StatusBadge';
import { DealTimeline } from '@/components/deals/DealTimeline';
import { DocumentUpload } from '@/components/deals/DocumentUpload';
import { DocumentViewer } from '@/components/deals/DocumentViewer';
import { DocumentList } from '@/components/deals/DocumentList';
import { DealChecklistCard } from '@/components/deals/DealChecklistCard';
import { DealDecisionPanel } from '@/components/deals/DealDecisionPanel';
import { StatusTracker } from '@/components/deals/StatusTracker';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/AuthContext';
import type { Document } from '@/types/deal';
import { DealSummaryCard } from '@/components/deals/DealSummaryCard';
import { IncomeVerificationCard } from '@/components/deals/IncomeVerificationCard';
import { EmployerVerificationCard } from '@/components/deals/EmployerVerificationCard';
import { ApplicantDebtsCard } from '@/components/deals/ApplicantDebtsCard';
import { type ExtractedData } from '@/components/deals/ExtractedDataBadge';
import type { IncomeSource } from '@/components/deals/IncomeSourceCard';
import type { ApplicantDebt } from '@/components/deals/ApplicantDebtsCard';
import { useDeal } from '@/hooks/use-deals';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  ArrowLeft,
  User,
  Car,
  DollarSign,
  Clock,
  Building2,
  CreditCard,
  Mail,
  Phone,
  MapPin,
  AlertCircle,
  Loader2,
  ArrowLeftRight,
  Lock,
  Users,
} from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { useState, useEffect } from 'react';
import { toast } from '@/hooks/use-toast';

export default function DealDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: deal, isLoading } = useDeal(id);
  const { user } = useAuth();
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const [noteShared, setNoteShared] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [viewerDoc, setViewerDoc] = useState<Document | null>(null);

  // Fetch extracted income data for this deal's documents
  const { data: extractedDataMap } = useQuery({
    queryKey: ['extracted-income-badges', deal?.id, deal?.documents.length, deal?.updatedAt],
    queryFn: async () => {
      if (!deal) return {};
      const { data, error } = await supabase
        .from('extracted_income_data')
        .select('*')
        .eq('deal_id', deal.id);
      if (error) throw error;
      const map: Record<string, ExtractedData> = {};
      (data ?? []).forEach((item: any) => { map[item.document_id] = item; });
      return map;
    },
    enabled: !!deal,
  });

  // Fetch income sources for risk computation
  const { data: incomeSources } = useQuery({
    queryKey: ['income-sources-detail', deal?.id],
    queryFn: async () => {
      if (!deal) return [];
      const { data, error } = await supabase
        .from('income_sources')
        .select('*')
        .eq('deal_id', deal.id);
      if (error) throw error;
      return (data ?? []) as IncomeSource[];
    },
    enabled: !!deal,
  });

  // Fetch applicant debts for risk computation
  const { data: applicantDebts } = useQuery({
    queryKey: ['applicant-debts', deal?.id],
    queryFn: async () => {
      if (!deal) return [];
      const { data, error } = await supabase
        .from('applicant_debts')
        .select('*')
        .eq('deal_id', deal.id);
      if (error) throw error;
      return (data ?? []) as ApplicantDebt[];
    },
    enabled: !!deal,
  });

  // Check if any income source uses vehicle for commercial work
  const hasVehicleForWork = incomeSources?.some(s => s.vehicle_for_work) ?? false;

  // Auto-decline deal when vehicle_for_work is detected
  useEffect(() => {
    if (!hasVehicleForWork || !deal) return;
    if (deal.status === 'declined' || deal.status === 'funded') return;

    const autoDecline = async () => {
      const { error } = await supabase
        .from('deals')
        .update({
          status: 'declined' as any,
          decision_notes: 'Auto-declined: Vehicle used for rideshare/commercial work. Ineligible per policy.',
          decision_at: new Date().toISOString(),
        })
        .eq('id', deal.id);

      if (!error) {
        toast({
          title: 'Deal Auto-Declined',
          description: 'Vehicle is used for rideshare/commercial work. Deal is ineligible per policy.',
          variant: 'destructive',
        });
      }
    };

    autoDecline();
  }, [hasVehicleForWork, deal?.id, deal?.status]);

  if (isLoading) {
    return (
      <div className="flex flex-col h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="mt-2 text-sm text-muted-foreground">Loading deal...</p>
      </div>
    );
  }

  if (!deal) {
    return (
      <div className="flex flex-col h-full items-center justify-center">
        <h1 className="text-2xl font-bold mb-4">Deal Not Found</h1>
        <Button onClick={() => navigate('/deals')}>Back to Deals</Button>
      </div>
    );
  }

  const handleAddNote = async () => {
    if (!note.trim() || !user) return;
    setSavingNote(true);
    const { error } = await supabase.from('deal_notes').insert({
      deal_id: deal.id, content: note.trim(), created_by: user.id, is_internal: !noteShared,
    });
    setSavingNote(false);
    if (error) {
      toast({ title: 'Could not add note', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: noteShared ? 'Message sent to the dealer' : 'Internal note added' });
    setNote('');
    qc.invalidateQueries({ queryKey: ['deal', deal.id] });
  };

  const documentsReading = deal.documents.some((d) => d.processingStatus === 'pending' || d.processingStatus === 'processing');
  const incomeTotal = incomeSources?.length ?? 0;
  const incomeVerified = incomeSources?.filter((s) => s.verification_status === 'verified').length ?? 0;

  const getCreditTierBadge = () => {
    if (!deal.creditInfo) return null;
    const tier = deal.creditInfo.tier;
    return (
      <span
        className={cn(
          'status-badge',
          tier === 'prime' && 'bg-success/10 text-success',
          tier === 'near_prime' && 'bg-info/10 text-info',
          tier === 'subprime' && 'bg-warning/10 text-warning',
          tier === 'deep_subprime' && 'bg-destructive/10 text-destructive'
        )}
      >
        {tier.replace('_', ' ')}
      </span>
    );
  };

  return (
    <div className="flex flex-col h-full">
      <AppHeader
        title={`Deal ${deal.dealNumber}`}
        subtitle={`${deal.customer.firstName} ${deal.customer.lastName}`}
      />

      <div className="flex-1 overflow-y-auto p-4 lg:p-6 scrollbar-thin">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <Button variant="ghost" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <div className="flex items-center gap-3">
            <StatusBadge status={deal.status} size="lg" />
            {hasVehicleForWork && deal.status !== 'declined' && (
              <span className="text-sm font-medium text-destructive">
                Auto-declining — commercial vehicle use detected
              </span>
            )}
          </div>
        </div>
        <StatusTracker status={deal.status} className="mb-4 pb-1" />

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          {/* Main Content */}
          <div className="lg:col-span-3 space-y-4">
            {/* Income Verification */}
            <IncomeVerificationCard deal={deal} />

            <Tabs defaultValue="overview">
              <TabsList>
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="documents">
                  Documents ({deal.documents.length})
                </TabsTrigger>
                <TabsTrigger value="notes">Notes</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="space-y-4 mt-4">
                {/* Customer Info */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <User className="h-5 w-5" />
                      Customer Information
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-sm text-muted-foreground">Full Name</p>
                        <p className="font-medium">
                          {deal.customer.firstName} {deal.customer.lastName}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Email</p>
                        <p className="font-medium flex items-center gap-1">
                          <Mail className="h-3 w-3" />
                          {deal.customer.email}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Phone</p>
                        <p className="font-medium flex items-center gap-1">
                          <Phone className="h-3 w-3" />
                          {deal.customer.phone}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Address</p>
                        <p className="font-medium flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          {deal.customer.address.city}, {deal.customer.address.state}
                        </p>
                      </div>
                      {deal.customer.employmentInfo && (
                        <>
                          <div>
                            <p className="text-sm text-muted-foreground">Employer</p>
                            <p className="font-medium">
                              {deal.customer.employmentInfo.employer}
                            </p>
                          </div>
                          <div>
                            <p className="text-sm text-muted-foreground">
                              Monthly Income
                            </p>
                            <p className="font-medium">
                              ${deal.customer.employmentInfo.monthlyIncome.toLocaleString()}
                            </p>
                          </div>
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* Vehicle Info */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Car className="h-5 w-5" />
                      Vehicle Information
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-sm text-muted-foreground">Vehicle</p>
                        <p className="font-medium">
                          {deal.vehicle.year} {deal.vehicle.make} {deal.vehicle.model}{' '}
                          {deal.vehicle.trim}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">VIN</p>
                        <p className="font-mono text-sm">{deal.vehicle.vin}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Condition</p>
                        <p className="font-medium capitalize">{deal.vehicle.condition}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Mileage</p>
                        <p className="font-medium">
                          {deal.vehicle.mileage.toLocaleString()} km
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Invoice Price</p>
                        <p className="font-medium">
                          ${deal.vehicle.invoicePrice.toLocaleString()}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Color</p>
                        <p className="font-medium">{deal.vehicle.color}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {deal.tradeIn && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <ArrowLeftRight className="h-5 w-5" />
                        Trade-In
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div><p className="text-muted-foreground">Vehicle</p><p className="font-medium">{deal.tradeIn.year} {deal.tradeIn.make} {deal.tradeIn.model}</p></div>
                        <div><p className="text-muted-foreground">VIN</p><p className="font-mono">{deal.tradeIn.vin}</p></div>
                        <div><p className="text-muted-foreground">Value</p><p className="font-medium">${deal.tradeIn.estimatedValue.toLocaleString()}</p></div>
                        <div><p className="text-muted-foreground">Payoff</p><p className="font-medium">${(deal.tradeIn.payoffAmount ?? 0).toLocaleString()}</p></div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Financing Terms */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <DollarSign className="h-5 w-5" />
                      Financing Terms
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="text-center p-4 rounded-lg bg-muted">
                        <p className="text-2xl font-bold">
                          ${deal.financingTerms.loanAmount.toLocaleString()}
                        </p>
                        <p className="text-sm text-muted-foreground">Loan Amount</p>
                      </div>
                      <div className="text-center p-4 rounded-lg bg-muted">
                        <p className="text-2xl font-bold">
                          {deal.financingTerms.apr}%
                        </p>
                        <p className="text-sm text-muted-foreground">APR</p>
                      </div>
                      <div className="text-center p-4 rounded-lg bg-muted">
                        <p className="text-2xl font-bold">
                          {deal.financingTerms.termMonths}
                        </p>
                        <p className="text-sm text-muted-foreground">Months</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4 mt-4">
                      <div>
                        <p className="text-sm text-muted-foreground">Down Payment</p>
                        <p className="font-medium">
                          ${deal.financingTerms.downPayment.toLocaleString()}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Monthly Payment</p>
                        <p className="font-medium">
                          ${deal.financingTerms.monthlyPayment.toLocaleString()}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Total Interest</p>
                        <p className="font-medium">
                          ${deal.financingTerms.totalInterest.toLocaleString()}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">LTV Ratio</p>
                        <p className="font-medium">{deal.ltv}%</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="documents" className="mt-4 space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Upload Documents</CardTitle>
                    <CardDescription>
                      Drop files in any order — AutoFlow sorts them, reads income documents and updates the checklist.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <DocumentUpload dealId={deal.id} />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Documents ({deal.documents.length})</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <DocumentList
                      dealId={deal.id}
                      documents={deal.documents}
                      staff
                      extractions={extractedDataMap}
                      onView={setViewerDoc}
                    />
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="notes" className="mt-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Add Note</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Textarea
                      placeholder={noteShared ? 'Message to the dealer…' : 'Internal note (staff only)…'}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      className="mb-3"
                    />
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-sm">
                        <Switch id="note-shared" checked={noteShared} onCheckedChange={setNoteShared} />
                        <Label htmlFor="note-shared">Visible to dealer</Label>
                      </div>
                      <Button onClick={handleAddNote} disabled={savingNote || !note.trim()}>
                        {savingNote && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                        {noteShared ? 'Send to dealer' : 'Add note'}
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                <Card className="mt-4">
                  <CardHeader>
                    <CardTitle>Notes History</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {deal.notes.length > 0 ? (
                      <div className="space-y-4">
                        {deal.notes.map((note) => (
                          <div key={note.id} className="border-l-2 border-muted pl-4">
                            <p className="text-sm whitespace-pre-wrap">{note.content}</p>
                            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                              {note.isInternal ? <Lock className="h-3 w-3" /> : <Users className="h-3 w-3" />}
                              {note.isInternal ? 'Internal' : 'Shared with dealer'} • {note.createdBy} •{' '}
                              {format(new Date(note.createdAt), 'MMM d, yyyy h:mm a')}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">No notes yet</p>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>

          {/* Sidebar */}
          <div className="lg:col-span-2 space-y-4">
            <DealDecisionPanel
              deal={deal}
              incomeVerified={incomeVerified}
              incomeTotal={incomeTotal}
              blockedReason={hasVehicleForWork ? 'Vehicle is used for rideshare/commercial work — ineligible per policy.' : null}
            />

            <DealChecklistCard dealId={deal.id} documentsReading={documentsReading} />

            {/* Deal Summary */}
            <DealSummaryCard deal={deal} incomeSources={incomeSources} debts={applicantDebts} />

            {/* Applicant Debts */}
            <ApplicantDebtsCard dealId={deal.id} customerId={deal.customer.id} />

            {/* Employer Verification */}
            {deal.customer.employmentInfo && (
              <EmployerVerificationCard
                employer={deal.customer.employmentInfo.employer}
                city={deal.customer.address.city}
                state={deal.customer.address.state}
                customerId={deal.customer.id}
              />
            )}

            {/* Credit Info */}
            {deal.creditInfo && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <CreditCard className="h-5 w-5" />
                    Credit Information
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-center mb-4">
                    <p className="text-4xl font-bold">{deal.creditInfo.score}</p>
                    {getCreditTierBadge()}
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Bureau</span>
                      <span className="capitalize">{deal.creditInfo.bureau}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Pulled</span>
                      <span>
                        {format(new Date(deal.creditInfo.pulledAt), 'MMM d, yyyy')}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Dealer Info */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="h-5 w-5" />
                  Dealer
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="font-medium">{deal.dealerName}</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Contact: {deal.dealerContact}
                </p>
              </CardContent>
            </Card>

            {/* Flags */}
            {deal.flags.length > 0 && (
              <Card className="border-warning">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-warning">
                    <AlertCircle className="h-5 w-5" />
                    Attention Required
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {deal.flags.map((flag, i) => (
                      <li
                        key={i}
                        className="flex items-center gap-2 text-sm text-warning"
                      >
                        <AlertCircle className="h-4 w-4" />
                        {flag}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {/* Timeline */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-5 w-5" />
                  Activity Timeline
                </CardTitle>
              </CardHeader>
              <CardContent>
                <DealTimeline events={deal.timeline} />
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Document Viewer Dialog */}
      <DocumentViewer
        open={!!viewerDoc}
        onOpenChange={(open) => !open && setViewerDoc(null)}
        document={viewerDoc ? { name: viewerDoc.name, fileUrl: viewerDoc.fileUrl, type: viewerDoc.type, storagePath: viewerDoc.storagePath, mimeType: viewerDoc.mimeType } : null}
      />
    </div>
  );
}
