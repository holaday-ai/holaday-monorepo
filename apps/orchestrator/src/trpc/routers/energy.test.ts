import { describe, expect, it, vi } from 'vitest';
import { energyRouter } from './energy.js';

describe('energyRouter', () => {
  it('returns the catalog for an authenticated caller', async () => {
    const logger = { info: vi.fn() };
    const caller = energyRouter.createCaller({ userId: 'usr_energy', logger } as never);

    const home = await caller.home();

    expect(home.experiences[0]).toMatchObject({ id: 'tarot' });
  });

  it('requires an authenticated caller', async () => {
    const caller = energyRouter.createCaller({ userId: null, logger: { info: vi.fn() } } as never);

    await expect(caller.home()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('logs only bounded event fields', async () => {
    const logger = { info: vi.fn() };
    const caller = energyRouter.createCaller({ userId: 'usr_energy', logger } as never);

    await expect(
      caller.reportEvent({
        type: 'completed',
        experienceId: 'tarot',
        mood: 'tired',
        durationBucket: 'under-60s',
        outcome: 'success',
      }),
    ).resolves.toEqual({ ok: true });

    expect(logger.info).toHaveBeenCalledWith(
      {
        event: 'energy_experience_event',
        type: 'completed',
        experienceId: 'tarot',
        mood: 'tired',
        durationBucket: 'under-60s',
        outcome: 'success',
      },
      'energy experience event',
    );
  });

  it('rejects unbounded event fields', async () => {
    const logger = { info: vi.fn() };
    const caller = energyRouter.createCaller({ userId: 'usr_energy', logger } as never);

    await expect(
      caller.reportEvent({
        type: 'completed',
        experienceId: 'tarot',
        mood: 'tired',
        durationBucket: 'under-60s',
        outcome: 'success',
        answerText: 'private free-form detail',
      } as never),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(logger.info).not.toHaveBeenCalled();
  });
});
