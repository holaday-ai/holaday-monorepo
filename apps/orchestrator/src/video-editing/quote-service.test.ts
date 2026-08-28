import { describe, expect, it, vi } from 'vitest';
import {
  VIDEO_EDIT_REGENERATION_COST_UNITS,
  VideoEditQuoteService,
  hashVideoEditOperationPlan,
} from './quote-service.js';
import type { VideoEditOperation } from './types.js';

const OPERATIONS: VideoEditOperation[] = [
  { kind: 'regenerate_scene', sceneId: 'scene_1', prompt: '改成清晨光线' },
];

function quoteRepository() {
  const consumedQuote = {
    id: 91,
    externalId: 'vedq_quote',
    userId: 7,
    projectId: 41,
    baseVersionId: 51,
    operationHash: hashVideoEditOperationPlan({
      projectId: 'vedp_project',
      baseVersionId: 'vedv_base',
      operations: OPERATIONS,
    }),
    operationJson: OPERATIONS,
    costUnits: VIDEO_EDIT_REGENERATION_COST_UNITS,
    status: 'pending' as const,
    expiresAt: new Date('2026-08-28T00:10:00Z'),
    consumedAt: null,
    createdAt: new Date('2026-08-28T00:00:00Z'),
  };
  return {
    createQuote: vi.fn(async (input) => ({
      id: 91,
      externalId: 'vedq_quote',
      userId: input.userId,
      projectId: 41,
      baseVersionId: 51,
      operationHash: input.operationHash,
      operationJson: input.operations,
      costUnits: input.costUnits,
      status: 'pending' as const,
      expiresAt: input.expiresAt,
      consumedAt: null,
      createdAt: new Date('2026-08-28T00:00:00Z'),
    })),
    checkQuote: vi.fn(async () => ({ status: 'valid' as const, quote: consumedQuote })),
    consumeQuote: vi.fn(async () => ({
      status: 'consumed' as const,
      quote: {
        ...consumedQuote,
        status: 'consumed' as const,
        consumedAt: new Date('2026-08-28T00:01:00Z'),
      },
    })),
  };
}

describe('video edit quote service', () => {
  it('canonicalizes object keys while preserving operation order', () => {
    const first = hashVideoEditOperationPlan({
      projectId: 'vedp_project',
      baseVersionId: 'vedv_base',
      operations: [{ kind: 'caption', sceneId: 'scene_1', text: '开场' }],
    });
    const second = hashVideoEditOperationPlan({
      operations: [{ text: '开场', sceneId: 'scene_1', kind: 'caption' } as VideoEditOperation],
      baseVersionId: 'vedv_base',
      projectId: 'vedp_project',
    });
    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });

  it('does not create a quote for free operations', async () => {
    const repository = quoteRepository();
    const service = new VideoEditQuoteService(repository);

    await expect(
      service.createQuote({
        userId: 7,
        projectId: 'vedp_project',
        baseVersionId: 'vedv_base',
        operations: [{ kind: 'caption', sceneId: 'scene_1', text: '开场' }],
        now: new Date('2026-08-28T00:00:00Z'),
      }),
    ).resolves.toEqual({ status: 'free' });
    expect(repository.createQuote).not.toHaveBeenCalled();
  });

  it('creates a ten-minute server-priced regeneration quote', async () => {
    const repository = quoteRepository();
    const service = new VideoEditQuoteService(repository);

    await expect(
      service.createQuote({
        userId: 7,
        projectId: 'vedp_project',
        baseVersionId: 'vedv_base',
        operations: OPERATIONS,
        now: new Date('2026-08-28T00:00:00Z'),
      }),
    ).resolves.toMatchObject({
      status: 'quoted',
      quote: {
        id: 'vedq_quote',
        costUnits: VIDEO_EDIT_REGENERATION_COST_UNITS,
        expiresAt: new Date('2026-08-28T00:10:00Z'),
      },
    });
    expect(repository.createQuote).toHaveBeenCalledWith(
      expect.objectContaining({
        costUnits: VIDEO_EDIT_REGENERATION_COST_UNITS,
        operationHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
  });

  it.each(['not_found', 'expired', 'already_consumed', 'mismatch', 'stale_base'] as const)(
    'does not charge or execute a rejected %s quote',
    async (status) => {
      const repository = quoteRepository();
      repository.checkQuote.mockResolvedValueOnce({ status } as never);
      const billing = { consume: vi.fn(), refund: vi.fn() };
      const execute = vi.fn();
      const service = new VideoEditQuoteService(repository);

      await expect(
        service.consumeAndExecute(
          {
            userId: 7,
            projectId: 'vedp_project',
            baseVersionId: 'vedv_base',
            quoteId: 'vedq_quote',
            operations: OPERATIONS,
            now: new Date('2026-08-28T00:01:00Z'),
          },
          { billing, execute },
        ),
      ).resolves.toEqual({ status });
      expect(billing.consume).not.toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();
    },
  );

  it('charges only after exact quote validation and executes the stored operation', async () => {
    const repository = quoteRepository();
    const billing = {
      consume: vi.fn(async () => ({ ok: true as const })),
      refund: vi.fn(async () => {}),
    };
    const execute = vi.fn(async () => ({ taskId: 'tsk_generation' }));
    const service = new VideoEditQuoteService(repository);

    await expect(
      service.consumeAndExecute(
        {
          userId: 7,
          projectId: 'vedp_project',
          baseVersionId: 'vedv_base',
          quoteId: 'vedq_quote',
          operations: OPERATIONS,
          now: new Date('2026-08-28T00:01:00Z'),
        },
        { billing, execute },
      ),
    ).resolves.toEqual({ status: 'started', taskId: 'tsk_generation' });
    expect(billing.consume).toHaveBeenCalledWith(VIDEO_EDIT_REGENERATION_COST_UNITS);
    expect(execute).toHaveBeenCalledWith({
      quoteId: 'vedq_quote',
      costUnits: VIDEO_EDIT_REGENERATION_COST_UNITS,
      operations: OPERATIONS,
    });
    expect(billing.refund).not.toHaveBeenCalled();
  });

  it('leaves a valid quote pending when billing denies the operation', async () => {
    const repository = quoteRepository();
    const billing = {
      consume: vi.fn(async () => ({ ok: false as const, reason: 'insufficient_balance' as const })),
      refund: vi.fn(async () => {}),
    };
    const execute = vi.fn();
    const service = new VideoEditQuoteService(repository);

    await expect(
      service.consumeAndExecute(
        {
          userId: 7,
          projectId: 'vedp_project',
          baseVersionId: 'vedv_base',
          quoteId: 'vedq_quote',
          operations: OPERATIONS,
        },
        { billing, execute },
      ),
    ).resolves.toEqual({ status: 'insufficient_balance' });
    expect(repository.consumeQuote).not.toHaveBeenCalled();
    expect(billing.refund).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('refunds exactly once when downstream generation fails', async () => {
    const repository = quoteRepository();
    const billing = {
      consume: vi.fn(async () => ({ ok: true as const })),
      refund: vi.fn(async () => {}),
    };
    const service = new VideoEditQuoteService(repository);

    await expect(
      service.consumeAndExecute(
        {
          userId: 7,
          projectId: 'vedp_project',
          baseVersionId: 'vedv_base',
          quoteId: 'vedq_quote',
          operations: OPERATIONS,
        },
        {
          billing,
          execute: vi.fn(async () => {
            throw new Error('provider unavailable');
          }),
        },
      ),
    ).resolves.toEqual({ status: 'downstream_failed' });
    expect(billing.refund).toHaveBeenCalledTimes(1);
  });
});
