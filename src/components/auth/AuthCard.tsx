import { ReactNode } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { BrandMark } from '@/components/layout/AppSidebar';
import { cn } from '@/lib/utils';

/** Centered card used by the public pages (sign-in, password reset, invitation, 404). */
export function AuthCard({ title, description, icon, children, className }: {
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex min-h-screen supports-[height:100dvh]:min-h-dvh items-center justify-center bg-background p-4',
        'pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]',
      )}
    >
      <main className={cn('w-full max-w-md', className)}>
        <Card>
          <CardHeader className="space-y-4 text-center">
            <div className="mx-auto rounded-xl bg-sidebar px-4 py-3"><BrandMark subtitle="From dealer to funded" /></div>
            {icon && <div className="mx-auto">{icon}</div>}
            <div className="space-y-1.5">
              <h1 className="text-xl font-semibold leading-tight">{title}</h1>
              {description && <div className="text-sm text-muted-foreground">{description}</div>}
            </div>
          </CardHeader>
          {children && <CardContent>{children}</CardContent>}
        </Card>
      </main>
    </div>
  );
}

/** Round tinted icon for AuthCard. */
export function AuthIcon({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'success' | 'warning' | 'destructive' }) {
  return (
    <div
      className={cn(
        'flex h-12 w-12 items-center justify-center rounded-full [&_svg]:h-6 [&_svg]:w-6',
        tone === 'info' && 'bg-info/10 text-info',
        tone === 'success' && 'bg-success/10 text-success',
        tone === 'warning' && 'bg-warning/10 text-warning',
        tone === 'destructive' && 'bg-destructive/10 text-destructive',
      )}
      aria-hidden="true"
    >
      {children}
    </div>
  );
}

/** Inline message under a form title (errors, notices). */
export function FormNotice({ tone, children, id }: { tone: 'error' | 'info' | 'success'; children: ReactNode; id?: string }) {
  return (
    <div
      id={id}
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'rounded-md border px-3 py-2 text-sm',
        tone === 'error' && 'border-destructive/30 bg-destructive/5 text-destructive',
        tone === 'info' && 'border-info/30 bg-info/5 text-foreground',
        tone === 'success' && 'border-success/30 bg-success/5 text-foreground',
      )}
    >
      {children}
    </div>
  );
}
