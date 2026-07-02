import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import type { DB } from '../db/client.js';
import { llmCalls } from '../db/schema/llm-calls.js';
import {
  apiCostPoolEvents,
  partnerDailyAllocations,
  partnerLots,
  type ApiCostPoolEvent,
  type PartnerDailyAllocation,
  type PartnerLot,
} from '../db/schema/partner.js';
import {
  AllocationService,
  calculateApiUnitsFromUsdCost,
  calculateLotWeight,
  capDailyBonus,
} from './allocation-service.js';

type FakeLlmCall = {
  id: number;
  costUsd: string | number;
  createdAt: Date;
};

type FakeCostPoolInsert = Omit<ApiCostPoolEvent, 'id' | 'createdAt'>;
type FakeDailyAllocationInsert = Omit<PartnerDailyAllocation, 'id' | 'createdAt'>;

class FakeAllocationDb {
  readonly llmCallRows: FakeLlmCall[];
  readonly costPoolRows: ApiCostPoolEvent[];
  readonly lotRows: PartnerLot[];
  readonly allocationRows: PartnerDailyAllocation[];
  readonly costPoolInsertAttempts: FakeCostPoolInsert[] = [];
  readonly allocationInsertAttempts: FakeDailyAllocationInsert[] = [];
  readonly lotUpdates: Array<{ lotId: number; incrementBy: number }> = [];
  private nextCostPoolId: number;
  private nextAllocationId: number;

  constructor(input: {
    llmCalls?: FakeLlmCall[];
    costPoolEvents?: ApiCostPoolEvent[];
    lots?: PartnerLot[];
    allocations?: PartnerDailyAllocation[];
  } = {}) {
    this.llmCallRows = [...(input.llmCalls ?? [])];
    this.costPoolRows = [...(input.costPoolEvents ?? [])];
    this.lotRows = [...(input.lots ?? [])];
    this.allocationRows = [...(input.allocations ?? [])];
    this.nextCostPoolId = Math.max(0, ...this.costPoolRows.map((row) => row.id)) + 1;
    this.nextAllocationId = Math.max(0, ...this.allocationRows.map((row) => row.id)) + 1;
  }

  asDB(): DB {
    return this as unknown as DB;
  }

  insert(table: unknown) {
    return {
      values: (values: FakeCostPoolInsert | FakeDailyAllocationInsert) => {
        if (table === apiCostPoolEvents) {
          const eventValues = values as FakeCostPoolInsert;
          this.costPoolInsertAttempts.push(eventValues);
          return {
            onDuplicateKeyUpdate: async (_config: unknown) => {
              const existing = this.costPoolRows.find((row) => row.idempotencyKey === eventValues.idempotencyKey);
              if (existing) return;
              this.costPoolRows.push({
                id: this.nextCostPoolId,
                createdAt: new Date('2026-07-02T00:00:00.000Z'),
                ...eventValues,
              });
              this.nextCostPoolId += 1;
            },
          };
        }

        if (table === partnerDailyAllocations) {
          const allocationValues = values as FakeDailyAllocationInsert;
          this.allocationInsertAttempts.push(allocationValues);
          return {
            onDuplicateKeyUpdate: async (_config: unknown) => {
              const existing = this.allocationRows.find(
                (row) =>
                  row.idempotencyKey === allocationValues.idempotencyKey ||
                  (row.lotId === allocationValues.lotId && row.allocationDate === allocationValues.allocationDate),
              );
              if (existing) return;
              this.allocationRows.push({
                id: this.nextAllocationId,
                createdAt: new Date('2026-07-02T00:00:00.000Z'),
                ...allocationValues,
              });
              this.nextAllocationId += 1;
            },
          };
        }

        throw new Error(`unexpected insert table: ${String(table)}`);
      },
    };
  }

