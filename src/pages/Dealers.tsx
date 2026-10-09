import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AppHeader } from '@/components/layout/AppHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Search, Plus, MoreHorizontal, Building2, Loader2, Users } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useDealers } from '@/hooks/use-deals';
import { useDealerStats, useUsers, type DealerRow } from '@/hooks/use-autoflow';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

type DealerForm = Pick<DealerRow, 'name' | 'code' | 'contact_name' | 'email' | 'phone'> & {
  street: string; city: string; state: string; zip: string;
};
const EMPTY: DealerForm = { name: '', code: '', contact_name: '', email: '', phone: '', street: '', city: '', state: 'QC', zip: '' };

export default function Dealers() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { isAdmin } = useAuth();
  const { data: dealers = [], isLoading } = useDealers();
  const { data: stats } = useDealerStats();
  const { data: users = [] } = useUsers(isAdmin);
  const [searchQuery, setSearchQuery] = useState('');
  const [editing, setEditing] = useState<DealerRow | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<DealerForm>(EMPTY);
  const [saving, setSaving] = useState(false);

  const filteredDealers = dealers.filter(
    (d) => d.name.toLowerCase().includes(searchQuery.toLowerCase()) || d.code.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const startAdd = () => { setEditing(null); setForm(EMPTY); setOpen(true); };
  const startEdit = (d: DealerRow) => {
    setEditing(d);
    setForm({ name: d.name, code: d.code, contact_name: d.contact_name, email: d.email, phone: d.phone,
      street: d.street ?? '', city: d.city ?? '', state: d.state ?? '', zip: d.zip ?? '' });
    setOpen(true);
  };

  const save = async () => {
    if (!form.name.trim() || !form.code.trim() || !form.contact_name.trim() || !form.email.trim() || !form.phone.trim()) {
      toast({ title: 'Name, code, contact, email and phone are required', variant: 'destructive' });
      return;
    }
    setSaving(true);
    const row = { ...form, code: form.code.trim().toUpperCase() };
    const { error } = editing
      ? await supabase.from('dealers').update(row).eq('id', editing.id)
      : await supabase.from('dealers').insert(row);
    setSaving(false);
    if (error) {
      toast({ title: 'Could not save dealer', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: editing ? 'Dealer updated' : 'Dealer added', description: editing ? undefined : 'Link their staff from Users once they sign up.' });
    setOpen(false);
    qc.invalidateQueries({ queryKey: ['dealers'] });
  };

  const setStatus = async (d: DealerRow, status: DealerRow['status']) => {
    const { error } = await supabase.from('dealers').update({ status }).eq('id', d.id);
    if (error) toast({ title: 'Could not update dealer', description: error.message, variant: 'destructive' });
    else { toast({ title: `${d.name} is now ${status}` }); qc.invalidateQueries({ queryKey: ['dealers'] }); }
  };

  const f = (k: keyof DealerForm, label: string, type = 'text') => (
    <div className="space-y-1.5">
      <Label htmlFor={`dealer-${k}`}>{label}</Label>
      <Input id={`dealer-${k}`} type={type} value={form[k]} onChange={(e) => setForm((s) => ({ ...s, [k]: e.target.value }))} />
    </div>
  );

  return (
    <div className="flex flex-col h-full">
      <AppHeader title="Dealers" subtitle={`${dealers.length} registered dealer${dealers.length === 1 ? '' : 's'}`} />

      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="p-6 pb-4 border-b bg-card flex items-center justify-between gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search dealers..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-9" />
          </div>
          {isAdmin && (
            <Button onClick={startAdd}><Plus className="h-4 w-4 mr-2" /> Add Dealer</Button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
          {isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
          ) : !filteredDealers.length ? (
            <p className="text-center text-muted-foreground py-12">{dealers.length ? 'No dealers match your search.' : 'No dealers yet. Add the dealerships you work with.'}</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredDealers.map((dealer) => {
                const s = stats?.get(dealer.id);
                const linked = users.filter((u) => u.dealerId === dealer.id).length;
                return (
                  <div key={dealer.id} className="bg-card rounded-xl border p-6 hover:shadow-md transition-shadow">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 shrink-0">
                          <Building2 className="h-5 w-5 text-primary" />
                        </div>
                        <div className="min-w-0">
                          <h3 className="font-semibold truncate">{dealer.name}</h3>
                          <p className="text-xs text-muted-foreground font-mono">{dealer.code}</p>
                        </div>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label={`Actions for ${dealer.name}`}><MoreHorizontal className="h-4 w-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => navigate(`/deals?q=${encodeURIComponent(dealer.name)}`)}>View Deals</DropdownMenuItem>
                          {isAdmin && <DropdownMenuItem onClick={() => startEdit(dealer)}>Edit Dealer</DropdownMenuItem>}
                          {isAdmin && <DropdownMenuItem onClick={() => navigate('/users')}>Manage portal users</DropdownMenuItem>}
                          {isAdmin && (dealer.status === 'suspended'
                            ? <DropdownMenuItem onClick={() => setStatus(dealer, 'active')}>Reactivate</DropdownMenuItem>
                            : <DropdownMenuItem className="text-destructive" onClick={() => setStatus(dealer, 'suspended')}>Suspend Dealer</DropdownMenuItem>)}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    <div className="space-y-3 mb-4 text-sm">
                      <div className="flex justify-between"><span className="text-muted-foreground">Contact</span><span>{dealer.contact_name}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Email</span><span className="truncate ml-2">{dealer.email}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Phone</span><span>{dealer.phone}</span></div>
                    </div>

                    <div className="pt-4 border-t grid grid-cols-3 gap-4 text-center">
                      <div><p className="text-lg font-bold">{s?.active_deals ?? 0}</p><p className="text-xs text-muted-foreground">Active</p></div>
                      <div><p className="text-lg font-bold">{s?.total_deals ?? 0}</p><p className="text-xs text-muted-foreground">Total</p></div>
                      <div><p className="text-lg font-bold text-success">{s?.approval_rate != null ? `${s.approval_rate}%` : '—'}</p><p className="text-xs text-muted-foreground">Approval</p></div>
                    </div>

                    <div className="mt-4 flex items-center justify-between">
                      <Badge variant="secondary" className={cn(
                        dealer.status === 'active' && 'bg-success/10 text-success',
                        dealer.status === 'suspended' && 'bg-destructive/10 text-destructive',
                        dealer.status === 'pending' && 'bg-warning/10 text-warning',
                      )}>{dealer.status}</Badge>
                      <span className="text-xs text-muted-foreground flex items-center gap-2">
                        {isAdmin && <span className="flex items-center gap-1"><Users className="h-3 w-3" /> {linked} portal user{linked === 1 ? '' : 's'}</span>}
                        {dealer.city && <span>{dealer.city}{dealer.state ? `, ${dealer.state}` : ''}</span>}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit dealer' : 'Add dealer'}</DialogTitle>
            <DialogDescription>Dealers submit deals and answer document requests from their own portal.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">{f('name', 'Dealership name')}</div>
            {f('code', 'Dealer code')}
            {f('contact_name', 'Contact name')}
            {f('email', 'Email', 'email')}
            {f('phone', 'Phone', 'tel')}
            <div className="col-span-2">{f('street', 'Street')}</div>
            {f('city', 'City')}
            <div className="grid grid-cols-2 gap-3">{f('state', 'Province')}{f('zip', 'Postal code')}</div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}{editing ? 'Save' : 'Add dealer'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
