/**
 * Password rules for every place a user chooses a password (reset link, invitation).
 * At least 10 characters, with at least one letter and one number. Letters include accented
 * ones (é, Ç…), so French passphrases work.
 */
export const PASSWORD_MIN_LENGTH = 10;

export type PasswordRuleId = 'length' | 'letter' | 'number';

export interface PasswordRule {
  id: PasswordRuleId;
  label: string;
  test: (password: string) => boolean;
}

export const PASSWORD_RULES: PasswordRule[] = [
  {
    id: 'length',
    label: `At least ${PASSWORD_MIN_LENGTH} characters`,
    // count characters, not UTF-16 code units
    test: (pw) => Array.from(pw).length >= PASSWORD_MIN_LENGTH,
  },
  { id: 'letter', label: 'At least one letter', test: (pw) => /\p{L}/u.test(pw) },
  { id: 'number', label: 'At least one number', test: (pw) => /\p{Nd}/u.test(pw) },
];

export interface PasswordCheck {
  id: PasswordRuleId;
  label: string;
  ok: boolean;
}

/** Each rule with whether the password meets it — drives the live checklist. */
export function checkPassword(password: string): PasswordCheck[] {
  return PASSWORD_RULES.map((r) => ({ id: r.id, label: r.label, ok: r.test(password) }));
}

export function isPasswordValid(password: string): boolean {
  return PASSWORD_RULES.every((r) => r.test(password));
}

/**
 * The first problem with a new password + confirmation, as a sentence for the form,
 * or null when both are fine.
 */
export function passwordProblem(password: string, confirmation: string): string | null {
  const failed = PASSWORD_RULES.find((r) => !r.test(password));
  if (failed) {
    if (failed.id === 'length') return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
    if (failed.id === 'letter') return 'Include at least one letter.';
    return 'Include at least one number.';
  }
  if (password !== confirmation) return 'The two passwords don’t match.';
  return null;
}
