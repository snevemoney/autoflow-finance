import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Building2, CheckCircle2, XCircle, Loader2, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { invokeFunction } from '@/lib/http';

interface EmployerVerificationCardProps {
  employer: string;
  city?: string;
  state?: string;
  customerId?: string;
  initialVerified?: boolean;
  initialData?: Record<string, unknown> | null;
}

interface VerificationResult {
  verified: boolean;
  confidence: string;
  businessType?: string;
  yearsInOperation?: string;
  summary?: string;
}

export function EmployerVerificationCard({
  employer,
  city,
  state,
  customerId,
  initialVerified = false,
  initialData = null,
}: EmployerVerificationCardProps) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<VerificationResult | null>(
    initialData ? (initialData as unknown as VerificationResult) : null
  );
  const [verified, setVerified] = useState(initialVerified);

  const handleVerify = async () => {
    if (!employer) return;
    setLoading(true);
    try {
      const verificationResult = await invokeFunction<VerificationResult>('verify-employer', {
        employer,
        city,
        state,
      });
      setResult(verificationResult);
      setVerified(verificationResult.verified);

      // Cache result on customer if customerId provided
      if (customerId) {
        const { error: cacheError } = await supabase
          .from('customers')
          .update({
            employer_verified: verificationResult.verified,
            employer_verification_data: JSON.parse(JSON.stringify(verificationResult)),
          })
          .eq('id', customerId);
        if (cacheError) {
          toast({
            title: 'Verified, but cache failed',
            description: cacheError.message,
            variant: 'destructive',
          });
        }
      }

      toast({
        title: verificationResult.verified ? 'Employer Verified' : 'Verification Flagged',
        description: verificationResult.summary || 'Verification complete.',
      });
    } catch (e) {
      console.error('Employer verification error:', e);
      toast({
        title: 'Verification Failed',
        description: 'Could not verify employer. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const StatusIcon = verified ? CheckCircle2 : result ? XCircle : AlertTriangle;
  const statusColor = verified
    ? 'text-success'
    : result
      ? 'text-destructive'
      : 'text-muted-foreground';

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Building2 className="h-5 w-5" />
          Employer Verification
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          <StatusIcon className={cn('h-5 w-5', statusColor)} />
          <div>
            <p className="font-medium text-sm">{employer}</p>
            {city && state && (
              <p className="text-xs text-muted-foreground">{city}, {state}</p>
            )}
          </div>
        </div>

        {result && (
          <div className={cn(
            'p-3 rounded-lg border text-sm space-y-1',
            verified ? 'bg-success/5 border-success/20' : 'bg-destructive/5 border-destructive/20'
          )}>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Status</span>
              <span className={cn('font-medium', verified ? 'text-success' : 'text-destructive')}>
                {verified ? 'Verified' : 'Flagged'}
              </span>
            </div>
            {result.confidence && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Confidence</span>
                <span className="font-medium capitalize">{result.confidence}</span>
              </div>
            )}
            {result.businessType && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Type</span>
                <span className="font-medium">{result.businessType}</span>
              </div>
            )}
            {result.yearsInOperation && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Years</span>
                <span className="font-medium">{result.yearsInOperation}</span>
              </div>
            )}
            {result.summary && (
              <p className="text-xs text-muted-foreground pt-1 border-t mt-2">{result.summary}</p>
            )}
          </div>
        )}

        {!result && (
          <Button
            onClick={handleVerify}
            disabled={loading || !employer}
            variant="outline"
            size="sm"
            className="w-full"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Verifying...
              </>
            ) : (
              'Verify Employer'
            )}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
