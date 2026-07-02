import { describe, expect, it } from 'vitest';
import { deriveTaskProductState } from './task-product-state';

describe('deriveTaskProductState', () => {
  it('treats terminal outcomes as terminal and keeps paused resumable', () => {
    expect(deriveTaskProductState({ status: 'completed' })).toEqual({
      lifecycle: 'terminal',
      outcome: 'completed',
    });
    expect(deriveTaskProductState({ status: 'partial_success' })).toEqual({
      lifecycle: 'terminal',
      outcome: 'partial_success',
    });
    expect(deriveTaskProductState({ status: 'paused' })).toEqual({
      lifecycle: 'paused',
    });
    expect(
      deriveTaskProductState({ status: 'paused', terminal: true }),
    ).toEqual({
      lifecycle: 'paused',
    });
  });

  it('lets waiting-user state override stale running phase markers', () => {
    expect(
      deriveTaskProductState({
        status: 'executing',
        subStatus: 'browsing',
        awaitingKind: 'login',
      }),
    ).toEqual({
      lifecycle: 'waiting_user',
      blocker: 'login',
    });
    expect(
      deriveTaskProductState({
        status: 'executing',
        subStatus: 'generating',
        hasAwaitingUser: true,
      }),
    ).toEqual({
      lifecycle: 'waiting_user',
      blocker: 'clarification',
    });
  });

  it('keeps queued state separate from running live phases', () => {
    expect(
      deriveTaskProductState({
        status: 'queued',
        subStatus: 'generating',
        queuePosition: 3,
        tickCount: 0,
      }),
    ).toEqual({
      lifecycle: 'queued',
      queuePosition: 3,
    });
    expect(
      deriveTaskProductState({
        status: 'executing',
        subStatus: 'browsing',
        queuePosition: 2,
        tickCount: 0,
      }),
    ).toEqual({
      lifecycle: 'queued',
      queuePosition: 2,
    });
  });

  it('maps running statuses to a running phase', () => {
    expect(deriveTaskProductState({ status: 'planning' })).toEqual({
      lifecycle: 'running',
      phase: 'planning',
    });
    expect(
      deriveTaskProductState({ status: 'executing', subStatus: 'verifying' }),
    ).toEqual({
      lifecycle: 'running',
      phase: 'verifying',
    });
  });

  it('does not let unknown statuses masquerade as running', () => {
    expect(deriveTaskProductState({ status: 'archived' })).toEqual({
      lifecycle: 'unknown',
    });
    expect(deriveTaskProductState({ status: 'unknown' })).toEqual({
      lifecycle: 'unknown',
    });
  });
});
