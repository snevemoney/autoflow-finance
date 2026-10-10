import { useId, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useApplicantDebts } from '@/hooks/use-income';
import { qk } from '@/lib/query-keys';
import { errorMessage } from '@/lib/rpc';
import { QueryError } from '@/components/QueryError';
import { Scale, Plus, Trash2, Gavel, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';

export type DebtType = 'garnishment' | 'child_support' | 'auto_loan' | 'student_loan' | 'credit_card' | 'mortgage' | 'medical' | 'rent' | 'other';

export interface ApplicantDebt {
  id: string;
  deal_id: string;
  customer_id: string;
  debt_type: DebtType;
  creditor_name: string;
  monthly_payment: number;
  total_balance: number | null;
  months_remaining: number | null;
  is_court_ordered: boolean;
  notes: string | null;
  created_at: string;
  created_by: string | null;
}

const DEBT_TYPE_LABELS: Record<DebtType, string> = {
  garnishment: 'Garnishment',
  child_support: 'Child Support',
  auto_loan: 'Auto Loan',
  student_loan: 'Student Loan',
  credit_card: 'Credit Card',
  mortgage: 'Mortgage',
  medical: 'Medical',
  rent: 'Rent/Housing',
  other: 'Other',
};

const DEBT_TYPE_COLORS: Record<DebtType, string> = {
  garnishment: 'bg-destructive/10 text-destructive border-destructive/30',
  child_support: 'bg-destructive/10 text-destructive border-destructive/30',
  auto_loan: 'bg-info/10 text-info border-info/30',
  student_loan: 'bg-info/10 text-info border-info/30',
  credit_card: 'bg-warning/10 text-warning border-warning/30',
  mortgage: 'bg-muted text-muted-foreground border-border',
  medical: 'bg-warning/10 text-warning border-warning/30',
  rent: 'bg-accent text-accent-foreground border-border',
  other: 'bg-muted text-muted-foreground border-border',
};

interface ApplicantDebtsCardProps {
  dealId: string;
  customerId: string;
}

export function ApplicantDebtsCard({ dealId, customerId }: ApplicantDebtsCardProps) {
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    debt_type: '' as DebtType | '',
    creditor_name: '',
    monthly_payment: '',
    total_balance: '',
    months_remaining: '',
    is_court_ordered: false,
    notes: '',
  });
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const ids = useId();
  const debtsQuery = useApplicantDebts(dealId);
  const debts = debtsQuery.data ?? [];
  const isLoading = debtsQuery.isLoading;
  const key = qk.debts(user?.id, dealId);

  const addMutation = useMutation({
    mutationFn: async () => {
      if (!formData.debt_type || !formData.creditor_name || !formData.monthly_payment) {
        throw new Error('Required fields missing');
      }
      const { error } = await supabase.from('applicant_debts').insert({
        deal_id: dealId,
        customer_id: customerId,
        debt_type: formData.debt_type as DebtType,
        creditor_name: formData.creditor_name,
        monthly_payment: parseFloat(formData.monthly_payment),
        total_balance: formData.total_balance ? parseFloat(formData.total_balance) : null,
        months_remaining: formData.months_remaining ? parseInt(formData.months_remaining) : null,
        is_court_ordered: formData.is_court_ordered,
        notes: formData.notes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: key });
      setShowForm(false);
      setFormData({ debt_type: '', creditor_name: '', monthly_payment: '', total_balance: '', months_remaining: '', is_court_ordered: false, notes: '' });
      toast({ title: 'Debt Added', description: 'Applicant debt has been recorded.' });
    },
    onError: (err) => {
      toast({ title: 'Could not add the debt', description: errorMessage(err), variant: 'destructive' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (debtId: string) => {
      const { error } = await supabase.from('applicant_debts').delete().eq('id', debtId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: key });
      toast({ title: 'Debt removed' });
    },
    onError: (err) => toast({ title: 'Could not remove the debt', description: errorMessage(err), variant: 'destructive' }),
  });

  const totalMonthly = debts.reduce((s, d) => s + d.monthly_payment, 0);
  const courtOrderedCount = debts.filter(d => d.is_court_ordered).length;
  const garnishmentCount = debts.filter(d => d.debt_type === 'garnishment' || d.debt_type === 'child_support').length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Scale className="h-5 w-5" />
            Applicant Debts
          </CardTitle>
          <Button variant="outline" size="sm" onClick={() => setShowForm(!showForm)} aria-expanded={showForm}>
            <Plus className="h-4 w-4 mr-1" /> Add Debt
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary */}
        {debts.length > 0 && (
          <div className="grid grid-cols-3 gap-2 text-sm">
            <div>
              <p className="text-muted-foreground text-xs">Monthly Total</p>
              <p className="font-bold text-lg">${totalMonthly.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Obligations</p>
              <p className="font-bold text-lg">{debts.length}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Court-Ordered</p>
              <p className={cn('font-bold text-lg', courtOrderedCount > 0 && 'text-destructive')}>{courtOrderedCount}</p>
            </div>
          </div>
        )}

        {/* Garnishment warning */}
        {garnishmentCount > 0 && (
          <div className="flex items-center gap-2 p-2 rounded-lg bg-destructive/10 border border-destructive/30 text-xs text-destructive">
            <Gavel className="h-3.5 w-3.5 shrink-0" />
            <span className="font-medium">{garnishmentCount} garnishment/child support obligation(s)</span>
          </div>
        )}

        {debtsQuery.isError && <QueryError compact what="the debts" error={debtsQuery.error} onRetry={() => debtsQuery.refetch()} />}
        {/* Debt list */}
        {debts.length === 0 && !isLoading && !debtsQuery.isError && (
          <p className="text-sm text-muted-foreground text-center py-2">No debts recorded</p>
        )}
        {debts.map(debt => (
          <div key={debt.id} className="flex items-start justify-between gap-2 p-2 rounded-lg border bg-muted/30">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <Badge variant="outline" className={cn('text-xs', DEBT_TYPE_COLORS[debt.debt_type])}>
                  {DEBT_TYPE_LABELS[debt.debt_type]}
                </Badge>
                {debt.is_court_ordered && (
                  <Gavel className="h-3 w-3 text-destructive" />
                )}
              </div>
              <p className="text-sm font-medium truncate">{debt.creditor_name}</p>
              <p className="text-xs text-muted-foreground">
                ${debt.monthly_payment.toLocaleString()}/mo
                {debt.total_balance != null && ` • $${debt.total_balance.toLocaleString()} balance`}
                {debt.months_remaining != null && ` • ${debt.months_remaining} mo remaining`}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
              aria-label={`Remove ${DEBT_TYPE_LABELS[debt.debt_type] ?? 'debt'} ${debt.creditor_name}`}
              disabled={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate(debt.id)}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </div>
        ))}

        {/* Add form */}
        {showForm && (
          <div className="space-y-3 p-3 rounded-lg border bg-muted/20">
            <div className="grid grid-cols-1 min-[380px]:grid-cols-2 gap-3">
              <div>
                <Label htmlFor={`${ids}-type`} className="text-xs">Debt type *</Label>
                <Select value={formData.debt_type} onValueChange={v => setFormData(f => ({ ...f, debt_type: v as DebtType }))}>
                  <SelectTrigger id={`${ids}-type`} className="h-8 text-xs">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(DEBT_TYPE_LABELS).map(([val, label]) => (
                      <SelectItem key={val} value={val}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor={`${ids}-creditor`} className="text-xs">Creditor *</Label>
                <Input id={`${ids}-creditor`} className="h-8 text-xs" value={formData.creditor_name} onChange={e => setFormData(f => ({ ...f, creditor_name: e.target.value }))} placeholder="e.g. IRS" />
              </div>
            </div>
            <div className="grid grid-cols-1 min-[380px]:grid-cols-3 gap-3">
              <div>
                <Label htmlFor={`${ids}-monthly`} className="text-xs">Monthly payment *</Label>
                <Input id={`${ids}-monthly`} className="h-8 text-xs" inputMode="decimal" value={formData.monthly_payment} onChange={e => setFormData(f => ({ ...f, monthly_payment: e.target.value }))} placeholder="0" />
              </div>
              <div>
                <Label htmlFor={`${ids}-balance`} className="text-xs">Total balance</Label>
                <Input id={`${ids}-balance`} className="h-8 text-xs" inputMode="decimal" value={formData.total_balance} onChange={e => setFormData(f => ({ ...f, total_balance: e.target.value }))} placeholder="Optional" />
              </div>
              <div>
                <Label htmlFor={`${ids}-months`} className="text-xs">Months left</Label>
                <Input id={`${ids}-months`} className="h-8 text-xs" inputMode="numeric" value={formData.months_remaining} onChange={e => setFormData(f => ({ ...f, months_remaining: e.target.value }))} placeholder="Optional" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch id={`${ids}-court`} checked={formData.is_court_ordered} onCheckedChange={v => setFormData(f => ({ ...f, is_court_ordered: v }))} />
              <Label htmlFor={`${ids}-court`} className="text-xs">Court-ordered</Label>
            </div>
            <Label htmlFor={`${ids}-notes`} className="sr-only">Notes</Label>
            <Textarea id={`${ids}-notes`} className="text-xs h-16" placeholder="Notes (optional)" value={formData.notes} onChange={e => setFormData(f => ({ ...f, notes: e.target.value }))} />
            <div className="flex gap-2">
              <Button size="sm" onClick={() => addMutation.mutate()} disabled={addMutation.isPending}>
                {addMutation.isPending ? 'Saving...' : 'Save'}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
