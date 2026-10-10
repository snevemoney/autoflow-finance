import { statusConfig } from '@/types/deal';
import { cn } from '@/lib/utils';

interface StatusBadgeProps {
  /** any status string — unknown values get a neutral badge instead of crashing */
  status: string;
  size?: 'sm' | 'md' | 'lg';
}

export function StatusBadge({ status, size = 'md' }: StatusBadgeProps) {
  const config = statusConfig(status);

  return (
    <span
      className={cn(
        'status-badge whitespace-nowrap',
        config.bgColor,
        config.color,
        size === 'sm' && 'text-xs px-2 py-0.5',
        size === 'md' && 'text-xs px-2.5 py-1',
        size === 'lg' && 'text-sm px-3 py-1'
      )}
    >
      {config.label}
    </span>
  );
}
