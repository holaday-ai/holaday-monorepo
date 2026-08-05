import { describe, expect, it, vi } from 'vitest';
import { runTaskCreateIdempotently } from './tasks.js';

const response = { taskId: 'tsk_once', status: 'executing' };

describe('runTaskCreateIdempotently', () => {
  it('runs once and finalizes the claimed response', async () => {
    const run = vi.fn(async () => response);
    const finalize = vi.fn(async () => true);
    await expect(
      runTaskCreateIdempotently({
        clientRequestId: 'local_pending_123',
        claim: async () => ({ kind: 'claimed' }),
        finalize,
        release: async () => true,
        run,
      }),
    ).resolves.toEqual(response);
    expect(run).toHaveBeenCalledTimes(1);
    expect(finalize).toHaveBeenCalledWith('tsk_once', response);
  });

  it('replays the original response without creating another task', async () => {
    const run = vi.fn(async () => response);
    await expect(
      runTaskCreateIdempotently({
        clientRequestId: 'local_pending_123',
        claim: async () => ({
          kind: 'replay',
          conflictsWith: false,
          taskId: 'tsk_once',
          response,
        }),
        finalize: async () => true,
        release: async () => true,
        run,
      }),
    ).resolves.toEqual(response);
    expect(run).not.toHaveBeenCalled();
  });

  it('fails closed while the first request is still creating', async () => {
    await expect(
      runTaskCreateIdempotently({
        clientRequestId: 'local_pending_123',
        claim: async () => ({ kind: 'in_flight', claimedAt: new Date() }),
        finalize: async () => true,
        release: async () => true,
        run: async () => response,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('releases the claim when task creation fails', async () => {
    const release = vi.fn(async () => true);
    await expect(
      runTaskCreateIdempotently({
        clientRequestId: 'local_pending_123',
        claim: async () => ({ kind: 'claimed' }),
        finalize: async () => true,
        release,
        run: async () => {
          throw new Error('quota failed');
        },
      }),
    ).rejects.toThrow('quota failed');
    expect(release).toHaveBeenCalledTimes(1);
  });
});
