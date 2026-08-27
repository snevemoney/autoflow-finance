import { useParams, useNavigate } from 'react-router-dom';
import { AppHeader } from '@/components/layout/AppHeader';
import { StatusBadge } from '@/components/deals/StatusBadge';
import { DealTimeline } from '@/components/deals/DealTimeline';
import { DocumentUpload } from '@/components/deals/DocumentUpload';
import { DocumentViewer } from '@/components/deals/DocumentViewer';
import { DealSummaryCard } from '@/components/deals/DealSummaryCard';
import { IncomeVerificationCard } from '@/components/deals/IncomeVerificationCard';
import { EmployerVerificationCard } from '@/components/deals/EmployerVerificationCard';
import { ApplicantDebtsCard } from '@/components/deals/ApplicantDebtsCard';
import { ExtractedDataBadge, type ExtractedData } from '@/components/deals/ExtractedDataBadge';
import type { IncomeSource } from '@/components/deals/IncomeSourceCard';
import type { ApplicantDebt } from '@/components/deals/ApplicantDebtsCard';
import { useDeal } from '@/hooks/use-deals';
import { QueryError } from '@/components/QueryError';
import { isUuid } from '@/lib/guards';
import { isIncomeDocType } from '@/lib/income';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
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
  FileText,
  Clock,
  Building2,
  CreditCard,
  Mail,
  Phone,
  MapPin,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { useState, useEffect } from 'react';
import { toast } from '@/hooks/use-toast';

export default function DealDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: deal, isLoading, isError, error, refetch } = useDeal(id);
  const [note, setNote] = useState('');
  const [viewerDoc, setViewerDoc] = useState<{ name: string; fileUrl: string; type: string } | null>(null);

  // Fetch extracted income data for this deal's documents
  const { data: extractedDataMap } = useQuery({
    queryKey: ['extracted-income-badges', deal?.id],
    queryFn: async () => {
      if (!deal) return {};
      const { data, error } = await supabase
        .from('extracted_income_data')
        .select('*')
        .eq('deal_id', deal.id)
        .limit(100);
      if (error) throw error;
      const map: Record<string, ExtractedData> = {};
      (data ?? []).forEach((item: any) => { map[item.document_id] = item; });
      return map;
    },
    enabled: !!deal,
  });

  // Fetch income sources for risk computation
  const { data: incomeSources } = useQuery({
    queryKey: ['income-sources', deal?.id],
    queryFn: async () => {
      if (!deal) return [];
      const { data, error } = await supabase
        .from('income_sources')
        .select('*')
        .eq('deal_id', deal.id)
        .limit(100);
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
        .eq('deal_id', deal.id)
        .limit(100);
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

      if (error) {
        toast({
          title: 'Auto-decline failed',
          description: error.message,
          variant: 'destructive',
        });
        return;
      }
      toast({
        title: 'Deal Auto-Declined',
        description: 'Vehicle is used for rideshare/commercial work. Deal is ineligible per policy.',
        variant: 'destructive',
      });
    };

    autoDecline();
  }, [hasVehicleForWork, deal?.id, deal?.status]);

  if (id && !isUuid(id)) {
    return (
      <div className="flex flex-col h-full items-center justify-center">
        <h1 className="text-2xl font-bold mb-4">Invalid deal</h1>
        <Button onClick={() => navigate('/deals')}>Back to Deals</Button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex flex-col h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="mt-2 text-sm text-muted-foreground">Loading deal...</p>
      </div>
    );
  }

  if (isError) {
    return (
      <QueryError
        message={error instanceof Error ? error.message : 'Could not load this deal.'}
        onRetry={() => refetch()}
      />
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

  const handleApprove = () => {
    if (hasVehicleForWork) {
      toast({
        title: 'Approval Blocked',
        description: 'Cannot approve — vehicle is used for rideshare/commercial work.',
        variant: 'destructive',
      });
      return;
    }
    toast({
      title: 'Deal Approved',
      description: 'The deal has been moved to funding review.',
    });
  };

  const handleDecline = () => {
    toast({
      title: 'Deal Declined',
      description: 'The deal has been declined.',
      variant: 'destructive',
    });
  };

  const handleAddNote = () => {
    if (!note.trim()) return;
    toast({
      title: 'Note Added',
      description: 'Your note has been added to the deal.',
    });
    setNote('');
  };

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
        {/* Header Actions */}
        <div className="flex items-center justify-between mb-4">
          <Button variant="ghost" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <div className="flex items-center gap-3">
            <StatusBadge status={deal.status} size="lg" />
            {deal.status !== 'funded' && deal.status !== 'declined' && !hasVehicleForWork && (
              <>
                <Button variant="outline" onClick={handleDecline}>
                  <XCircle className="h-4 w-4 mr-2" />
                  Decline
                </Button>
                <Button onClick={handleApprove}>
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Approve
                </Button>
              </>
            )}
            {hasVehicleForWork && deal.status !== 'declined' && (
              <span className="text-sm font-medium text-destructive">
                Auto-declining — commercial vehicle use detected
              </span>
            )}
          </div>
        </div>

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
                          {deal.vehicle.mileage.toLocaleString()} miles
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

              <TabsContent value="documents" className="mt-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Upload Documents</CardTitle>
                    <CardDescription>
                      Drag and drop files or click to browse
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <DocumentUpload />
                  </CardContent>
                </Card>

                <Card className="mt-6">
                  <CardHeader>
                    <CardTitle>Uploaded Documents</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {deal.documents.map((doc) => (
                        <div
                          key={doc.id}
                          className="document-item"
                          onClick={() => setViewerDoc({ name: doc.name, fileUrl: doc.fileUrl, type: doc.type })}
                        >
                          <div className="flex h-10 w-10 items-center justify-center rounded bg-muted">
                            <FileText className="h-5 w-5 text-muted-foreground" />
                          </div>
                          <div className="flex-1">
                            <p className="font-medium text-sm">{doc.name}</p>
                            <p className="text-xs text-muted-foreground">
                              Uploaded{' '}
                              {format(new Date(doc.uploadedAt), 'MMM d, yyyy')}
                            </p>
                          </div>
                          <span
                            className={cn(
                              'status-badge',
                              doc.status === 'verified' &&
                                'bg-success/10 text-success',
                              doc.status === 'pending' &&
                                'bg-warning/10 text-warning',
                              doc.status === 'rejected' &&
                                'bg-destructive/10 text-destructive'
                            )}
                          >
                            {doc.status}
                          </span>
                          <ExtractedDataBadge
                            extraction={extractedDataMap?.[doc.id] ?? null}
                            isIncomeDoc={isIncomeDocType(doc.type)}
                          />
                        </div>
                      ))}
                    </div>
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
                      placeholder="Add a note to this deal..."
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      className="mb-3"
                    />
                    <Button onClick={handleAddNote}>Add Note</Button>
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
                            <p className="text-sm">{note.content}</p>
                            <p className="text-xs text-muted-foreground mt-1">
                              {note.createdBy} •{' '}
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
        document={viewerDoc}
      />
    </div>
  );
}
