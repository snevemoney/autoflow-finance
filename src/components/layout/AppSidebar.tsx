import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard, Kanban, FileText, Users, CreditCard, DollarSign, Wallet, Settings, Building2, BarChart3,
  ChevronLeft, ChevronRight, Car, Plus, Inbox,
} from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useDeals } from '@/hooks/use-deals';
import { useOpenDealerRequests } from '@/hooks/use-autoflow';

interface NavItem {
  label: string;
  path: string;
  icon: React.ElementType;
  badge?: number;
  end?: boolean;
}

export function BrandMark({ collapsed = false, subtitle = 'Deal Processing' }: { collapsed?: boolean; subtitle?: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-accent shrink-0">
        <Car className="h-5 w-5 text-accent-foreground" />
      </div>
      {!collapsed && (
        <div className="flex flex-col">
          <span className="font-display text-lg font-bold text-sidebar-foreground">AutoFlow</span>
          <span className="text-xs text-sidebar-foreground/60">{subtitle}</span>
        </div>
      )}
    </div>
  );
}

function SidebarShell({ children, subtitle }: { children: (collapsed: boolean) => React.ReactNode; subtitle: string }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <aside className={cn('flex flex-col bg-sidebar border-r border-sidebar-border transition-all duration-300', collapsed ? 'w-16' : 'w-64')}>
      <div className="flex h-16 items-center border-b border-sidebar-border px-4">
        <BrandMark collapsed={collapsed} subtitle={subtitle} />
      </div>
      <nav className="flex-1 overflow-y-auto p-3 space-y-6 scrollbar-thin">{children(collapsed)}</nav>
      <div className="border-t border-sidebar-border p-3">
        <Button variant="ghost" size="sm" onClick={() => setCollapsed(!collapsed)}
          className={cn('w-full text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent', collapsed && 'px-2')}>
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <><ChevronLeft className="h-4 w-4 mr-2" /><span>Collapse</span></>}
        </Button>
      </div>
    </aside>
  );
}

function NavSection({ title, items, collapsed }: { title?: string; items: NavItem[]; collapsed: boolean }) {
  if (!items.length) return null;
  return (
    <div className="space-y-1">
      {title && !collapsed && (
        <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/50">{title}</p>
      )}
      {items.map((item) => (
        <NavLink key={item.path} to={item.path} end={item.end}
          className={({ isActive }) => cn('nav-item', isActive && 'active', collapsed && 'justify-center px-2')}
          title={collapsed ? item.label : undefined}>
          <item.icon className="h-5 w-5 shrink-0" />
          {!collapsed && (
            <>
              <span className="flex-1">{item.label}</span>
              {!!item.badge && (
                <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-sidebar-primary px-1.5 text-xs font-medium text-sidebar-primary-foreground">
                  {item.badge}
                </span>
              )}
            </>
          )}
        </NavLink>
      ))}
    </div>
  );
}

export function AppSidebar() {
  const { isAdmin, hasRole } = useAuth();
  const { data: deals = [] } = useDeals();
  const count = (...s: string[]) => deals.filter((d) => s.includes(d.status)).length;

  const mainNavItems: NavItem[] = [
    { label: 'Dashboard', path: '/', icon: LayoutDashboard, end: true },
    { label: 'Pipeline', path: '/pipeline', icon: Kanban },
    { label: 'All Deals', path: '/deals', icon: FileText, end: true },
    { label: 'New Deal', path: '/deals/new', icon: Plus },
  ];
  const departmentNavItems: NavItem[] = [
    { label: 'Credit Review', path: '/credit', icon: CreditCard, badge: count('credit_review') },
    { label: 'Income Verification', path: '/income', icon: DollarSign, badge: count('income_verification') },
    { label: 'Funding', path: '/funding', icon: Wallet, badge: count('funding_review', 'approved') },
  ];
  const adminNavItems: NavItem[] = [
    { label: 'Dealers', path: '/dealers', icon: Building2 },
    ...(isAdmin ? [{ label: 'Users', path: '/users', icon: Users }] : []),
    { label: 'Reports', path: '/reports', icon: BarChart3 },
    ...(isAdmin ? [{ label: 'Settings', path: '/settings', icon: Settings }] : []),
  ];

  return (
    <SidebarShell subtitle="Deal Processing">
      {(collapsed) => (
        <>
          <NavSection items={mainNavItems} collapsed={collapsed} />
          <NavSection title="Departments" items={departmentNavItems} collapsed={collapsed} />
          <NavSection title={hasRole('admin') ? 'Admin' : 'More'} items={adminNavItems} collapsed={collapsed} />
        </>
      )}
    </SidebarShell>
  );
}

export function DealerSidebar() {
  const { dealerName } = useAuth();
  const { data: requests = [] } = useOpenDealerRequests();
  const items: NavItem[] = [
    { label: 'My Deals', path: '/portal', icon: Inbox, end: true, badge: requests.length },
    { label: 'Submit a Deal', path: '/portal/new', icon: Plus },
  ];
  return (
    <SidebarShell subtitle={dealerName ?? 'Dealer Portal'}>
      {(collapsed) => <NavSection items={items} collapsed={collapsed} />}
    </SidebarShell>
  );
}
