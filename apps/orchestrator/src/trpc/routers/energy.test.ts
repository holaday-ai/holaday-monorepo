import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NormalizedEnergyBucket } from '../../energy/analytics-bucket.js';
import type {
  EnergyAnalyticsStore,
  EnergyAnalyticsTransaction,
} from '../../energy/analytics-store.js';
import { _resetAllBucketsForTesting } from '../../quota/rate-limiter.js';
import { createEnergyRouter } from './energy.js';

const NOW = new Date('2026-08-16T12:00:00.000Z');
const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const CONFIG = {
  enabled: true,
  hmacSecret: '0123456789abcdef0123456789abcdef',
  visitorRetentionDays: 30,
  metricRetentionDays: 400,
  receiptRetentionHours: 48,
} as const;

class MemoryStore implements EnergyAnalyticsStore {
  readonly receipts = new Set<string>();
  readonly metrics = new Map<string, number>();
  readonly visitors = new Set<string>();

  async readMetricRows() {
    return [];
  }

  async readDailyAudience() {
    return [];
  }

  async transaction<T>(callback: (tx: EnergyAnalyticsTransaction) => Promise<T>): Promise<T> {
    const receipts = new Set(this.receipts);
    const metrics = new Map(this.metrics);
    const visitors = new Set(this.visitors);
    const tx: EnergyAnalyticsTransaction = {
      claimReceipt: async (eventId) => {
        if (receipts.has(eventId)) return false;
        receipts.add(eventId);
        return true;
      },
      incrementMetric: async (bucket: NormalizedEnergyBucket) => {
        const key = `${bucket.metricDate}:${bucket.bucketHash}`;
        metrics.set(key, (metrics.get(key) ?? 0) + 1);
      },
      insertVisitor: async (activityDate, visitorHash) => {
        const key = `${activityDate}:${visitorHash}`;
        if (visitors.has(key)) return false;
        visitors.add(key);
        return true;
      },
    };

    const result = await callback(tx);
    this.receipts.clear();
    this.metrics.clear();
    this.visitors.clear();
    for (const value of receipts) this.receipts.add(value);
    for (const [key, value] of metrics) this.metrics.set(key, value);
    for (const value of visitors) this.visitors.add(value);
    return result;
  }
}

function setup() {
  const store = new MemoryStore();
  const logger = { info: vi.fn(), warn: vi.fn() };
  const energyRouter = createEnergyRouter({
    createStore: () => store,
    config: CONFIG,
    now: () => NOW,
  });
  const caller = energyRouter.createCaller({
    userId: 'usr_energy',
    logger,
    db: {},
  } as never);
  return { caller, energyRouter, logger, store };
}

function roleDatabase(role: 'admin' | 'member' | null) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (role === null ? [] : [{ role, status: 'active' }]),
        }),
      }),
    }),
  };
}

beforeEach(() => {
  _resetAllBucketsForTesting();
});

