/** Rules for an admin moving a deal by hand (pipeline drag or "Move to…"). Pure, so it can be tested. */
import { DEAL_FLOW, statusConfig, type DealStatus } from '@/types/deal';

export type MoveKind = 'next' | 'skip' | 'back' | 'reopen' | 'decline' | 'same' | 'invalid';

export interface MovePlan {
  kind: MoveKind;
  /** stages jumped over when skipping forward */
  skipped: DealStatus[];
  /** decisions the server clears because of the move */
  clears: string[];
  /** why the move can't happen (kind = invalid) */
  reason?: string;
  /** a confirmation is required before calling admin_move_deal */
  confirm: boolean;
}

const idx = (s: string) => DEAL_FLOW.indexOf(s as DealStatus);

export function planMove(from: string, to: DealStatus): MovePlan {
  const none = { skipped: [], clears: [] };
  if (from === to) return { kind: 'same', confirm: false, ...none };
  if (to === 'declined') return { kind: 'decline', confirm: true, ...none };
  if (to === 'funded' && from !== 'approved') {
    return { kind: 'invalid', confirm: false, ...none, reason: 'Only an approved deal can be marked funded. Approve it for funding first.' };
  }
  const a = idx(from);
  const b = idx(to);
  if (to === 'incomplete') return { kind: 'back', confirm: true, skipped: [], clears: [] };
  if (b < 0) return { kind: 'invalid', confirm: false, ...none, reason: `Can't move a deal to ${statusConfig(to).label}.` };

  const clears: string[] = [];
  const creditIdx = idx('credit_review');
  const approvedIdx = idx('approved');
  if (a < 0) {
    // declined / incomplete → back into the flow
    if (b <= creditIdx) clears.push('the credit decision');
    return { kind: 'reopen', confirm: true, skipped: [], clears };
  }
  if (b < a) {
    if (b <= creditIdx && a > creditIdx) clears.push('the credit decision');
    if (b < approvedIdx && a >= approvedIdx) clears.push('the funding approval');
    return { kind: 'back', confirm: true, skipped: [], clears };
  }
  if (b === a + 1) return { kind: 'next', confirm: false, ...none };
  return { kind: 'skip', confirm: true, skipped: DEAL_FLOW.slice(a + 1, b), clears: [] };
}

/** One-paragraph explanation for the confirmation dialog. */
export function describeMove(from: string, to: DealStatus, plan = planMove(from, to)): string {
  const target = statusConfig(to).label;
  const parts: string[] = [];
  if (plan.kind === 'skip') {
    parts.push(`This skips ${plan.skipped.map((s) => statusConfig(s).label).join(', ')} — those checks will not have been done by AutoFlow.`);
  } else if (plan.kind === 'back') {
    parts.push(`This moves the deal back from ${statusConfig(from).label} to ${target}.`);
  } else if (plan.kind === 'reopen') {
    parts.push(`This reopens a ${statusConfig(from).label.toLowerCase()} deal in ${target}.`);
  }
  if (plan.clears.length) parts.push(`Later decisions are cleared: ${plan.clears.join(' and ')}. They will have to be made again.`);
  parts.push('The move is logged on the deal timeline.');
  return parts.join(' ');
}
