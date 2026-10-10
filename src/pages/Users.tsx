import { useState } from 'react';
import { format } from 'date-fns';
import { AppHeader } from '@/components/layout/AppHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Search, UserPlus, User, Loader2, Copy, ShieldAlert, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSetUserAccess, useSetUserActive, useUsers, type StaffUser } from '@/hooks/use-autoflow';
import { useDealers } from '@/hooks/use-deals';
import { useAuth } from '@/contexts/AuthContext';
import { QueryError } from '@/components/QueryError';
import { supabase } from '@/integrations/supabase/client';
import { errorMessage, type AppRole } from '@/lib/rpc';
import { EMAIL_RE } from '@/lib/deal-schema';
import { toast } from '@/hooks/use-toast';

type Role = AppRole;

const ROLE_CONFIG: Record<Role | 'none', { label: string; color: string }> = {
  admin: { label: 'Admin', color: 'bg-primary/10 text-primary' },
  credit_analyst: { label: 'Credit Analyst', color: 'bg-info/10 text-info' },
  income_verifier: { label: 'Income Verifier', color: 'bg-warning/10 text-warning' },
  funding_manager: { label: 'Funding Manager', color: 'bg-success/10 text-success' },
  dealer: { label: 'Dealer', color: 'bg-accent/10 text-accent' },
  none: { label: 'No access', color: 'bg-muted text-muted-foreground' },
};
const ROLE_ORDER: Role[] = ['admin', 'credit_analyst', 'income_verifier', 'funding_manager', 'dealer'];

const primaryRole = (u: StaffUser): Role | 'none' => ROLE_ORDER.find((r) => u.roles.includes(r)) ?? 'none';

interface InviteResult { emailed: boolean; link?: string; email: string }