  update(table: unknown) {
    if (table !== partnerLots) {
      throw new Error(`unexpected update table: ${String(table)}`);
    }

    return {
      set: (values: { lockedBonusCreditCents?: unknown }) => ({
        where: (predicate: unknown) => {
          const predicateText = inspect(predicate, { depth: 8, getters: true });
          const predicateLotId = extractPredicateNumber(predicate);
          const lot =
            predicateLotId === null
              ? this.lotRows.find(
                  (candidate) => predicateText.includes('id') && predicateText.includes(String(candidate.id)),
                )
              : this.lotRows.find((candidate) => candidate.id === predicateLotId);
          if (!lot) return Promise.resolve();

          const incrementBy = extractSqlIncrement(values.lockedBonusCreditCents);
          if (!Number.isSafeInteger(incrementBy) || incrementBy < 0) {
            throw new Error('fake db expected a non-negative locked bonus increment');
          }

          lot.lockedBonusCreditCents += incrementBy;
          lot.updatedAt = new Date('2026-07-02T00:00:00.000Z');
          this.lotUpdates.push({ lotId: lot.id, incrementBy });
          return Promise.resolve();
        },
      }),
    };
  }

  select(_selection?: unknown) {
    return {
      from: (table: unknown) => {
        const chain = {
          where: (predicate: unknown) => this.selectRows(table, inspect(predicate, { depth: 8, getters: true })),
          then: (
            onFulfilled?: ((value: unknown[]) => unknown) | null,
            onRejected?: ((reason: unknown) => unknown) | null,
          ) => Promise.resolve(this.selectRows(table, null)).then(onFulfilled, onRejected),
        };
        return chain;
      },
    };
  }

  private selectRows(table: unknown, predicateText: string | null) {
    const rows = this.rowsForTable(table, predicateText);
    return {
      limit: async (count: number) => rows.slice(0, count),
      then: (
        onFulfilled?: ((value: unknown[]) => unknown) | null,
        onRejected?: ((reason: unknown) => unknown) | null,
      ) => Promise.resolve(rows).then(onFulfilled, onRejected),
    };
  }

  private rowsForTable(table: unknown, predicateText: string | null): unknown[] {
    if (table === llmCalls) {
      if (!predicateText) return [...this.llmCallRows];
      const bounds = Array.from(predicateText.matchAll(/(\d{4}-\d{2}-\d{2}T00:00:00\.000Z)/g), (match) =>
        Date.parse(match[1]!),
      );
      if (bounds.length >= 2) {
        return this.llmCallRows.filter(
          (row) => row.createdAt.getTime() >= bounds[0]! && row.createdAt.getTime() < bounds[1]!,
        );
      }
      return [...this.llmCallRows];
    }

    if (table === apiCostPoolEvents) {
      if (!predicateText) return [...this.costPoolRows];
      const byKey = this.costPoolRows.find((row) => predicateText.includes(row.idempotencyKey));
      return byKey ? [byKey] : [];
    }

    if (table === partnerLots) {
      if (!predicateText) return [...this.lotRows];
      return this.lotRows.filter((row) => {
        if (predicateText.includes('accumulating') && row.status !== 'accumulating') return false;
        if (predicateText.includes('normal') && row.riskStatus !== 'normal') return false;
        return true;
      });
    }

    if (table === partnerDailyAllocations) {
      if (!predicateText) return [...this.allocationRows];
      const byKey = this.allocationRows.find((row) => predicateText.includes(row.idempotencyKey));
      return byKey ? [byKey] : [];
    }

    return [];
  }
}

function extractSqlIncrement(value: unknown): number {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object' && 'queryChunks' in value) {
    const chunks = (value as { queryChunks?: unknown[] }).queryChunks ?? [];
    const numericChunk = chunks.find((chunk): chunk is number => typeof chunk === 'number');
    return numericChunk ?? Number.NaN;
  }
  return Number.NaN;
}

function extractPredicateNumber(value: unknown): number | null {
  if (!value || typeof value !== 'object' || !('queryChunks' in value)) return null;
  for (const chunk of (value as { queryChunks?: unknown[] }).queryChunks ?? []) {
    if (typeof chunk === 'number') return chunk;
    if (chunk && typeof chunk === 'object' && 'value' in chunk) {
      const nestedValue = (chunk as { value?: unknown }).value;
      if (typeof nestedValue === 'number') return nestedValue;
    }
  }
  return null;
}

