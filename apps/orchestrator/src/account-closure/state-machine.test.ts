import { describe, expect, it } from 'vitest';
import {
  assertRequestTransition,
  canCancelClosure,
  closureGraceEndsAt,
} from './state-machine.js';

describe('account closure request state machine', () => {
  it.each([
    ['pending_grace', 'cancelled'],
    ['pending_grace', 'processing'],
    ['processing', 'needs_attention'],
    ['processing', 'completed'],
    ['needs_attention', 'processing'],
  ] as const)('allows %s to transition to %s', (from, to) => {
    expect(() => assertRequestTransition(from, to)).not.toThrow();
  });

  it('rejects cancellation after the request has started processing', () => {
    expect(() => assertRequestTransition('cancelled', 'processing')).toThrow(
      'Invalid account closure request transition: cancelled -> processing',
    );
  });

  it.each(['pending_grace', 'cancelled', 'processing', 'needs_attention', 'completed'] as const)(
    'rejects reopening a completed request to %s',
    (to) => {
      expect(() => assertRequestTransition('completed', to)).toThrow(
        `Invalid account closure request transition: completed -> ${to}`,
      );
    },
  );

  it('permits cancellation only before the exact grace deadline', () => {
    const graceEndsAt = new Date('2026-03-08T07:00:00.000Z');

    expect(
      canCancelClosure('pending_grace', graceEndsAt, new Date('2026-03-08T06:59:59.999Z')),
    ).toBe(true);
    expect(canCancelClosure('pending_grace', graceEndsAt, graceEndsAt)).toBe(false);
    expect(
      canCancelClosure('pending_grace', graceEndsAt, new Date('2026-03-08T07:00:00.001Z')),
    ).toBe(false);
  });

  it('adds exactly 168 elapsed hours across a DST boundary', () => {
    const requestedAt = new Date('2026-03-08T06:30:00.000Z');

    expect(closureGraceEndsAt(requestedAt).toISOString()).toBe('2026-03-15T06:30:00.000Z');
  });
});
