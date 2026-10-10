import { useId, useState } from 'react';
import { CheckCircle2, AlertTriangle, FileWarning, Clock, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';
import { updateIncomeSource } from '@/hooks/use-income';
import { errorMessage } from '@/lib/rpc';
import { cn } from '@/lib/utils';
import type { IncomeVerificationStatus } from './IncomeSourceCard';

interface IncomeSourceActionsProps {
  sourceId: string;
  currentStatus: IncomeVerificationStatus;
  onUpdated: () => void;
}

const STATUS_OPTIONS: { value: IncomeVerificationStatus; label: string; icon: typeof CheckCircle2; className: string }[] = [
  { value: 'unverified', label: 'Unverified', icon: Clock, className: 'text-muted-foreground' },
  { value: 'verified', label: 'Verified', icon: CheckCircle2, className: 'text-success' },
  { value: 'flagged', label: 'Flagged', icon: AlertTriangle, className: 'text-warning' },
  { value: 'insufficient_docs', label: 'Insufficient docs', icon: FileWarning, className: 'text-destructive' },
  { value: 'needs_review', label: 'Needs review', icon: Clock, className: 'text-info' },
];

const REVIEW_FLAG = 'Review required — additional documentation needed';

export function IncomeSourceActions({ sourceId, currentStatus, onUpdated }: IncomeSourceActionsProps) {
  const { hasRole } = useAuth();
  const ids = useId();
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState<IncomeVerificationStatus>(currentStatus);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  // only income verifiers (and admins) may mark income verified — the database enforces it too
  const canVerify = hasRole('income_verifier');

  const handleSave = async () => {
    setSaving(true);
    try {
      const updates: Record<string, unknown> = { verification_status: status };
      if (status === 'verified') updates.verified_at = new Date().toISOString();
      if (status === 'flagged' || status === 'needs_review') {
        const { data: current } = await supabase.from('income_sources').select('flag_reasons').eq('id', sourceId).maybeSingle();
        const existing = (current?.flag_reasons as string[] | null) ?? [];
        const add = note.trim() || (status === 'needs_review' ? REVIEW_FLAG : '');
        if (add && !existing.includes(add)) updates.flag_reasons = [...existing, add];
      }
      await updateIncomeSource(sourceId, updates);
      toast({ title: `Status set to ${STATUS_OPTIONS.find((s) => s.value === status)?.label}` });
      setNote('');
      setExpanded(false);
      onUpdated();
    } catch (err) {
      toast({ title: 'Could not update the status', description: errorMessage(err), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const hasChanged = status !== currentStatus || note.trim().length > 0;

  return (
    <div className="border-t border-border pt-2 mt-2">
      <button type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-full">
        {expanded ? <ChevronUp className="h-3 w-3" aria-hidden /> : <ChevronDown className="h-3 w-3" aria-hidden />}
        Analyst actions
      </button>

      {expanded && (
        <div className="mt-2 space-y-2">
          <div className="space-y-1">
            <Label htmlFor={`${ids}-status`} className="text-xs">Verification status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as IncomeVerificationStatus)}>
              <SelectTrigger id={`${ids}-status`} className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((opt) => {
                  const Icon = opt.icon;
                  return (
                    <SelectItem key={opt.value} value={opt.value} disabled={opt.value === 'verified' && !canVerify}>
                      <span className={cn('flex items-center gap-1.5', opt.className)}><Icon className="h-3 w-3" aria-hidden />{opt.label}</span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            {!canVerify && <p className="text-[11px] text-muted-foreground">Only income verifiers can mark income verified.</p>}
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${ids}-note`} className="text-xs">{status === 'flagged' ? 'Flag reason' : 'Analyst note (optional)'}</Label>
            <Textarea id={`${ids}-note`} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder={status === 'flagged' ? 'Describe the flag reason…' : 'Optional'} className="text-xs min-h-[60px] resize-none" />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setExpanded(false); setStatus(currentStatus); setNote(''); }}>Cancel</Button>
            <Button type="button" size="sm" className="h-7 text-xs" onClick={handleSave} disabled={saving || !hasChanged}>
              {saving && <Loader2 className="h-3 w-3 animate-spin mr-1" aria-hidden />}{saving ? 'Saving…' : 'Update status'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
