import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Search, User, LogOut, Settings, CheckCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ago, cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { useNotifications } from '@/hooks/use-autoflow';

interface AppHeaderProps {
  title: string;
  subtitle?: string;
}

export function AppHeader({ title, subtitle }: AppHeaderProps) {
  const navigate = useNavigate();
  const { user, signOut, profileName, isDealer, dealerName, isAdmin } = useAuth();
  const { data: notifications = [], markRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const unreadCount = notifications.filter((n) => !n.read).length;
  const displayName = profileName || user?.email || 'User';
  const dealPath = (id: string) => (isDealer ? `/portal/deals/${id}` : `/deals/${id}`);

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!q.trim()) return;
    navigate(`${isDealer ? '/portal' : '/deals'}?q=${encodeURIComponent(q.trim())}`);
  };

  return (
    <header className="flex h-16 items-center justify-between gap-4 border-b bg-card px-6">
      <div className="min-w-0">
        <h1 className="font-display text-xl font-semibold text-foreground truncate">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground truncate">{subtitle}</p>}
      </div>

      <div className="flex items-center gap-3">
        <form onSubmit={onSearch} className="relative hidden md:block">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={isDealer ? 'Search my deals…' : 'Search deals…'}
            className="w-64 pl-9 bg-secondary border-0"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search deals"
          />
        </form>

        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="relative" aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}>
              <Bell className="h-5 w-5" />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium text-destructive-foreground">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-96 p-0" align="end">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h3 className="font-semibold">Notifications</h3>
              <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" disabled={!unreadCount} onClick={() => markRead()}>
                <CheckCheck className="h-3 w-3 mr-1" /> Mark all read
              </Button>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {notifications.length === 0 && <p className="px-4 py-8 text-center text-sm text-muted-foreground">You're all caught up.</p>}
              {notifications.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => {
                    if (!n.read) markRead([n.id]);
                    if (n.deal_id) { setOpen(false); navigate(dealPath(n.deal_id)); }
                  }}
                  className={cn('flex w-full gap-3 border-b px-4 py-3 text-left last:border-0 hover:bg-muted/50', !n.read && 'bg-info/5')}
                >
                  <span className={cn('mt-1.5 h-2 w-2 rounded-full shrink-0',
                    n.type === 'success' && 'bg-success', n.type === 'warning' && 'bg-warning',
                    n.type === 'error' && 'bg-destructive', n.type === 'info' && 'bg-info')} />
                  <span className="flex-1 min-w-0">
                    <span className={cn('block text-sm', !n.read && 'font-medium')}>{n.title}</span>
                    <span className="block text-xs text-muted-foreground line-clamp-2">{n.message}</span>
                    <span className="block text-xs text-muted-foreground mt-1">{ago(n.created_at, { addSuffix: true })}</span>
                  </span>
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="rounded-full" aria-label="Account menu">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <User className="h-4 w-4" />
              </div>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel>
              <p className="font-medium">{displayName}</p>
              <p className="text-xs text-muted-foreground">{user?.email}</p>
              {isDealer && dealerName && <p className="text-xs text-muted-foreground mt-1">{dealerName}</p>}
            </DropdownMenuLabel>
            {isAdmin && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate('/settings')}>
                  <Settings className="mr-2 h-4 w-4" /> Settings
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" onClick={signOut}>
              <LogOut className="mr-2 h-4 w-4" /> Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
