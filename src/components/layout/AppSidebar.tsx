import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard, Kanban, FileText, Users, CreditCard, DollarSign, Wallet, Settings, Building2, BarChart3,
  ChevronLeft, ChevronRight, Car, Plus, Inbox,
} from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useNavCounts } from './use-nav-counts';

interface NavItem {
  label: string;
  path: string;
  icon: React.ElementType;
  badge?: number;
  /** what the badge counts, for screen readers */
  badgeLabel?: string;
  end?: boolean;
}

export function BrandMark({ collapsed = false, subtitle = 'Deal Processing' }: { collapsed?: boolean; subtitle?: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-accent shrink-0" aria-hidden="true">
        <Car className="h-5 w-5 text-accent-foreground" />
      </div>
      {!collapsed && (
        <div className="flex min-w-0 flex-col">
          <span className="font-display text-lg font-bold text-sidebar-foreground">AutoFlow</span>
          <span className="truncate text-xs text-sidebar-foreground/60">{subtitle}</span>
        </div>
      )}
    </div>
  );
}

const COLLAPSE_KEY = 'autoflow.sidebar.collapsed';

function readCollapsed() {
  try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; }
}

/** The sidebar column on tablets and desktops (hidden on phones, where the drawer is used). */
function DesktopSidebar({ children, subtitle }: { children: (collapsed: boolean) => React.ReactNode; subtitle: string }) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0'); } catch { /* private mode */ }
  };
  return (
    <aside
      aria-label="Sidebar"
      className={cn(
        'hidden md:flex shrink-0 flex-col bg-sidebar border-r border-sidebar-border transition-[width] duration-300',
        'pl-[env(safe-area-inset-left)]',
        collapsed ? 'w-16' : 'w-64',
      )}
    >
      <div className="flex h-16 items-center border-b border-sidebar-border px-4">
        <BrandMark collapsed={collapsed} subtitle={subtitle} />
      </div>
      <nav aria-label="Main" className="flex-1 overflow-y-auto p-3 space-y-6 scrollbar-thin">{children(collapsed)}</nav>
      <div className="border-t border-sidebar-border p-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={toggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
          className={cn(
            'w-full text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent focus-visible:ring-sidebar-ring focus-visible:ring-offset-sidebar',
            collapsed && 'px-2',
          )}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" aria-hidden="true" /> : <><ChevronLeft className="h-4 w-4 mr-2" aria-hidden="true" /><span>Collapse</span></>}
        </Button>
      </div>
    </aside>
  );
}

/** The same navigation inside the phone drawer: never collapsed, closes on navigation. */
function DrawerSidebar({ children, subtitle }: { children: (collapsed: boolean) => React.ReactNode; subtitle: string }) {
  return (
    <div className="flex h-full flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]">
      <div className="flex h-16 shrink-0 items-center border-b border-sidebar-border px-4 pr-12">
        <BrandMark subtitle={subtitle} />
      </div>
      <nav aria-label="Main" className="flex-1 overflow-y-auto p-3 space-y-6 scrollbar-thin">{children(false)}</nav>
    </div>
  );
}

function NavSection({ title, items, collapsed }: { title?: string; items: NavItem[]; collapsed: boolean }) {
  if (!items.length) return null;
  return (
    <div className="space-y-1">
      {title && !collapsed && (
        <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/50">{title}</p>
      )}
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.path}>
            <NavLink
              to={item.path}
              end={item.end}
              className={({ isActive }) => cn(
                'nav-item outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar',
                isActive && 'active',
                collapsed && 'justify-center px-2',
              )}
              title={collapsed ? item.label : undefined}
              aria-label={collapsed ? (item.badge ? `${item.label}, ${item.badge} ${item.badgeLabel ?? ''}`.trim() : item.label) : undefined}
            >
              <item.icon className="h-5 w-5 shrink-0" aria-hidden="true" />
              {!collapsed && (
                <>
                  <span className="flex-1">{item.label}</span>
                  {!!item.badge && (
                    <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-sidebar-primary px-1.5 text-xs font-medium text-sidebar-primary-foreground">
                      {item.badge}
                      {item.badgeLabel && <span className="sr-only">&nbsp;{item.badgeLabel}</span>}
                    </span>
                  )}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StaffNav({ collapsed }: { collapsed: boolean }) {
  const { isAdmin } = useAuth();
  const { data: counts } = useNavCounts();

  const mainNavItems: NavItem[] = [
    { label: 'Dashboard', path: '/', icon: LayoutDashboard, end: true },
    { label: 'Pipeline', path: '/pipeline', icon: Kanban },
    { label: 'All Deals', path: '/deals', icon: FileText, end: true },
    { label: 'New Deal', path: '/deals/new', icon: Plus },
  ];
  const departmentNavItems: NavItem[] = [
    { label: 'Credit Review', path: '/credit', icon: CreditCard, badge: counts?.credit_review, badgeLabel: 'waiting' },
    { label: 'Income Verification', path: '/income', icon: DollarSign, badge: counts?.income_verification, badgeLabel: 'waiting' },
    { label: 'Funding', path: '/funding', icon: Wallet, badge: counts ? counts.funding_review + counts.approved : 0, badgeLabel: 'waiting' },
  ];
  const moreNavItems: NavItem[] = [
    ...(isAdmin ? [{ label: 'Dealers', path: '/dealers', icon: Building2 }] : []),
    ...(isAdmin ? [{ label: 'Users', path: '/users', icon: Users }] : []),
    { label: 'Reports', path: '/reports', icon: BarChart3 },
    ...(isAdmin ? [{ label: 'Settings', path: '/settings', icon: Settings }] : []),
  ];

  return (
    <>
      <NavSection items={mainNavItems} collapsed={collapsed} />
      <NavSection title="Departments" items={departmentNavItems} collapsed={collapsed} />
      <NavSection title={isAdmin ? 'Admin' : 'More'} items={moreNavItems} collapsed={collapsed} />
    </>
  );
}

function DealerNav({ collapsed }: { collapsed: boolean }) {
  const { data: counts } = useNavCounts();
  const items: NavItem[] = [
    { label: 'My Deals', path: '/portal', icon: Inbox, end: true, badge: counts?.open_requests, badgeLabel: 'documents requested' },
    { label: 'Submit a Deal', path: '/portal/new', icon: Plus },
  ];
  return <NavSection items={items} collapsed={collapsed} />;
}

export function AppSidebar({ variant = 'desktop' }: { variant?: 'desktop' | 'drawer' }) {
  const Shell = variant === 'drawer' ? DrawerSidebar : DesktopSidebar;
  return <Shell subtitle="Deal Processing">{(collapsed) => <StaffNav collapsed={collapsed} />}</Shell>;
}

export function DealerSidebar({ variant = 'desktop' }: { variant?: 'desktop' | 'drawer' }) {
  const { dealerName } = useAuth();
  const Shell = variant === 'drawer' ? DrawerSidebar : DesktopSidebar;
  return <Shell subtitle={dealerName ?? 'Dealer Portal'}>{(collapsed) => <DealerNav collapsed={collapsed} />}</Shell>;
}
