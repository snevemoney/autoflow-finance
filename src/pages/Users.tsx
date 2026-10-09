import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { AppHeader } from '@/components/layout/AppHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Search, UserPlus, User, Loader2, Copy, ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUsers, type StaffUser } from '@/hooks/use-autoflow';
import { useDealers } from '@/hooks/use-deals';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import type { Database } from '@/integrations/supabase/types';

type Role = Database['public']['Enums']['app_role'];

const ROLE_CONFIG: Record<Role | 'none', { label: string; color: string }> = {
  admin: { label: 'Admin', color: 'bg-primary/10 text-primary' },
  credit_analyst: { label: 'Credit Analyst', color: 'bg-info/10 text-info' },
  income_verifier: { label: 'Income Verifier', color: 'bg-warning/10 text-warning' },
  funding_manager: { label: 'Funding Manager', color: 'bg-success/10 text-success' },
  dealer: { label: 'Dealer', color: 'bg-accent/10 text-accent' },
  none: { label: 'No access yet', color: 'bg-muted text-muted-foreground' },
};
const DEPARTMENT: Partial<Record<Role, Database['public']['Enums']['department']>> = {
  admin: 'admin', credit_analyst: 'credit', income_verifier: 'income', funding_manager: 'funding',
};
const ROLE_ORDER: Role[] = ['admin', 'credit_analyst', 'income_verifier', 'funding_manager', 'dealer'];

const primaryRole = (u: StaffUser): Role | 'none' => ROLE_ORDER.find((r) => u.roles.includes(r)) ?? 'none';

