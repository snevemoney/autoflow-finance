import { AlertTriangle, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { errorMessage } from '@/lib/rpc';

interface QueryErrorProps {
  /** what failed to load, e.g. "deals" → "We couldn't load the deals." */
  what?: string;
  error?: unknown;
  onRetry?: () => void;
  retrying?: boolean;
  compact?: boolean;
  className?: string;
}

/** Shown wherever a query fails — never an empty state that pretends there is no data. */
export function QueryError({ what = 'this', error, onRetry, retrying, compact, className }: QueryErrorProps) {
  const detail = error ? errorMessage(error) : '';
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 text-center',
        compact ? 'p-3 text-sm' : 'p-8',
        className,
      )}
    >
      <AlertTriangle className={cn('text-destructive', compact ? 'h-4 w-4' : 'h-6 w-6')} aria-hidden />
      <p className="font-medium text-foreground">We couldn't load {what}.</p>
      <p className="text-xs text-muted-foreground max-w-md break-words">
        {offline ? 'You appear to be offline. Check the connection and try again.' : detail || 'Something went wrong on our side.'}
      </p>
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry} disabled={retrying} className="mt-1">
          <RotateCw className={cn('h-3.5 w-3.5 mr-1.5', retrying && 'animate-spin')} aria-hidden /> Try again
        </Button>
      )}
    </div>
  );
}