export default function Users() {
  const { user: me, isAdmin } = useAuth();
  const users = useUsers();
  const { data: dealers = [] } = useDealers();
  const setAccess = useSetUserAccess();
  const setActive = useSetUserActive();
  const [searchQuery, setSearchQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [pickDealerFor, setPickDealerFor] = useState<StaffUser | null>(null);
  const [pickedDealer, setPickedDealer] = useState('');
  const [deactivate, setDeactivate] = useState<StaffUser | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);

  const list = users.data ?? [];
  const q = searchQuery.trim().toLowerCase();
  const filtered = list.filter((u) => !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
  const waiting = list.filter((u) => u.isActive && (primaryRole(u) === 'none' || (primaryRole(u) === 'dealer' && !u.dealerId))).length;
  const dealerName = (id: string | null) => dealers.find((d) => d.id === id)?.name ?? '—';

  const apply = async (u: StaffUser, role: Role | null, dealerId?: string | null) => {
    setBusy(u.userId);
    try {
      await setAccess.mutateAsync({ userId: u.userId, role, dealerId: dealerId ?? null });
      toast({
        title: `${u.name}: ${ROLE_CONFIG[role ?? 'none'].label}`,
        description: role === 'dealer' && dealerId ? dealerName(dealerId) : undefined,
      });
    } catch (e) {
      toast({ title: 'Could not change access', description: errorMessage(e), variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const onRole = (u: StaffUser, value: Role | 'none') => {
    if (value === 'dealer') {
      setPickedDealer(u.dealerId ?? '');
      setPickDealerFor(u);
      return;
    }
    void apply(u, value === 'none' ? null : value);
  };

  const onActive = async (u: StaffUser, active: boolean) => {
    setBusy(u.userId);
    try {
      await setActive.mutateAsync({ userId: u.userId, active });
      toast({ title: active ? `${u.name} reactivated — give them a role` : `${u.name} deactivated and signed out` });
    } catch (e) {
      toast({ title: 'Could not update the account', description: errorMessage(e), variant: 'destructive' });
    } finally {
      setBusy(null);
      setDeactivate(null);
    }
  };

  const roleControl = (u: StaffUser) => {
    const role = primaryRole(u);
    const isMe = u.userId === me?.id;
    if (!isAdmin || isMe || !u.isActive) {
      return <Badge variant="secondary" className={cn(ROLE_CONFIG[role].color)}>{ROLE_CONFIG[role].label}</Badge>;
    }
    return (
      <Select value={role} onValueChange={(v) => onRole(u, v as Role | 'none')} disabled={busy === u.userId}>
        <SelectTrigger className="h-8 w-44 text-xs" aria-label={`Role for ${u.name}`}><SelectValue /></SelectTrigger>
        <SelectContent>
          {[...ROLE_ORDER, 'none' as const].map((r) => <SelectItem key={r} value={r}>{ROLE_CONFIG[r].label}</SelectItem>)}
        </SelectContent>
      </Select>
    );
  };

  const dealerControl = (u: StaffUser) => {
    if (primaryRole(u) !== 'dealer') return <span className="text-muted-foreground text-sm">—</span>;
    if (!isAdmin || !u.isActive) return <span className="text-sm">{dealerName(u.dealerId)}</span>;
    return (
      <Select value={u.dealerId ?? ''} onValueChange={(v) => apply(u, 'dealer', v)} disabled={busy === u.userId}>
        <SelectTrigger className={cn('h-8 w-48 text-xs', !u.dealerId && 'border-warning text-warning')} aria-label={`Dealership for ${u.name}`}>
          <SelectValue placeholder="Choose dealership" />
        </SelectTrigger>
        <SelectContent>{dealers.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
      </Select>
    );
  };

  const statusBadge = (u: StaffUser) => (
    <Badge variant="secondary" className={cn(u.isActive ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground')}>
      {u.isActive ? 'Active' : 'Deactivated'}
    </Badge>
  );

  const activeButton = (u: StaffUser) => isAdmin && u.userId !== me?.id && (
    <Button variant="ghost" size="sm" className={cn('text-xs', u.isActive && 'text-destructive')} disabled={busy === u.userId}
      onClick={() => (u.isActive ? setDeactivate(u) : onActive(u, true))}>
      {busy === u.userId ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : u.isActive ? 'Deactivate' : 'Reactivate'}
    </Button>
  );

  return (
    <div className="flex flex-col h-full">
      <AppHeader title="Users" subtitle={`${list.length} account${list.length === 1 ? '' : 's'}${waiting ? ` · ${waiting} waiting for access` : ''}`} />

      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="p-4 md:p-6 pb-4 border-b bg-card flex flex-wrap items-center justify-between gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input placeholder="Search users…" aria-label="Search users" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-9" />
          </div>
          {isAdmin && <Button onClick={() => setInviteOpen(true)}><UserPlus className="h-4 w-4 mr-2" aria-hidden /> Invite a user</Button>}
        </div>

        <div className="flex-1 overflow-y-auto p-4 md:p-6 scrollbar-thin">
          {!isAdmin && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-warning">
              <ShieldAlert className="h-4 w-4" aria-hidden /> Only admins can change access.
            </div>
          )}
          {users.isError ? (
            <QueryError what="the users" error={users.error} onRetry={() => users.refetch()} retrying={users.isFetching} />
          ) : users.isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-label="Loading" /></div>
          ) : !filtered.length ? (
            <p className="py-12 text-center text-muted-foreground">{list.length ? 'No user matches your search.' : 'No users yet.'}</p>
          ) : (
            <>
              {/* phones: one card per person */}
              <ul className="space-y-3 md:hidden">
                {filtered.map((u) => (
                  <li key={u.userId} className="rounded-lg border bg-card p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium truncate">{u.name}{u.userId === me?.id && <span className="text-xs text-muted-foreground"> (you)</span>}</p>
                        <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                      </div>
                      {statusBadge(u)}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">{roleControl(u)}{primaryRole(u) === 'dealer' && dealerControl(u)}</div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>Joined {format(new Date(u.createdAt), 'MMM d, yyyy')}</span>{activeButton(u)}
                    </div>
                  </li>
                ))}
              </ul>
              <div className="hidden md:block rounded-lg border overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr><th>User</th><th>Role</th><th>Dealership</th><th>Status</th><th>Joined</th><th><span className="sr-only">Actions</span></th></tr>
                  </thead>
                  <tbody>
                    {filtered.map((u) => (
                      <tr key={u.userId}>
                        <td>
                          <div className="flex items-center gap-3">
                            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10"><User className="h-4 w-4 text-primary" aria-hidden /></div>
                            <div>
                              <p className="font-medium">{u.name}{u.userId === me?.id && <span className="text-xs text-muted-foreground"> (you)</span>}</p>
                              <p className="text-xs text-muted-foreground">{u.email}</p>
                            </div>
                          </div>
                        </td>
                        <td>{roleControl(u)}</td>
                        <td>{dealerControl(u)}</td>
                        <td>{statusBadge(u)}</td>
                        <td className="text-sm text-muted-foreground">{format(new Date(u.createdAt), 'MMM d, yyyy')}</td>
                        <td>{activeButton(u)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>

      {/* a dealer account always belongs to a dealership */}
      <Dialog open={!!pickDealerFor} onOpenChange={(o) => !o && setPickDealerFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Which dealership?</DialogTitle>
            <DialogDescription>{pickDealerFor?.name} will only see this dealership's deals.</DialogDescription>
          </DialogHeader>
          <Label htmlFor="pick-dealer" className="sr-only">Dealership</Label>
          <Select value={pickedDealer} onValueChange={setPickedDealer}>
            <SelectTrigger id="pick-dealer"><SelectValue placeholder="Choose dealership" /></SelectTrigger>
            <SelectContent>{dealers.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPickDealerFor(null)}>Cancel</Button>
            <Button disabled={!pickedDealer} onClick={() => { const u = pickDealerFor; setPickDealerFor(null); if (u) void apply(u, 'dealer', pickedDealer); }}>
              Make dealer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deactivate} onOpenChange={(o) => !o && setDeactivate(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate {deactivate?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              They are signed out everywhere right away and can't sign in again until you reactivate them.
              Their role and dealership link are removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deactivate && onActive(deactivate, false)}>Deactivate</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} dealers={dealers} />
    </div>
  );
}

function InviteDialog({ open, onOpenChange, dealers }: {
  open: boolean; onOpenChange: (o: boolean) => void; dealers: { id: string; name: string }[];
}) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('dealer');
  const [dealerId, setDealerId] = useState('');
  const [language, setLanguage] = useState<'fr' | 'en'>('fr');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<InviteResult | null>(null);
  const [copied, setCopied] = useState(false);

  const reset = () => { setEmail(''); setName(''); setRole('dealer'); setDealerId(''); setLanguage('fr'); setResult(null); setCopied(false); };
  const emailOk = EMAIL_RE.test(email.trim());
  const canSend = emailOk && name.trim().length > 0 && (role !== 'dealer' || !!dealerId);

  const send = async () => {
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke('invite-user', {
        body: { email: email.trim().toLowerCase(), name: name.trim(), role, dealerId: role === 'dealer' ? dealerId : null, language,
                redirectTo: `${window.location.origin}/accept-invite` },
      });
      if (error) {
        let message = errorMessage(error);
        try { message = (await (error as { context?: Response }).context?.json())?.error ?? message; } catch { /* keep */ }
        throw new Error(message);
      }
      setResult({ emailed: !!data?.emailed, link: data?.link, email: email.trim().toLowerCase() });
    } catch (e) {
      toast({ title: 'Could not invite', description: errorMessage(e), variant: 'destructive' });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a user</DialogTitle>
          <DialogDescription>They get a link to set their password. Their access is ready when they arrive.</DialogDescription>
        </DialogHeader>
        {result ? (
          <div className="space-y-3 text-sm">
            {result.emailed ? (
              <p className="flex items-center gap-2"><Check className="h-4 w-4 text-success" aria-hidden /> Invitation emailed to <strong>{result.email}</strong>.</p>
            ) : (
              <>
                <p>Email sending isn't set up yet, so send this link to <strong>{result.email}</strong> yourself. It works once and expires in 24 hours.</p>
                <div className="flex gap-2">
                  <Input readOnly value={result.link ?? ''} aria-label="Invitation link" onFocus={(e) => e.target.select()} />
                  <Button variant="outline" aria-label="Copy the invitation link"
                    onClick={() => { navigator.clipboard?.writeText(result.link ?? ''); setCopied(true); }}>
                    {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
                  </Button>
                </div>
              </>
            )}
            <DialogFooter><Button onClick={() => { onOpenChange(false); reset(); }}>Done</Button></DialogFooter>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="inv-email">Email</Label>
              <Input id="inv-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off"
                aria-invalid={email.length > 0 && !emailOk} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inv-name">Full name</Label>
              <Input id="inv-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="inv-role">Role</Label>
                <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                  <SelectTrigger id="inv-role"><SelectValue /></SelectTrigger>
                  <SelectContent>{ROLE_ORDER.map((r) => <SelectItem key={r} value={r}>{ROLE_CONFIG[r].label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="inv-lang">Language</Label>
                <Select value={language} onValueChange={(v) => setLanguage(v as 'fr' | 'en')}>
                  <SelectTrigger id="inv-lang"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="fr">Français</SelectItem><SelectItem value="en">English</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
            {role === 'dealer' && (
              <div className="space-y-1.5">
                <Label htmlFor="inv-dealer">Dealership</Label>
                <Select value={dealerId} onValueChange={setDealerId}>
                  <SelectTrigger id="inv-dealer"><SelectValue placeholder="Choose dealership" /></SelectTrigger>
                  <SelectContent>{dealers.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button disabled={!canSend || sending} onClick={send}>
                {sending && <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden />} Send invitation
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
