import { describe, expect, it } from 'vitest';
import { PASSWORD_MIN_LENGTH, checkPassword, isPasswordValid, passwordProblem } from './password';

describe('password rules', () => {
  it('requires at least 10 characters, one letter and one number', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(10);
    expect(isPasswordValid('abcdefghi1')).toBe(true);
    expect(isPasswordValid('abcdefgh1')).toBe(false); // 9 chars
    expect(isPasswordValid('abcdefghij')).toBe(false); // no number
    expect(isPasswordValid('1234567890')).toBe(false); // no letter
    expect(isPasswordValid('')).toBe(false);
  });

  it('accepts accented letters and counts characters, not code units', () => {
    expect(isPasswordValid('éééééééé12')).toBe(true);
    expect(isPasswordValid('Ça-roule-2026')).toBe(true);
    // 9 characters, one of which is an astral emoji (2 UTF-16 code units)
    expect(isPasswordValid('abcdefg1😀')).toBe(false);
  });

  it('accepts symbols and spaces alongside the required letter and number', () => {
    expect(isPasswordValid('my car is 4 me!')).toBe(true);
  });

  it('reports each rule for the live checklist', () => {
    expect(checkPassword('abc')).toEqual([
      { id: 'length', label: 'At least 10 characters', ok: false },
      { id: 'letter', label: 'At least one letter', ok: true },
      { id: 'number', label: 'At least one number', ok: false },
    ]);
    expect(checkPassword('abcdefghi1').every((c) => c.ok)).toBe(true);
  });

  it('explains the first problem, then a confirmation mismatch', () => {
    expect(passwordProblem('short1', 'short1')).toBe('Use at least 10 characters.');
    expect(passwordProblem('1234567890', '1234567890')).toBe('Include at least one letter.');
    expect(passwordProblem('abcdefghij', 'abcdefghij')).toBe('Include at least one number.');
    expect(passwordProblem('abcdefghi1', 'abcdefghi2')).toMatch(/don.t match/);
    expect(passwordProblem('abcdefghi1', 'abcdefghi1')).toBeNull();
  });
});