export default function Users() {
  const qc = useQueryClient();
  const { user: me, isAdmin } = useAuth();
  const { data: users = [], isLoading } = useUsers();
  const { data: dealers = [] } = useDealers();
  const [searchQuery, setSearchQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);

  const filtered = users.filter((u) =>
    u.name.toLowerCase().includes(searchQuery.toLowerCase()) || u.email.toLowerCase().includes(searchQuery.toLowerCase()));
  const waiting = users.filter((u) => primaryRole(u) === 'none' || (primaryRole(u) === 'dealer' && !u.dealerId)).length;

  const refresh = () => qc.invalidateQueries({ queryKey: ['users'] });

  const setRole = async (u: StaffUser, role: Role | 'none') => {
    setBusy(u.userId);
    try {
      const del = await supabase.from('user_roles').delete().eq('user_id', u.userId);
      if (del.error) throw del.error;
      if (role !== 'none') {
        const ins = await supabase.from('user_roles').insert({ user_id: u.userId, role });
        if (ins.error) throw ins.error;
      }
      if (role !== 'dealer' && u.dealerId) await supabase.from('dealer_users').delete().eq('user_id', u.userId);
      await supabase.from('profiles').update({ department: role === 'none' ? null : DEPARTMENT[role as Role] ?? null }).eq('user_id', u.userId);
      toast({ title: `${u.name}: ${ROLE_CONFIG[role].label}`, description: role === 'dealer' && !u.dealerId ? 'Now choose their dealership.' : undefined });
      refresh();
    } catch (e) {
      toast({ title: 'Could not change role', description: e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e), variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const setDealer = async (u: StaffUser, dealerId: string) => {
    setBusy(u.userId);
    const { error } = await supabase.from('dealer_users').upsert({ user_id: u.userId, dealer_id: dealerId });
    setBusy(null);
    if (error) toast({ title: 'Could not link dealer', description: error.message, variant: 'destructive' });
    else { toast({ title: `${u.name} linked to ${dealers.find((d) => d.id === dealerId)?.name}` }); refresh(); }
  };

  const setActive = async (u: StaffUser, isActive: boolean) => {
    setBusy(u.userId);
    const { error } = await supabase.from('profiles').update({ is_active: isActive }).eq('user_id', u.userId);
    if (!error && !isActive) await supabase.from('user_roles').delete().eq('user_id', u.userId);
    setBusy(null);
    if (error) toast({ title: 'Could not update user', description: error.message, variant: 'destructive' });
    else { toast({ title: isActive ? 'User reactivated — assign a role' : 'User deactivated and access removed' }); refresh(); }
  };

  const signupUrl = `${window.location.origin}/auth?tab=signup`;

  return (
    <div className="flex flex-col h-full">
      <AppHeader title="Users" subtitle={`${users.length} account${users.length === 1 ? '' : 's'}${waiting ? ` · ${waiting} waiting for access` : ''}`} />

      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="p-6 pb-4 border-b bg-card flex items-center justify-between gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search users..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-9" />
          </div>
          {isAdmin && <Button onClick={() => setInviteOpen(true)}><UserPlus className="h-4 w-4 mr-2" /> Add User</Button>}
        </div>

        <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
          {!isAdmin && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-warning">
              <ShieldAlert className="h-4 w-4" /> Only admins can change roles.
            </div>
          )}
          {isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
          ) : (
            <div className="rounded-lg border overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Role</th>
                    <th>Dealership</th>
                    <th>Status</th>
                    <th>Joined</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((u) => {
                    const role = primaryRole(u);
                    const isMe = u.userId === me?.id;
                    return (
                      <tr key={u.userId}>
                        <td>
                          <div className="flex items-center gap-3">
                            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10"><User className="h-4 w-4 text-primary" /></div>
                            <div>
                              <p className="font-medium">{u.name}{isMe && <span className="text-xs text-muted-foreground"> (you)</span>}</p>
                              <p className="text-xs text-muted-foreground">{u.email}</p>
                            </div>
                          </div>
                        </td>
                        <td>
                          {isAdmin && !isMe ? (
                            <Select value={role} onValueChange={(v) => setRole(u, v as Role | 'none')} disabled={busy === u.userId || !u.isActive}>
                              <SelectTrigger className="h-8 w-44 text-xs" aria-label={`Role for ${u.name}`}><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {[...ROLE_ORDER, 'none' as const].map((r) => <SelectItem key={r} value={r}>{ROLE_CONFIG[r].label}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          ) : (
                            <Badge variant="secondary" className={cn(ROLE_CONFIG[role].color)}>{ROLE_CONFIG[role].label}</Badge>
                          )}
                        </td>
                        <td>
                          {role === 'dealer' ? (isAdmin ? (
                            <Select value={u.dealerId ?? ''} onValueChange={(v) => setDealer(u, v)} disabled={busy === u.userId}>
                              <SelectTrigger className={cn('h-8 w-48 text-xs', !u.dealerId && 'border-warning text-warning')} aria-label={`Dealership for ${u.name}`}>
                                <SelectValue placeholder="Choose dealership" />
                              </SelectTrigger>
                              <SelectContent>{dealers.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
                            </Select>
                          ) : <span className="text-sm">{dealers.find((d) => d.id === u.dealerId)?.name ?? '—'}</span>)
                            : <span className="text-muted-foreground text-sm">—</span>}
                        </td>
                        <td>
                          <Badge variant="secondary" className={cn(u.isActive ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground')}>
                            {u.isActive ? 'Active' : 'Inactive'}
                          </Badge>
                        </td>
                        <td className="text-sm text-muted-foreground">{format(new Date(u.createdAt), 'MMM d, yyyy')}</td>
                        <td>
                          {isAdmin && !isMe && (
                            <Button variant="ghost" size="sm" className={cn('text-xs', u.isActive && 'text-destructive')}
                              disabled={busy === u.userId} onClick={() => setActive(u, !u.isActive)}>
                              {busy === u.userId ? <Loader2 className="h-3 w-3 animate-spin" /> : u.isActive ? 'Deactivate' : 'Reactivate'}
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a user</DialogTitle>
            <DialogDescription>
              Send them this sign-up link. Once they've created an account they appear here as “No access yet” —
              pick their role (and dealership for dealer staff) and they're in.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input readOnly value={signupUrl} onFocus={(e) => e.target.select()} />
            <Button variant="outline" onClick={() => { navigator.clipboard?.writeText(signupUrl); toast({ title: 'Link copied' }); }}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
