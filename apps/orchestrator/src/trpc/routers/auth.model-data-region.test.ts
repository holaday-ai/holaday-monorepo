import { beforeEach, describe, expect, it, vi } from 'vitest';

const { assignPersonalModelDataRegionMock } = vi.hoisted(() => ({
  assignPersonalModelDataRegionMock: vi.fn(),
}));

vi.mock('../../llm/model-data-region-assignment.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../llm/model-data-region-assignment.js')>();
  return {
    ...actual,
    assignPersonalModelDataRegion: assignPersonalModelDataRegionMock,
  };
});

import { ModelDataRegionAssignmentError } from '../../llm/model-data-region-assignment.js';
import { authRouter } from './auth.js';

describe('auth model data region', () => {
  beforeEach(() => {
    assignPersonalModelDataRegionMock.mockReset();
    assignPersonalModelDataRegionMock.mockResolvedValue({ region: 'cn', changed: true });
  });

  it('assigns the authenticated personal region through the one-time domain boundary', async () => {
    const db = {};
    const caller = authRouter.createCaller({
      db,
      userId: 'usr_actor',
      logger: { error: vi.fn() },
    } as never);

    await expect(caller.assignModelDataRegion({ region: 'cn' })).resolves.toEqual({
      region: 'cn',
      changed: true,
    });
    expect(assignPersonalModelDataRegionMock).toHaveBeenCalledWith({
      db,
      actorExternalId: 'usr_actor',
      region: 'cn',
    });
  });

  it('maps a second different assignment to conflict and accepts no force flag', async () => {
    assignPersonalModelDataRegionMock.mockRejectedValue(
      new ModelDataRegionAssignmentError('REGION_ALREADY_ASSIGNED'),
    );
    const caller = authRouter.createCaller({
      db: {},
      userId: 'usr_actor',
      logger: { error: vi.fn() },
    } as never);

    await expect(caller.assignModelDataRegion({ region: 'intl' })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    await expect(
      caller.assignModelDataRegion({ region: 'cn', force: true } as never),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('rejects unsupported region values at the router boundary', async () => {
    const caller = authRouter.createCaller({
      db: {},
      userId: 'usr_actor',
      logger: { error: vi.fn() },
    } as never);

    await expect(caller.assignModelDataRegion({ region: 'us' } as never)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(assignPersonalModelDataRegionMock).not.toHaveBeenCalled();
  });
});
