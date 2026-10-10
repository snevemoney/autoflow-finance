import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Bell, Search, User, LogOut, Settings, CheckCheck, Menu, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ago, cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { useNotifications } from '@/hooks/use-autoflow';
import { useMobileNav } from './mobile-nav';
import { headerSearchTarget } from './route-meta';

interface AppHeaderProps {
  title: string;
  subtitle?: string;
}

/** Arrow keys / Home / End move between the notification buttons. */
function onListKeyDown(e: React.KeyboardEvent<HTMLUListElement>) {
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-notification]'));
  if (!items.length) return;
  const at = items.indexOf(document.activeElement as HTMLButtonElement);
  let next = -1;
  if (e.key === 'ArrowDown') next = at < 0 ? 0 : Math.min(at + 1, items.length - 1);
  else if (e.key === 'ArrowUp') next = at < 0 ? items.length - 1 : Math.max(at - 1, 0);
  else if (e.key === 'Home') next = 0;
  else if (e.key === 'End') next = items.length - 1;
  if (next < 0) return;
  e.preventDefault();
  items[next].focus();
}

export function AppHeader({ title, subtitle }: AppHeaderProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const mobileNav = useMobileNav();
  const { user, signOut, profileName, isDealer, dealerName, isAdmin } = useAuth();
  const { data: notifications = [], markRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const listPath = isDealer ? '/portal' : '/deals';
  const onList = location.pathname === listPath;
  const urlQuery = onList ? new URLSearchParams(location.search).get('q') ?? '' : '';
  const [q, setQ] = useState(urlQuery);
  const mobileInput = useRef<HTMLInputElement>(null);
  const unreadCount = notifications.filter((n) => !n.read).length;
  const displayName = profileName || user?.email || 'User';
  const dealPath = (id: string) => (isDealer ? `/portal/deals/${id}` : `/deals/${id}`);
  const searchLabel = isDealer ? 'Search my deals' : 'Search deals';

  // the box shows what the list is filtered by (also after back/forward)
  useEffect(() => { setQ(urlQuery); }, [urlQuery]);
  useEffect(() => { if (searchOpen) mobileInput.current?.focus(); }, [searchOpen]);

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const target = headerSearchTarget({ pathname: location.pathname, search: location.search, term: q, isDealer });
    if (!target) return;
    setSearchOpen(false);
    navigate(target);
  };

  const searchInput = (props: { className: string; inputRef?: React.Ref<HTMLInputElement>; id: string }) => (
    <>
      <label htmlFor={props.id} className="sr-only">{searchLabel}</label>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <Input
        id={props.id}
        ref={props.inputRef}
        type="search"
        enterKeyHint="search"
        placeholder={isDealer ? 'Search my deals…' : 'Search deals…'}
        className={props.className}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
    </>
  );

  return (
    <header className="sticky top-0 z-30 shrink-0 border-b bg-card pt-[env(safe-area-inset-top)]">
      <div className="relative flex h-14 items-center gap-2 px-3 md:h-16 md:gap-4 md:px-6">
        {mobileNav && (
          <Button
            variant="ghost"
            size="icon"
            className="-ml-1 shrink-0 md:hidden"
            onClick={mobileNav.open}
            aria-label="Open menu"
            aria-haspopup="dialog"
            aria-expanded={mobileNav.isOpen}
            aria-controls="mobile-navigation"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </Button>
        )}

        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-base font-semibold text-foreground md:text-xl">{title}</h1>
          {subtitle && <p className="truncate text-xs text-muted-foreground md:text-sm">{subtitle}</p>}
        </div>

        <div className="flex shrink-0 items-center gap-1 md:gap-3">
          <form onSubmit={onSearch} className="relative hidden md:block" role="search">
            {searchInput({ id: 'header-search', className: 'w-44 lg:w-64 pl-9 bg-secondary border-0' })}
          </form>
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-label={searchLabel}
            aria-expanded={searchOpen}
            onClick={() => setSearchOpen(true)}
          >
            <Search className="h-5 w-5" aria-hidden="true" />
          </Button>

          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="relative" aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}>
                <Bell className="h-5 w-5" aria-hidden="true" />
                {unreadCount > 0 && (
                  <span aria-hidden="true" className="absolute -top-0.5 -right-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium text-destructive-foreground">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[calc(100vw-1.5rem)] max-w-sm p-0 sm:w-96" align="end" collisionPadding={12} aria-label="Notifications">
              <div className="flex items-center justify-between border-b px-4 py-3">
                <h2 className="text-base font-semibold">Notifications</h2>
                <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" disabled={!unreadCount} onClick={() => markRead()}>
                  <CheckCheck className="h-3 w-3 mr-1" aria-hidden="true" /> Mark all read
                </Button>
              </div>
              <div className="max-h-[60vh] overflow-y-auto md:max-h-96">
                {notifications.length === 0 && <p className="px-4 py-8 text-center text-sm text-muted-foreground">You're all caught up.</p>}
                {notifications.length > 0 && (
                  <ul aria-label="Notifications" onKeyDown={onListKeyDown}>
                    {notifications.map((n) => (
                      <li key={n.id} className="border-b last:border-0">
                        <button
                          type="button"
                          data-notification
                          onClick={() => {
                            if (!n.read) markRead([n.id]);
                            if (n.deal_id) { setOpen(false); navigate(dealPath(n.deal_id)); }
                          }}
                          className={cn(
                            'flex w-full gap-3 px-4 py-3 text-left outline-none hover:bg-muted/50 focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                            !n.read && 'bg-info/5',
                          )}
                        >
                          <span aria-hidden="true" className={cn('mt-1.5 h-2 w-2 rounded-full shrink-0',
                            n.type === 'success' && 'bg-success', n.type === 'warning' && 'bg-warning',
                            n.type === 'error' && 'bg-destructive', n.type === 'info' && 'bg-info')} />
                          <span className="flex-1 min-w-0">
                            {!n.read && <span className="sr-only">Unread: </span>}
                            <span className={cn('block text-sm', !n.read && 'font-medium')}>{n.title}</span>
                            <span className="block text-xs text-muted-foreground line-clamp-2">{n.message}</span>
                            <span className="block text-xs text-muted-foreground mt-1">{ago(n.created_at, { addSuffix: true })}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </PopoverContent>
          </Popover>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="rounded-full" aria-label={`Account menu for ${displayName}`}>
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <User className="h-4 w-4" aria-hidden="true" />
                </div>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuLabel>
                <p className="font-medium truncate">{displayName}</p>
                <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
                {isDealer && dealerName && <p className="text-xs text-muted-foreground mt-1">{dealerName}</p>}
              </DropdownMenuLabel>
              {isAdmin && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => navigate('/settings')}>
                    <Settings className="mr-2 h-4 w-4" aria-hidden="true" /> Settings
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive" onClick={() => signOut()}>
                <LogOut className="mr-2 h-4 w-4" aria-hidden="true" /> Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {searchOpen && (
          <form
            onSubmit={onSearch}
            role="search"
            className="absolute inset-0 z-10 flex items-center gap-2 bg-card px-3 md:hidden"
            onKeyDown={(e) => { if (e.key === 'Escape') setSearchOpen(false); }}
          >
            <div className="relative flex-1">
              {searchInput({ id: 'header-search-mobile', inputRef: mobileInput, className: 'w-full pl-9 bg-secondary border-0' })}
            </div>
            <Button type="button" variant="ghost" size="icon" aria-label="Close search" onClick={() => setSearchOpen(false)}>
              <X className="h-5 w-5" aria-hidden="true" />
            </Button>
          </form>
        )}
      </div>
    </header>
  );
}
