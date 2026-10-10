import { cn } from '@/lib/utils';
import { LucideIcon } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

interface StatCardProps {
  title: string;
  value: string | number;
  /** short line under the value */
  hint?: string;
  loading?: boolean;
  icon: LucideIcon;
  iconColor?: string;
  iconBgColor?: string;
}

export function StatCard({
  title,
  value,
  hint,
  loading,
  icon: Icon,
  iconColor = 'text-primary',
  iconBgColor = 'bg-primary/10',
}: StatCardProps) {
  return (
    <div className="stat-card p-4 sm:p-6 min-w-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="metric-label truncate">{title}</p>
          {loading ? <Skeleton className="h-8 w-20 mt-2" /> : <p className="metric-value mt-1 text-2xl sm:text-3xl truncate">{value}</p>}
          {hint && !loading && <p className="text-xs text-muted-foreground mt-1 truncate">{hint}</p>}
        </div>
        <div className={cn('p-2 sm:p-3 rounded-lg shrink-0', iconBgColor)}>
          <Icon className={cn('h-5 w-5 sm:h-6 sm:w-6', iconColor)} aria-hidden />
        </div>
      </div>
    </div>
  );
}
