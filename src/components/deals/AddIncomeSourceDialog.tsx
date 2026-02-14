import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import type { IncomeSourceType } from './IncomeSourceCard';

interface AddIncomeSourceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dealId: string;
  customerId: string;
  onAdded: () => void;
}

const SOURCE_TYPES: { value: IncomeSourceType; label: string }[] = [
  { value: 'salaried', label: 'Salaried (W-2)' },
  { value: 'part_time', label: 'Part-Time / Hourly' },
  { value: 'self_employed', label: 'Self-Employed / Business Owner' },
  { value: 'contractor', label: 'Contractor (1099)' },
  { value: 'seasonal', label: 'Seasonal' },
  { value: 'education', label: 'Education / School Employee' },
  { value: 'unemployed', label: 'Unemployed' },
  { value: 'pension', label: 'Pension / Retirement' },
  { value: 'government_assistance', label: 'Government Assistance' },
];

export function AddIncomeSourceDialog({ open, onOpenChange, dealId, customerId, onAdded }: AddIncomeSourceDialogProps) {
  const [sourceType, setSourceType] = useState<IncomeSourceType>('salaried');
  const [employerName, setEmployerName] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [statedIncome, setStatedIncome] = useState('');
  const [payFrequency, setPayFrequency] = useState('monthly');
  const [hoursPerWeek, setHoursPerWeek] = useState('');
  const [hourlyRate, setHourlyRate] = useState('');
  const [contractMonths, setContractMonths] = useState('10');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!employerName || !statedIncome) return;
    setSaving(true);

    const stated = parseFloat(statedIncome);
    let calculated: number | null = null;

    // Auto-calculate for hourly
    if (sourceType === 'part_time' && hoursPerWeek && hourlyRate) {
      calculated = Math.round(parseFloat(hoursPerWeek) * parseFloat(hourlyRate) * 4.33);
    }

    // Fraud flags
    const flags: string[] = [];
    if (stated > 0 && stated % 1000 === 0) flags.push('Round number suspicion');

    try {
      // Validate IDs are valid UUIDs for database insertion
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const validDealId = uuidRegex.test(dealId) ? dealId : crypto.randomUUID();
      const validCustomerId = uuidRegex.test(customerId) ? customerId : crypto.randomUUID();

      const { error } = await supabase.from('income_sources').insert({
        deal_id: validDealId,
        customer_id: validCustomerId,
        source_type: sourceType,
        employer_name: employerName,
        job_title: jobTitle || null,
        stated_monthly_income: stated,
        calculated_monthly_income: calculated,
        pay_frequency: payFrequency,
        contract_months: sourceType === 'education' ? parseInt(contractMonths) || null : null,
        hours_per_week: sourceType === 'part_time' ? parseFloat(hoursPerWeek) || null : null,
        hourly_rate: sourceType === 'part_time' ? parseFloat(hourlyRate) || null : null,
        is_primary: false,
        flag_reasons: flags,
      });

      if (error) throw error;
      toast({ title: 'Income source added' });
      onAdded();
      onOpenChange(false);
      // Reset
      setEmployerName('');
      setJobTitle('');
      setStatedIncome('');
      setHoursPerWeek('');
      setHourlyRate('');
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Income Source</DialogTitle>
          <DialogDescription>Add a new income source for this applicant.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Income Type</Label>
            <Select value={sourceType} onValueChange={(v) => setSourceType(v as IncomeSourceType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {SOURCE_TYPES.map(t => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Employer / Business Name</Label>
            <Input value={employerName} onChange={e => setEmployerName(e.target.value)} placeholder="e.g. Acme Corp" />
          </div>

          <div className="space-y-2">
            <Label>Job Title (optional)</Label>
            <Input value={jobTitle} onChange={e => setJobTitle(e.target.value)} placeholder="e.g. Software Engineer" />
          </div>

          <div className="space-y-2">
            <Label>Stated Monthly Income ($)</Label>
            <Input type="number" value={statedIncome} onChange={e => setStatedIncome(e.target.value)} placeholder="5000" />
          </div>

          <div className="space-y-2">
            <Label>Pay Frequency</Label>
            <Select value={payFrequency} onValueChange={setPayFrequency}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="biweekly">Biweekly</SelectItem>
                <SelectItem value="semimonthly">Semimonthly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
                <SelectItem value="annual">Annual</SelectItem>
                <SelectItem value="contract">Contract</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Dynamic fields */}
          {sourceType === 'part_time' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Hours / Week</Label>
                <Input type="number" value={hoursPerWeek} onChange={e => setHoursPerWeek(e.target.value)} placeholder="25" />
              </div>
              <div className="space-y-2">
                <Label>Hourly Rate ($)</Label>
                <Input type="number" value={hourlyRate} onChange={e => setHourlyRate(e.target.value)} placeholder="18" />
              </div>
            </div>
          )}

          {sourceType === 'education' && (
            <div className="space-y-2">
              <Label>Contract Months (e.g. 10 for school year)</Label>
              <Input type="number" value={contractMonths} onChange={e => setContractMonths(e.target.value)} placeholder="10" />
            </div>
          )}

          {(sourceType === 'pension' || sourceType === 'government_assistance') && (
            <p className="text-xs text-muted-foreground">
              {sourceType === 'pension' ? 'Enter the monthly pension or retirement benefit amount as stated income.' : 'Enter the monthly government benefit amount (SSI, SSDI, SNAP, etc.) as stated income.'}
            </p>
          )}

          {sourceType === 'unemployed' && (
            <p className="text-xs text-muted-foreground">
              Enter any unemployment benefits received monthly. If none, enter 0.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !employerName || !statedIncome}>
            {saving ? 'Saving...' : 'Add Source'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