function fakeLot(overrides: Partial<PartnerLot> = {}): PartnerLot {
  return {
    id: 1,
    externalId: 'payment_existing_lot',
    userId: 123,
    rechargeOrderId: 77,
    status: 'accumulating',
    riskStatus: 'normal',
    principalCreditCents: 10_000_00,
    tierMultiplierBps: 10_500,
    apiUnits: 10_500_000,
    bonusCapCreditCents: 2_000_00,
    lockedBonusCreditCents: 0,
    releasedPrincipalCreditCents: 0,
    releasedBonusCreditCents: 0,
    carryForwardCreditCents: 0,
    accumulationStartsAt: new Date('2026-07-01T00:00:00.000Z'),
    accumulationEndsAt: new Date('2026-10-29T00:00:00.000Z'),
    releaseStartsAt: new Date('2026-10-30T00:00:00.000Z'),
    releaseEndsAt: new Date('2027-06-30T00:00:00.000Z'),
    metadata: null,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-01T00:00:00.000Z'),
    ...overrides,
  };
}

function fakeAllocation(overrides: Partial<PartnerDailyAllocation> = {}): PartnerDailyAllocation {
  return {
    id: 1,
    externalId: 'payment_existing_allocation',
    lotId: 1,
    allocationDate: '2026-07-02',
    lockedBonusCreditCents: 1_000,
    apiUnitsWeight: 10_500_000,
    idempotencyKey: 'daily:2026-07-02:1',
    metadata: null,
    createdAt: new Date('2026-07-02T00:00:00.000Z'),
    ...overrides,
  };
}

describe('partner allocation pure rules', () => {
  it('converts USD micros through CNY FX bps into API Units', () => {
    expect(calculateApiUnitsFromUsdCost({ costUsdMicros: 1_000_000, fxBps: 72_000 })).toBe(7_200);
  });

  it('weights lot API Units by basis-point factors', () => {
    expect(
      calculateLotWeight({
        apiUnits: 10_500_000,
        ageFactorBps: 10_000,
        activityFactorBps: 10_500,
        riskFactorBps: 10_000,
      }),
    ).toBe(11_025_000);
  });

  it('caps daily bonus at the remaining bonus amount', () => {
    expect(capDailyBonus({ targetCreditCents: 1_667, remainingBonusCreditCents: 99 })).toBe(99);
  });

  it('throws RangeError for invalid pure-function inputs', () => {
    expect(() => calculateApiUnitsFromUsdCost({ costUsdMicros: -1, fxBps: 72_000 })).toThrow(RangeError);
    expect(() => calculateApiUnitsFromUsdCost({ costUsdMicros: 1_000_000, fxBps: 0 })).toThrow(RangeError);
    expect(() =>
      calculateLotWeight({
        apiUnits: 10_500_000,
        ageFactorBps: 10_000,
        activityFactorBps: 0,
        riskFactorBps: 10_000,
      }),
    ).toThrow(RangeError);
    expect(() => capDailyBonus({ targetCreditCents: 1.5, remainingBonusCreditCents: 99 })).toThrow(RangeError);
  });
});

describe('AllocationService buildDailyCostPool', () => {
  it('sums daily llm cost, writes an idempotent event, and reruns return the existing row', async () => {
    const fakeDb = new FakeAllocationDb({
      llmCalls: [
        { id: 1, costUsd: '0.250000', createdAt: new Date('2026-07-02T00:00:00.000Z') },
        { id: 2, costUsd: 0.75, createdAt: new Date('2026-07-02T23:59:59.999Z') },
        { id: 3, costUsd: '9.000000', createdAt: new Date('2026-07-03T00:00:00.000Z') },
      ],
    });
    const service = new AllocationService(fakeDb.asDB());

    const first = await service.buildDailyCostPool({ day: '2026-07-02', fxBps: 72_000 });
    const second = await service.buildDailyCostPool({ day: '2026-07-02', fxBps: 72_000 });

    expect(first).toBe(second);
    expect(first).toMatchObject({
      eventDate: '2026-07-02',
      source: 'llm_calls',
      costUsdMicros: 1_000_000,
      fxBps: 72_000,
      apiUnits: 7_200,
      idempotencyKey: 'llm_calls:2026-07-02',
    });
    expect(fakeDb.costPoolRows).toHaveLength(1);
    expect(fakeDb.costPoolInsertAttempts).toHaveLength(2);
  });

  it('throws a clear conflict when an existing daily cost pool payload differs', async () => {
    const fakeDb = new FakeAllocationDb({
      llmCalls: [{ id: 1, costUsd: '1.000000', createdAt: new Date('2026-07-02T12:00:00.000Z') }],
      costPoolEvents: [
        {
          id: 1,
          externalId: 'payment_existing_pool',
          eventDate: '2026-07-02',
          source: 'llm_calls',
          costUsdMicros: 999_999,
          fxBps: 72_000,
          apiUnits: 7_199,
          idempotencyKey: 'llm_calls:2026-07-02',
          metadata: null,
          createdAt: new Date('2026-07-02T00:00:00.000Z'),
        },
      ],
    });
    const service = new AllocationService(fakeDb.asDB());

    await expect(service.buildDailyCostPool({ day: '2026-07-02', fxBps: 72_000 })).rejects.toThrow(
      /cost pool/i,
    );
  });
});

