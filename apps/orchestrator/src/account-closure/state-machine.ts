import type { AccountClosureRequestStatus } from './types.js';

export const ACCOUNT_CLOSURE_GRACE_MS = 7 * 24 * 60 * 60 * 1_000;

const REQUEST_TRANSITIONS: Readonly<Record<AccountClosureRequestStatus, readonly AccountClosureRequestStatus[]>> = {
  pending_grace: ['cancelled', 'processing'],
  cancelled: [],
  processing: ['needs_attention', 'completed'],
  needs_attention: ['processing'],
  completed: [],
};

export function assertRequestTransition(
  from: AccountClosureRequestStatus,
  to: AccountClosureRequestStatus,
): void {
  if (!REQUEST_TRANSITIONS[from].includes(to)) {
    throw new Error(`Invalid account closure request transition: ${from} -> ${to}`);
  }
}

export function canCancelClosure(
  status: AccountClosureRequestStatus,
  graceEndsAt: Date,
  now: Date,
): boolean {
  return status === 'pending_grace' && now.getTime() < graceEndsAt.getTime();
}

export function closureGraceEndsAt(requestedAt: Date): Date {
  return new Date(requestedAt.getTime() + ACCOUNT_CLOSURE_GRACE_MS);
}