describe('energyRouter', () => {
  it('returns the catalog for an authenticated caller and rejects an anonymous caller', async () => {
    const { caller, energyRouter, logger } = setup();

    const home = await caller.home();
    expect(home.experiences[0]).toMatchObject({ id: 'recharge' });
    await expect(
      energyRouter.createCaller({ userId: null, logger, db: {} } as never).home(),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('persists a bounded event and returns the storage result', async () => {
    const { caller, store } = setup();

    await expect(
      caller.reportEvent({ eventId: EVENT_ID, type: 'energy_home_viewed' }),
    ).resolves.toEqual({ ok: true, duplicate: false, visitorRecorded: true });
    expect(store.receipts).toEqual(new Set([EVENT_ID]));
    expect([...store.metrics.values()]).toEqual([1]);
    expect(store.visitors.size).toBe(1);
  });

  it('deduplicates a retry carrying the same event id', async () => {
    const { caller, store } = setup();
    const event = { eventId: EVENT_ID, type: 'energy_need_selected', energyNeed: 'focus' } as const;

    await caller.reportEvent(event);
    await expect(caller.reportEvent(event)).resolves.toEqual({
      ok: true,
      duplicate: true,
      visitorRecorded: false,
    });
    expect([...store.metrics.values()]).toEqual([1]);
  });

  it('rate-limits analytics admission per user before persistence', async () => {
    const { caller, energyRouter, logger, store } = setup();
    const otherCaller = energyRouter.createCaller({
      userId: 'usr_other_energy',
      logger,
      db: {},
    } as never);

    for (let attempt = 0; attempt < 120; attempt += 1) {
      await expect(caller.reportEvent({ type: 'energy_feed_refreshed' })).resolves.toMatchObject({
        ok: true,
      });
    }
    await expect(otherCaller.reportEvent({ type: 'energy_feed_refreshed' })).resolves.toMatchObject(
      { ok: true },
    );
    await expect(caller.reportEvent({ type: 'energy_feed_refreshed' })).rejects.toMatchObject({
      code: 'TOO_MANY_REQUESTS',
    });
    expect([...store.metrics.values()].reduce((sum, value) => sum + value, 0)).toBe(121);
  });

  it('keeps a legacy client without eventId writable', async () => {
    const { caller, store } = setup();

    await expect(
      caller.reportEvent({
        type: 'completed',
        experienceId: 'recharge',
        energyNeed: 'relax',
        durationBucket: 'under-60s',
        outcome: 'success',
      }),
    ).resolves.toEqual({ ok: true, duplicate: false, visitorRecorded: false });
    expect([...store.metrics.values()]).toEqual([1]);
  });

  it('accepts every bounded content-hub event', async () => {
    const { caller, store } = setup();
    const events = [
      { type: 'energy_home_viewed' },
      { type: 'energy_need_selected', energyNeed: 'confidence' },
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
        type: 'energy_experience_started',
        experienceId: 'practice',
        modeId: 'breath-window',
        energyNeed: 'relax',
        durationBucket: null,
        outcome: null,
      },
      {
        type: 'energy_experience_replayed',
        experienceId: 'practice',
        modeId: 'breath-window',
        energyNeed: 'relax',
        durationBucket: 'under-60s',
        outcome: 'success',
      },
      {
        type: 'energy_experience_completed',
        experienceId: 'practice',
        modeId: 'breath-window',
        energyNeed: 'relax',
        durationBucket: 'under-60s',
        outcome: 'success',
      },
      {
        type: 'energy_experience_failed',
        experienceId: 'practice',
        modeId: 'breath-window',
        energyNeed: 'relax',
        durationBucket: 'under-60s',
        outcome: 'error',
      },
      { type: 'energy_continuation_opened', fromKind: 'recharge', targetType: 'test' },
      { type: 'energy_feed_exhausted', energyNeed: 'focus', batchCount: 6 },
      { type: 'energy_section_navigated', section: 'astrology' },
      { type: 'running_task_returned', taskStatus: 'running' },
    ] as const;

    for (const event of events) {
      await expect(caller.reportEvent(event as never)).resolves.toMatchObject({ ok: true });
    }
    expect([...store.metrics.values()].reduce((sum, value) => sum + value, 0)).toBe(events.length);
  });

  it('rejects private text, provider bodies, unknown keys and invalid ids', async () => {
    const { caller, store } = setup();
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
    expect(store.metrics.size).toBe(0);
  });

  it('does not log analytics payloads', async () => {
    const { caller, logger } = setup();

    await caller.reportEvent({
      type: 'energy_content_opened',
      contentId: 'relax-breath-window',
      targetType: 'practice',
    });

    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('returns aggregate metrics only to an active admin', async () => {
    const { energyRouter, logger } = setup();
    const caller = energyRouter.createCaller({
      userId: 'usr_admin',
      logger,
      db: roleDatabase('admin'),
    } as never);

    const result = await caller.metrics({ window: 7 });

    expect(result).toMatchObject({
      window: 7,
      startDate: '2026-08-10',
      endDate: '2026-08-16',
      totals: { homeViews: 0, startsPerVisit: null },
    });
    expect(JSON.stringify(result)).not.toMatch(/visitorHash|eventId|userId|\bhash\b/i);
  });

  it('rejects non-admin, unauthenticated and unbounded metric queries', async () => {
    const { energyRouter, logger } = setup();

    await expect(
      energyRouter
        .createCaller({
          userId: 'usr_member',
          logger,
          db: roleDatabase('member'),
        } as never)
        .metrics({ window: 7 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      energyRouter
        .createCaller({ userId: null, logger, db: roleDatabase(null) } as never)
        .metrics({ window: 7 }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(
      energyRouter
        .createCaller({
          userId: 'usr_admin',
          logger,
          db: roleDatabase('admin'),
        } as never)
        .metrics({ window: 7, userId: 'usr_private' } as never),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});
