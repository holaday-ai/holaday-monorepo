import { describe, expect, it, vi } from 'vitest';
import type { AccountClosureHandler } from './handler-contract.js';
import {
  type AccountClosureWorkerRepository,
  CLOSURE_RETRY_DELAYS_MS,
  type ClaimedClosureWork,
  runAccountClosureWorkerLoop,
  runAccountClosureWorkerTick,
} from './worker.js';

const NOW = new Date('2026-08-26T12:00:00.000Z');

function claim(overrides: Partial<ClaimedClosureWork> = {}): ClaimedClosureWork {
  return {
    kind: 'handler',
    stepId: 11,
    requestId: 22,
    requestExternalId: 'acl_test',
    userId: 33,
    userExternalId: 'usr_test',
    categoryId: 'account_security',
    handlerVersion: 1,
    attemptCount: 0,
    checkpoint: null,
    processedCount: 0,
    leaseOwner: 'worker-a',
    ...overrides,
  };
}

function completionClaim(attemptCount = 0): ClaimedClosureWork {
  return {
    kind: 'completion',
    requestId: 22,
    requestExternalId: 'acl_test',
    userId: 33,
    userExternalId: 'usr_test',
    attemptCount,
    leaseOwner: 'worker-a',
  };
}

function repository(next: ClaimedClosureWork | null = claim()) {
  const repo: AccountClosureWorkerRepository = {
    claimNextStep: vi.fn().mockResolvedValue(next),
    renewLease: vi.fn().mockResolvedValue(true),
    markStepContinuation: vi.fn().mockResolvedValue(true),
    markStepSucceeded: vi.fn().mockResolvedValue(true),
    markStepRetryable: vi.fn().mockResolvedValue(true),
    markStepBlocked: vi.fn().mockResolvedValue(true),
    markCompletionRetry: vi.fn().mockResolvedValue(true),
    completeRequest: vi.fn().mockResolvedValue('completed'),
  };
  return repo;
}

function handler(
  result: Awaited<ReturnType<AccountClosureHandler['run']>> = {
    kind: 'complete',
    processed: 1,
    retention: 'deleted',
  },
): AccountClosureHandler {
  return {
    categoryId: 'account_security',
    version: 1,
    run: vi.fn().mockResolvedValue(result),
  };
}

