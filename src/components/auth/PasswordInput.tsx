import { forwardRef, useState } from 'react';
import { Eye, EyeOff, Check, Circle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { checkPassword } from '@/lib/password';
import { cn } from '@/lib/utils';

type PasswordInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>;

/** Password field with a show/hide button. */
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(({ className, ...props }, ref) => {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input
        ref={ref}
        type={visible ? 'text' : 'password'}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className={cn('pr-11', className)}
        {...props}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        {visible ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
      </button>
    </div>
  );
});
PasswordInput.displayName = 'PasswordInput';

/** New password + confirmation with the live checklist of rules. */
export function NewPasswordFields({ password, confirmation, onPassword, onConfirmation, disabled }: {
  password: string;
  confirmation: string;
  onPassword: (v: string) => void;
  onConfirmation: (v: string) => void;
  disabled?: boolean;
}) {
  const checks = checkPassword(password);
  const matches = confirmation.length > 0 && confirmation === password;
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="new-password">New password</Label>
        <PasswordInput
          id="new-password"
          name="new-password"
          autoComplete="new-password"
          required
          disabled={disabled}
          value={password}
          onChange={(e) => onPassword(e.target.value)}
          aria-describedby="password-rules"
        />
        <ul id="password-rules" className="space-y-1 pt-1 text-sm" aria-label="Password rules">
          {checks.map((c) => (
            <li key={c.id} className={cn('flex items-center gap-2', c.ok ? 'text-success' : 'text-muted-foreground')}>
              {c.ok ? <Check className="h-4 w-4" aria-hidden="true" /> : <Circle className="h-3 w-3 mx-0.5" aria-hidden="true" />}
              <span>{c.label}</span>
              <span className="sr-only">{c.ok ? '(done)' : '(not yet)'}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirm-password">Confirm new password</Label>
        <PasswordInput
          id="confirm-password"
          name="confirm-password"
          autoComplete="new-password"
          required
          disabled={disabled}
          value={confirmation}
          onChange={(e) => onConfirmation(e.target.value)}
          aria-invalid={confirmation.length > 0 && !matches}
          aria-describedby="confirm-hint"
        />
        <p id="confirm-hint" className={cn('text-sm', !confirmation ? 'sr-only' : matches ? 'text-success' : 'text-muted-foreground')} aria-live="polite">
          {!confirmation ? 'Type the same password again.' : matches ? 'Passwords match.' : 'Passwords don’t match yet.'}
        </p>
      </div>
    </div>
  );
}
