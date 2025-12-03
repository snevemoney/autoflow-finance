import { NavLink, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  Kanban,
  FileText,
  Users,
  CreditCard,
  DollarSign,
  Wallet,
  Settings,
  Building2,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Car,
} from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

interface NavItem {
  label: string;
  path: string;
  icon: React.ElementType;
  badge?: number;
}

const mainNavItems: NavItem[] = [
  { label: 'Dashboard', path: '/', icon: LayoutDashboard },
  { label: 'Pipeline', path: '/pipeline', icon: Kanban },
  { label: 'All Deals', path: '/deals', icon: FileText },
];

const departmentNavItems: NavItem[] = [
  { label: 'Credit Review', path: '/credit', icon: CreditCard, badge: 5 },
  { label: 'Income Verification', path: '/income', icon: DollarSign, badge: 4 },
  { label: 'Funding', path: '/funding', icon: Wallet, badge: 3 },
];

const adminNavItems: NavItem[] = [
  { label: 'Dealers', path: '/dealers', icon: Building2 },
  { label: 'Users', path: '/users', icon: Users },
  { label: 'Reports', path: '/reports', icon: BarChart3 },
  { label: 'Settings', path: '/settings', icon: Settings },
];

export function AppSidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();

  const NavSection = ({ title, items }: { title?: string; items: NavItem[] }) => (
    <div className="space-y-1">
      {title && !collapsed && (
        <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/50">
          {title}
        </p>
      )}
      {items.map((item) => (
        <NavLink
          key={item.path}
          to={item.path}
          className={({ isActive }) =>
            cn(
              'nav-item',
              isActive && 'active',
              collapsed && 'justify-center px-2'
            )
          }
        >
          <item.icon className="h-5 w-5 shrink-0" />
          {!collapsed && (
            <>
              <span className="flex-1">{item.label}</span>
              {item.badge && (
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

  return (
    <aside
      className={cn(
        'flex flex-col bg-sidebar border-r border-sidebar-border transition-all duration-300',
        collapsed ? 'w-16' : 'w-64'
      )}
    >
      {/* Logo */}
      <div className="flex h-16 items-center border-b border-sidebar-border px-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-accent">
            <Car className="h-5 w-5 text-accent-foreground" />
          </div>
          {!collapsed && (
            <div className="flex flex-col">
              <span className="font-display text-lg font-bold text-sidebar-foreground">
                AutoFin
              </span>
              <span className="text-xs text-sidebar-foreground/60">
                Deal Processing
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto p-3 space-y-6 scrollbar-thin">
        <NavSection items={mainNavItems} />
        <NavSection title="Departments" items={departmentNavItems} />
        <NavSection title="Admin" items={adminNavItems} />
      </nav>

      {/* Collapse Toggle */}
      <div className="border-t border-sidebar-border p-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setCollapsed(!collapsed)}
          className={cn(
            'w-full text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent',
            collapsed && 'px-2'
          )}
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <>
              <ChevronLeft className="h-4 w-4 mr-2" />
              <span>Collapse</span>
            </>
          )}
        </Button>
      </div>
    </aside>
  );
}