describe('AllocationService allocateDailyLockedBonus', () => {
  it('creates daily allocations, caps by remaining bonus, and increments each lot once', async () => {
    const almostCappedLot = fakeLot({
      id: 2,
      externalId: 'payment_lot_2',
      apiUnits: 10_500_000,
      bonusCapCreditCents: 2_000_00,
      lockedBonusCreditCents: 199_990,
    });
    const fakeDb = new FakeAllocationDb({
      lots: [fakeLot({ id: 1, apiUnits: 10_500_000 }), almostCappedLot],
    });
    const service = new AllocationService(fakeDb.asDB());

    const summary = await service.allocateDailyLockedBonus({ day: '2026-07-02', budgetCreditCents: 20_000 });

    expect(summary).toEqual({
      day: '2026-07-02',
      eligibleLotCount: 2,
      allocationCount: 2,
      totalLockedBonusCreditCents: 1_676,
      remainingBudgetCreditCents: 18_324,
    });
    expect(fakeDb.allocationRows).toHaveLength(2);
    expect(fakeDb.allocationRows.map((row) => row.lockedBonusCreditCents)).toEqual([1_666, 10]);
    expect(fakeDb.lotRows.map((row) => row.lockedBonusCreditCents)).toEqual([1_666, 200_000]);
    expect(fakeDb.lotUpdates).toEqual([
      { lotId: 1, incrementBy: 1_666 },
      { lotId: 2, incrementBy: 10 },
    ]);
  });

  it('does not double-increment a lot when rerun for the same lot and day', async () => {
    const existingLot = fakeLot({ lockedBonusCreditCents: 1_000 });
    const fakeDb = new FakeAllocationDb({
      lots: [existingLot],
      allocations: [fakeAllocation({ lockedBonusCreditCents: 1_000 })],
    });
    const service = new AllocationService(fakeDb.asDB());

    const summary = await service.allocateDailyLockedBonus({ day: '2026-07-02', budgetCreditCents: 10_000 });

    expect(summary).toEqual({
      day: '2026-07-02',
      eligibleLotCount: 1,
      allocationCount: 1,
      totalLockedBonusCreditCents: 1_000,
      remainingBudgetCreditCents: 9_000,
    });
    expect(fakeDb.lotRows[0]!.lockedBonusCreditCents).toBe(1_000);
    expect(fakeDb.lotUpdates).toEqual([]);
    expect(fakeDb.allocationRows).toHaveLength(1);
    expect(fakeDb.allocationInsertAttempts).toHaveLength(1);
  });

  it('skips risk/frozen and non-accumulating lots', async () => {
    const fakeDb = new FakeAllocationDb({
      lots: [
        fakeLot({ id: 1, status: 'accumulating', riskStatus: 'normal' }),
        fakeLot({ id: 2, externalId: 'payment_lot_2', status: 'accumulating', riskStatus: 'frozen' }),
        fakeLot({ id: 3, externalId: 'payment_lot_3', status: 'release_pending', riskStatus: 'normal' }),
      ],
    });
    const service = new AllocationService(fakeDb.asDB());

    const summary = await service.allocateDailyLockedBonus({ day: '2026-07-02', budgetCreditCents: 10_000 });

    expect(summary).toMatchObject({
      eligibleLotCount: 1,
      allocationCount: 1,
      totalLockedBonusCreditCents: 1_666,
    });
    expect(fakeDb.allocationRows.map((row) => row.lotId)).toEqual([1]);
    expect(fakeDb.lotUpdates).toEqual([{ lotId: 1, incrementBy: 1_666 }]);
  });
});