function deps(input: {
  repository?: AccountClosureWorkerRepository;
  handler?: AccountClosureHandler;
  enabled?: boolean;
  rssBytes?: number;
}) {
  const selected = input.handler ?? handler();
  return {
    db: {} as never,
    handlers: new Map([[selected.categoryId, selected]]),
    workerId: 'worker-a',
    now: () => NOW,
    rssBytes: () => input.rssBytes ?? 1,
    enabled: input.enabled ?? true,
    repository: input.repository ?? repository(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
    storage: {} as never,
  };
}

describe('account closure durable worker', () => {
  it('uses the exact bounded retry schedule', () => {
    expect(CLOSURE_RETRY_DELAYS_MS).toEqual([60_000, 300_000, 1_800_000, 7_200_000, 21_600_000]);
  });

  it('does not claim work while disabled or above the 480MB guard', async () => {
    const disabledRepo = repository();
    expect(
      await runAccountClosureWorkerTick(deps({ enabled: false, repository: disabledRepo })),
    ).toBe('disabled');
    expect(disabledRepo.claimNextStep).not.toHaveBeenCalled();

    const guardedRepo = repository();
    expect(
      await runAccountClosureWorkerTick(
        deps({ repository: guardedRepo, rssBytes: 480 * 1024 * 1024 }),
      ),
    ).toBe('memory_guard');
    expect(guardedRepo.claimNextStep).not.toHaveBeenCalled();
  });

  it('claims once, runs one page at size 100, and atomically saves continuation', async () => {
    const repo = repository();
    const pageHandler = handler({
      kind: 'continue',
      checkpoint: { cursor: 100, processedCount: 100 },
      processed: 100,
    });
    expect(
      await runAccountClosureWorkerTick(deps({ repository: repo, handler: pageHandler })),
    ).toBe('progress');
    expect(repo.claimNextStep).toHaveBeenCalledTimes(1);
    expect(pageHandler.run).toHaveBeenCalledTimes(1);
    expect(pageHandler.run).toHaveBeenCalledWith(expect.objectContaining({ pageSize: 100 }));
    expect(repo.markStepContinuation).toHaveBeenCalledWith(
      expect.objectContaining({
        stepId: 11,
        leaseOwner: 'worker-a',
        checkpoint: { cursor: 100, processedCount: 100 },
        processedCount: 100,
      }),
    );
    expect(repo.markStepSucceeded).not.toHaveBeenCalled();
  });

  it('writes succeeded and retention outcome together', async () => {
    const repo = repository();
    expect(await runAccountClosureWorkerTick(deps({ repository: repo }))).toBe('progress');
    expect(repo.markStepSucceeded).toHaveBeenCalledWith(
      expect.objectContaining({ retentionOutcome: 'deleted', processedCount: 1 }),
    );
  });

  it.each(CLOSURE_RETRY_DELAYS_MS.map((delay, index) => [index, delay] as const))(
    'schedules failure %i using the exact delay',
    async (attemptCount, delay) => {
      const repo = repository(claim({ attemptCount }));
      const failing = handler();
      vi.mocked(failing.run).mockRejectedValueOnce(new Error('provider content must not leak'));
      expect(await runAccountClosureWorkerTick(deps({ repository: repo, handler: failing }))).toBe(
        attemptCount === 4 ? 'attention' : 'progress',
      );
      if (attemptCount < 4) {
        expect(repo.markStepRetryable).toHaveBeenCalledWith(
          expect.objectContaining({ nextAttemptAt: new Date(NOW.getTime() + delay) }),
        );
      } else {
        expect(repo.markStepBlocked).toHaveBeenCalledWith(
          expect.objectContaining({
            nextAttemptAt: new Date(NOW.getTime() + 24 * 60 * 60 * 1_000),
          }),
        );
      }
    },
  );

  it('blocks a missing handler without pretending it was skipped', async () => {
    const repo = repository();
    const input = deps({ repository: repo });
    input.handlers.clear();
    expect(await runAccountClosureWorkerTick(input)).toBe('attention');
    expect(repo.markStepBlocked).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: 'handler_missing' }),
    );
    expect(repo.markStepSucceeded).not.toHaveBeenCalled();
  });

  it('persists completion retry state separately and slows the fifth failure to 24 hours', async () => {
    const repo = repository(completionClaim(4));
    vi.mocked(repo.completeRequest).mockRejectedValueOnce(new Error('finalization gate'));
    expect(await runAccountClosureWorkerTick(deps({ repository: repo }))).toBe('attention');
    expect(repo.markCompletionRetry).toHaveBeenCalledWith({
      requestId: 22,
      leaseOwner: 'worker-a',
      errorCode: 'provider_unavailable',
      blocked: true,
      nextAttemptAt: new Date(NOW.getTime() + 24 * 60 * 60 * 1_000),
    });
    expect(repo.markStepBlocked).not.toHaveBeenCalled();
  });

  it('renews a claimed lease before executing and refuses to persist after lease loss', async () => {
    const repo = repository();
    vi.mocked(repo.renewLease).mockResolvedValueOnce(false);
    const pageHandler = handler();
    expect(
      await runAccountClosureWorkerTick(deps({ repository: repo, handler: pageHandler })),
    ).toBe('idle');
    expect(pageHandler.run).not.toHaveBeenCalled();
  });

  it('finishes the in-flight page after SIGTERM state and refuses a new claim', async () => {
    let stopping = false;
    let finishPage!: () => void;
    const inFlight = new Promise<void>((resolve) => {
      finishPage = resolve;
    });
    const tick = vi.fn(async () => {
      await inFlight;
      return 'progress' as const;
    });
    const wait = vi.fn(async () => undefined);
    const loop = runAccountClosureWorkerLoop({ tick, wait, shouldStop: () => stopping });
    await vi.waitFor(() => expect(tick).toHaveBeenCalledTimes(1));
    stopping = true;
    finishPage();
    await loop;
    expect(tick).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });
});
