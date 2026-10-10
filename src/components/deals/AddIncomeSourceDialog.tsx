import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { errorMessage } from '@/lib/rpc';
import { monthlyFromHourly, parseAmount } from '@/lib/income-math';
import type { IncomeSourceType } from './IncomeSourceCard';

const RIDESHARE_EMPLOYERS = [
  'uber', 'lyft', 'doordash', 'grubhub', 'instacart', 'amazon flex',
  'postmates', 'spark driver', 'gopuff', 'shipt', 'roadie',
];

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
  const [vehicleForWork, setVehicleForWork] = useState(false);
  const [rideshareDetected, setRideshareDetected] = useState(false);
  const [saving, setSaving] = useState(false);

  const isBenefitType = sourceType === 'government_assistance' || sourceType === 'unemployed';

  // Auto-detect rideshare employers
  useEffect(() => {
    const isRideshare = RIDESHARE_EMPLOYERS.some(r => employerName.toLowerCase().trim().includes(r));
    setRideshareDetected(isRideshare);
    if (isRideshare) setVehicleForWork(true);
  }, [employerName]);

  const handleSave = async () => {
    if (!employerName || !statedIncome) return;
    setSaving(true);

    const stated = parseAmount(statedIncome);
    if (!Number.isFinite(stated) || stated < 0) {
      toast({ title: 'Enter the stated monthly income (0 or more)', variant: 'destructive' });
      setSaving(false);
      return;
    }
    // hourly sources start from rate × hours × 52 / 12
    const calculated = sourceType === 'part_time' ? monthlyFromHourly(parseAmount(hourlyRate), parseAmount(hoursPerWeek)) : null;

    // Fraud flags
    const flags: string[] = [];
    if (stated > 0 && stated % 1000 === 0) flags.push('Round number suspicion');

    try {
      const { error } = await supabase.from('income_sources').insert({
        deal_id: dealId,
        customer_id: customerId,
        source_type: sourceType,
        employer_name: employerName,
        job_title: jobTitle || null,
        stated_monthly_income: stated,
        calculated_monthly_income: calculated,
        pay_frequency: payFrequency,
        contract_months: sourceType === 'education' ? parseInt(contractMonths, 10) || null : null,
        hours_per_week: sourceType === 'part_time' ? parseAmount(hoursPerWeek) || null : null,
        hourly_rate: sourceType === 'part_time' ? parseAmount(hourlyRate) || null : null,
        is_primary: false,
        flag_reasons: vehicleForWork ? [...flags, 'Vehicle used for commercial/rideshare work'] : flags,
        vehicle_for_work: vehicleForWork,
        benefit_cap_applied: false,
        verification_status: vehicleForWork ? 'flagged' : (isBenefitType ? 'needs_review' : 'unverified'),
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
    } catch (err) {
      toast({ title: 'Could not add the income source', description: errorMessage(err), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1rem)] sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Income Source</DialogTitle>
          <DialogDescription>Add a new income source for this applicant.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="add-income-type">Income type</Label>
            <Select value={sourceType} onValueChange={(v) => setSourceType(v as IncomeSourceType)}>
              <SelectTrigger id="add-income-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SOURCE_TYPES.map(t => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="add-income-employer">Employer / business name</Label>
            <Input id="add-income-employer" value={employerName} onChange={e => setEmployerName(e.target.value)} placeholder="e.g. Acme Corp" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="add-income-title">Job title (optional)</Label>
            <Input id="add-income-title" value={jobTitle} onChange={e => setJobTitle(e.target.value)} placeholder="e.g. Software Engineer" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="add-income-stated">Stated monthly income ($)</Label>
            <Input id="add-income-stated" inputMode="decimal" value={statedIncome} onChange={e => setStatedIncome(e.target.value)} placeholder="5000" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="add-income-frequency">Pay frequency</Label>
            <Select value={payFrequency} onValueChange={setPayFrequency}>
              <SelectTrigger id="add-income-frequency"><SelectValue /></SelectTrigger>
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
                <Label htmlFor="add-income-hours">Hours per week</Label>
                <Input id="add-income-hours" inputMode="decimal" value={hoursPerWeek} onChange={e => setHoursPerWeek(e.target.value)} placeholder="25" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="add-income-rate">Hourly rate ($)</Label>
                <Input id="add-income-rate" inputMode="decimal" value={hourlyRate} onChange={e => setHourlyRate(e.target.value)} placeholder="18" />
              </div>
            </div>
          )}

          {sourceType === 'education' && (
            <div className="space-y-2">
              <Label htmlFor="add-income-contract">Contract months (e.g. 10 for a school year)</Label>
              <Input id="add-income-contract" inputMode="numeric" value={contractMonths} onChange={e => setContractMonths(e.target.value)} placeholder="10" />
            </div>
          )}

          {(sourceType === 'pension' || sourceType === 'government_assistance') && (
            <p className="text-xs text-muted-foreground">
              {sourceType === 'pension' ? 'Enter the monthly pension or retirement benefit amount as stated income.' : 'Enter the monthly government benefit amount (SSI, SSDI, SNAP, etc.) as stated income. An analyst will review and set the qualifying percentage.'}
            </p>
          )}

          {sourceType === 'unemployed' && (
            <p className="text-xs text-muted-foreground">
              Enter any unemployment benefits received monthly. If none, enter 0. An analyst will review and set the qualifying percentage.
            </p>
          )}

          {/* Vehicle for work checkbox */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id="vehicle-for-work"
                checked={vehicleForWork}
                onCheckedChange={(checked) => setVehicleForWork(checked === true)}
              />
              <Label htmlFor="vehicle-for-work" className="text-sm cursor-pointer">
                Applicant uses vehicle for work (rideshare, delivery, etc.)
              </Label>
            </div>
            {rideshareDetected && (
              <div className="flex items-center gap-1.5 text-xs text-destructive bg-destructive/10 rounded-md px-2 py-1.5 border border-destructive/20">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                This employer is a known rideshare/delivery service. Vehicle-for-work deals are not eligible.
              </div>
            )}
            {vehicleForWork && !rideshareDetected && (
              <p className="text-xs text-warning">
                ⚠️ This source will be flagged as ineligible due to commercial vehicle use.
              </p>
            )}
          </div>
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
