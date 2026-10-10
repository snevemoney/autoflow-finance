import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, Home, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** where "Go to dashboard" leads */
  homeHref?: string;
  /** when this value changes (e.g. the route), a boundary showing an error tries again */
  resetKey?: unknown;
  /** full page (app level) or inside the layout (route level) */
  variant?: 'page' | 'inline';
  /** custom fallback, mainly for tests */
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Catches render errors so one broken component (e.g. an unexpected status value) shows a
 * recoverable message instead of a blank screen. Errors are logged to the console.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[AutoFlow] Something went wrong while rendering', error, info.componentStack);
  }

  componentDidUpdate(prev: ErrorBoundaryProps) {
    if (this.state.error && !Object.is(prev.resetKey, this.props.resetKey)) this.reset();
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);
    return <ErrorFallback variant={this.props.variant ?? 'page'} homeHref={this.props.homeHref ?? '/'} />;
  }
}

export function ErrorFallback({ variant, homeHref }: { variant: 'page' | 'inline'; homeHref: string }) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center gap-4 p-6 text-center',
        variant === 'page' ? 'min-h-screen bg-background' : 'h-full min-h-[320px]',
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
        <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden="true" />
      </div>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Something went wrong</h2>
        <p className="max-w-sm text-sm text-muted-foreground">
          This page hit an unexpected problem. Reloading usually fixes it — your saved work is safe.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button onClick={() => window.location.reload()}>
          <RotateCw className="mr-2 h-4 w-4" aria-hidden="true" /> Reload
        </Button>
        <Button variant="outline" onClick={() => window.location.assign(homeHref)}>
          <Home className="mr-2 h-4 w-4" aria-hidden="true" /> Go to dashboard
        </Button>
      </div>
    </div>
  );
}
