import { describe, expect, it, vi } from 'vitest';
import { energyRouter } from './energy.js';

describe('energyRouter', () => {
  it('returns the catalog for an authenticated caller', async () => {
    const logger = { info: vi.fn() };
    const caller = energyRouter.createCaller({ userId: 'usr_energy', logger } as never);

    const home = await caller.home();

    expect(home.experiences[0]).toMatchObject({ id: 'recharge' });
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
        experienceId: 'recharge',
        energyNeed: 'relax',
        durationBucket: 'under-60s',
        outcome: 'success',
      }),
    ).resolves.toEqual({ ok: true });

    expect(logger.info).toHaveBeenCalledWith(
      {
        event: 'energy_experience_event',
        type: 'completed',
        experienceId: 'recharge',
        energyNeed: 'relax',
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
        energyNeed: 'relax',
        durationBucket: 'under-60s',
        outcome: 'success',
        answerText: 'private free-form detail',
      } as never),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('accepts all bounded content-hub events', async () => {
    const logger = { info: vi.fn() };
    const caller = energyRouter.createCaller({ userId: 'usr_energy', logger } as never);
    const events = [
      { type: 'energy_section_viewed', section: 'feed' },
      { type: 'astrology_range_opened', range: 'monthly' },
      { type: 'tarot_mode_started', mode: 'three' },
      { type: 'tarot_redrawn', mode: 'single' },
      { type: 'light_test_started', testId: 'emotion-battery' },
      { type: 'light_test_completed', testId: 'emotion-battery' },
      { type: 'energy_feed_refreshed' },
      { type: 'energy_content_opened', contentId: 'relax-breath-window' },
      {
        type: 'energy_content_opened',
        contentId: 'relax-breath-window',
        targetType: 'practice',
      },
      {
        type: 'energy_experience_completed',
        experienceId: 'practice',
        modeId: 'breath-window',
        energyNeed: 'relax',
        durationBucket: 'under-60s',
        outcome: 'success',
      },
      { type: 'energy_continuation_opened', fromKind: 'recharge', targetType: 'test' },
      { type: 'energy_feed_exhausted', energyNeed: 'focus', batchCount: 6 },
      { type: 'energy_section_navigated', section: 'astrology' },
      { type: 'running_task_returned', taskStatus: 'running' },
    ] as const;

    for (const event of events) {
      await expect(caller.reportEvent(event as never)).resolves.toEqual({ ok: true });
    }
    expect(logger.info).toHaveBeenCalledTimes(events.length);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'energy_experience_event',
        type: 'energy_experience_completed',
        experienceId: 'practice',
        modeId: 'breath-window',
      }),
      'energy experience event',
    );
  });

  it('rejects private text, provider bodies, unknown keys and invalid ids', async () => {
    const logger = { info: vi.fn() };
    const caller = energyRouter.createCaller({ userId: 'usr_energy', logger } as never);
    const invalid = [
      { type: 'light_test_completed', testId: 'emotion-battery', answerText: 'secret' },
      { type: 'tarot_redrawn', mode: 'single', questionText: 'private question' },
      { type: 'astrology_range_opened', range: 'daily', providerBody: 'full response' },
      { type: 'energy_content_opened', contentId: 'contains private spaces' },
      { type: 'energy_content_opened', contentId: 'made-up-slug' },
      {
        type: 'energy_experience_started',
        experienceId: 'poll',
        modeId: 'made-up-slug',
        energyNeed: 'relax',
        durationBucket: null,
        outcome: null,
      },
    ];

    for (const event of invalid) {
      await expect(caller.reportEvent(event as never)).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });
    }
    expect(logger.info).not.toHaveBeenCalled();
  });
});
