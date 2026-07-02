import { afterEach, describe, expect, it } from 'vitest';
import type { ApiCostPoolEvent } from '../db/schema/partner.js';
import type { DailyLockedBonusSummary } from './allocation-service.js';
import type { MonthlyReleaseSummary } from './release-service.js';
import {
  runPartnerDailyJobs,
  runPartnerMonthlyRelease,
  type PartnerAllocationService,
  type PartnerReleaseService,
} from './schedulers.js';

const originalPartnerFxBps = process.env.PARTNER_FX_BPS;

afterEach(() => {
  if (originalPartnerFxBps === undefined) {
    delete process.env.PARTNER_FX_BPS;
  } else {
    process.env.PARTNER_FX_BPS = originalPartnerFxBps;
  }
});

class FakeAllocationService implements PartnerAllocationService {
  readonly calls: Array<{ name: 'buildDailyCostPool' | 'allocateDailyLockedBonus'; input: unknown }> = [];

  constructor(private readonly apiUnits: number) {}

  async buildDailyCostPool(input: { day: string; fxBps: number }): Promise<ApiCostPoolEvent> {
    this.calls.push({ name: 'buildDailyCostPool', input });
    return {
      id: 42,
      externalId: 'payment_cost_pool_42',
      eventDate: input.day,
      source: 'llm_calls',
      costUsdMicros: 1_715_000,
      fxBps: input.fxBps,
      apiUnits: this.apiUnits,
      idempotencyKey: `llm_calls:${input.day}`,
      metadata: null,
      createdAt: new Date('2026-07-02T00:00:00.000Z'),
    };
  }

  async allocateDailyLockedBonus(input: {
    day: string;
    budgetCreditCents: number;
  }): Promise<DailyLockedBonusSummary> {
    this.calls.push({ name: 'allocateDailyLockedBonus', input });
    return {
      day: input.day,
      eligibleLotCount: 3,
      allocationCount: 2,
      totalLockedBonusCreditCents: input.budgetCreditCents - 10,
      remainingBudgetCreditCents: 10,
    };
  }
}

class FakeReleaseService implements PartnerReleaseService {
  readonly calls: Array<{ releaseMonth: string; budgetCreditCents: number }> = [];

  async releaseEligibleLots(input: {
    releaseMonth: string;
    budgetCreditCents: number;
  }): Promise<MonthlyReleaseSummary> {
    this.calls.push(input);
    return {
      releaseMonth: input.releaseMonth,
      eligibleLotCount: 2,
      releaseCount: 1,
      totalReleasedCreditCents: input.budgetCreditCents,
      remainingBudgetCreditCents: 0,
    };
  }
}

describe('runPartnerDailyJobs', () => {
  it('defaults to the previous UTC day, uses configured fx bps, derives allocation budget, and preserves call order', async () => {
    process.env.PARTNER_FX_BPS = '73000';
    const allocationService = new FakeAllocationService(12_345);

    const summary = await runPartnerDailyJobs({
      allocationService,
      now: new Date('2026-07-03T00:30:00.000Z'),
    });

    expect(allocationService.calls).toEqual([
      { name: 'buildDailyCostPool', input: { day: '2026-07-02', fxBps: 73_000 } },
      { name: 'allocateDailyLockedBonus', input: { day: '2026-07-02', budgetCreditCents: 1_234 } },
    ]);
    expect(summary).toEqual({
      day: '2026-07-02',
      fxBps: 73_000,
      costPool: {
        id: 42,
        externalId: 'payment_cost_pool_42',
        eventDate: '2026-07-02',
        source: 'llm_calls',
        costUsdMicros: 1_715_000,
        fxBps: 73_000,
        apiUnits: 12_345,
        idempotencyKey: 'llm_calls:2026-07-02',
      },
      allocationBudgetCreditCents: 1_234,
      allocation: {
        day: '2026-07-02',
        eligibleLotCount: 3,
        allocationCount: 2,
        totalLockedBonusCreditCents: 1_224,
        remainingBudgetCreditCents: 10,
      },
    });
  });

  it('uses an explicit allocation budget instead of the API Units derived default', async () => {
    const allocationService = new FakeAllocationService(999_999);

    const summary = await runPartnerDailyJobs({
      allocationService,
      day: '2026-07-02',
      fxBps: 72_000,
      allocationBudgetCreditCents: 500,
    });

    expect(allocationService.calls.at(-1)).toEqual({
      name: 'allocateDailyLockedBonus',
      input: { day: '2026-07-02', budgetCreditCents: 500 },
    });
    expect(summary.allocationBudgetCreditCents).toBe(500);
  });

  it('rejects invalid daily dates, fx bps, and allocation budgets before calling services', async () => {
    const allocationService = new FakeAllocationService(1_000);

    await expect(
      runPartnerDailyJobs({ allocationService, day: '2026-02-29', fxBps: 72_000 }),
    ).rejects.toThrow(RangeError);
    await expect(
      runPartnerDailyJobs({ allocationService, day: '2026-07-02', fxBps: 0 }),
    ).rejects.toThrow(RangeError);
    await expect(
      runPartnerDailyJobs({
        allocationService,
        day: '2026-07-02',
        fxBps: 72_000,
        allocationBudgetCreditCents: -1,
      }),
    ).rejects.toThrow(RangeError);
    expect(allocationService.calls).toEqual([]);
  });
});

describe('runPartnerMonthlyRelease', () => {
  it('defaults to the previous UTC month and runs the release with the explicit budget', async () => {
    const releaseService = new FakeReleaseService();

    const summary = await runPartnerMonthlyRelease({
      releaseService,
      now: new Date('2026-01-15T12:00:00.000Z'),
      budgetCreditCents: 8_000,
    });

    expect(releaseService.calls).toEqual([{ releaseMonth: '2025-12', budgetCreditCents: 8_000 }]);
    expect(summary).toEqual({
      releaseMonth: '2025-12',
      budgetCreditCents: 8_000,
      release: {
        releaseMonth: '2025-12',
        eligibleLotCount: 2,
        releaseCount: 1,
        totalReleasedCreditCents: 8_000,
        remainingBudgetCreditCents: 0,
      },
    });
  });

  it('requires an explicit monthly release budget', async () => {
    const releaseService = new FakeReleaseService();

    await expect(
      runPartnerMonthlyRelease({
        releaseService,
        releaseMonth: '2026-07',
      }),
    ).rejects.toThrow(/budgetCreditCents is required/);
    expect(releaseService.calls).toEqual([]);
  });

  it('rejects invalid monthly release months and budgets before calling services', async () => {
    const releaseService = new FakeReleaseService();

    await expect(
      runPartnerMonthlyRelease({ releaseService, releaseMonth: '2026-13', budgetCreditCents: 1 }),
    ).rejects.toThrow(RangeError);
    await expect(
      runPartnerMonthlyRelease({ releaseService, releaseMonth: '2026-07-01', budgetCreditCents: 1 }),
    ).rejects.toThrow(RangeError);
    await expect(
      runPartnerMonthlyRelease({ releaseService, releaseMonth: '2026-07', budgetCreditCents: 1.5 }),
    ).rejects.toThrow(RangeError);
    expect(releaseService.calls).toEqual([]);
  });
});
