import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CheckCircle2, AlertTriangle, FileWarning, Clock, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
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
  { value: 'insufficient_docs', label: 'Insufficient Docs', icon: FileWarning, className: 'text-destructive' },
  { value: 'needs_review', label: 'Needs Review', icon: Clock, className: 'text-info' },
];

export function IncomeSourceActions({ sourceId, currentStatus, onUpdated }: IncomeSourceActionsProps) {
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState<IncomeVerificationStatus>(currentStatus);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const updates: Record<string, unknown> = {
        verification_status: status,
        updated_at: new Date().toISOString(),
      };

      if (status === 'verified') {
        updates.verified_at = new Date().toISOString();
      }

      // If needs_review, auto-populate note about additional docs
      if (status === 'needs_review' && !note.trim()) {
        const { data: current } = await supabase
          .from('income_sources')
          .select('flag_reasons')
          .eq('id', sourceId)
          .single();
        const existing = (current?.flag_reasons as string[]) || [];
        if (!existing.includes('Review required — additional documentation needed')) {
          updates.flag_reasons = [...existing, 'Review required — additional documentation needed'];
        }
      }

      // If flagging, append note as a flag reason
      if ((status === 'flagged' || status === 'needs_review') && note.trim()) {
        const { data: current } = await supabase
          .from('income_sources')
          .select('flag_reasons')
          .eq('id', sourceId)
          .single();

        const existing = (current?.flag_reasons as string[]) || [];
        if (!existing.includes(note.trim())) {
          updates.flag_reasons = [...existing, note.trim()];
        }
      }

      const { error } = await supabase
        .from('income_sources')
        .update(updates)
        .eq('id', sourceId);

      if (error) throw error;

      toast({ title: `Status updated to ${STATUS_OPTIONS.find(s => s.value === status)?.label}` });
      setNote('');
      setExpanded(false);
      onUpdated();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const hasChanged = status !== currentStatus || note.trim().length > 0;

  return (
    <div className="border-t border-border pt-2 mt-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
      >
        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        Analyst Actions
      </button>

      {expanded && (
        <div className="mt-2 space-y-2">
          <Select value={status} onValueChange={(v) => setStatus(v as IncomeVerificationStatus)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map(opt => {
                const Icon = opt.icon;
                return (
                  <SelectItem key={opt.value} value={opt.value}>
                    <span className={cn('flex items-center gap-1.5', opt.className)}>
                      <Icon className="h-3 w-3" />
                      {opt.label}
                    </span>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>

          <Textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder={status === 'flagged' ? 'Describe the flag reason...' : 'Analyst note (optional)...'}
            className="text-xs min-h-[60px] resize-none"
          />

          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setExpanded(false); setStatus(currentStatus); setNote(''); }}>
              Cancel
            </Button>
            <Button size="sm" className="h-7 text-xs" onClick={handleSave} disabled={saving || !hasChanged}>
              {saving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
              {saving ? 'Saving...' : 'Update Status'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
