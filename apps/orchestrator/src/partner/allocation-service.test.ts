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
  readonly lotReconciliations: Array<{ lotId: number; lockedBonusCreditCents: number }> = [];
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
      set: (_values: { lockedBonusCreditCents?: unknown }) => ({
        where: (predicate: unknown) => {
          const predicateText = inspect(predicate, { depth: 8, getters: true });
          const predicateLotId = extractPredicateNumbers(predicate)[0] ?? null;
          const lot =
            predicateLotId === null
              ? this.lotRows.find(
                  (candidate) => predicateText.includes('id') && predicateText.includes(String(candidate.id)),
                )
              : this.lotRows.find((candidate) => candidate.id === predicateLotId);
          if (!lot) return Promise.resolve();

          const lockedBonusCreditCents = this.allocationRows
            .filter((row) => row.lotId === lot.id)
            .reduce((sum, row) => sum + row.lockedBonusCreditCents, 0);
          lot.lockedBonusCreditCents = lockedBonusCreditCents;
          lot.updatedAt = new Date('2026-07-02T00:00:00.000Z');
          this.lotReconciliations.push({ lotId: lot.id, lockedBonusCreditCents });
          return Promise.resolve();
        },
      }),
    };
  }

  select(_selection?: unknown) {
    return {
      from: (table: unknown) => {
        const chain = {
          where: (predicate: unknown) => this.selectRows(table, predicate),
          then: (
            onFulfilled?: ((value: unknown[]) => unknown) | null,
            onRejected?: ((reason: unknown) => unknown) | null,
          ) => Promise.resolve(this.selectRows(table, null)).then(onFulfilled, onRejected),
        };
        return chain;
      },
    };
  }

  private selectRows(table: unknown, predicate: unknown | null) {
    const rows = this.rowsForTable(table, predicate, predicate ? inspect(predicate, { depth: 8, getters: true }) : null);
    return {
      limit: async (count: number) => rows.slice(0, count),
      then: (
        onFulfilled?: ((value: unknown[]) => unknown) | null,
        onRejected?: ((reason: unknown) => unknown) | null,
      ) => Promise.resolve(rows).then(onFulfilled, onRejected),
    };
  }

  private rowsForTable(table: unknown, predicate: unknown | null, predicateText: string | null): unknown[] {
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
      const predicateStrings = extractPredicateStrings(predicate);
      const byKey = this.costPoolRows.find(
        (row) => predicateText.includes(row.idempotencyKey) || predicateStrings.includes(row.idempotencyKey),
      );
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
      const predicateStrings = extractPredicateStrings(predicate);
      const byKey = this.allocationRows.find(
        (row) => predicateText.includes(row.idempotencyKey) || predicateStrings.includes(row.idempotencyKey),
      );
      if (byKey) return [byKey];

      const predicateNumbers = extractPredicateNumbers(predicate);
      const hasLotId =
        predicateNumbers.length > 0 && (predicateText.includes('lot_id') || predicateText.includes('lotId'));
      const matchingDayRows = this.allocationRows.filter(
        (row) => predicateText.includes(row.allocationDate) || predicateStrings.includes(row.allocationDate),
      );
      if (hasLotId) {
        return matchingDayRows.filter((row) => predicateNumbers.includes(row.lotId));
      }
      return matchingDayRows;
    }

    return [];
  }
}

function extractPredicateNumbers(value: unknown): number[] {
  const numbers: number[] = [];

  function visit(candidate: unknown): void {
    if (typeof candidate === 'number') {
      numbers.push(candidate);
      return;
    }
    if (!candidate || typeof candidate !== 'object') return;
    if ('value' in candidate) {
      const nestedValue = (candidate as { value?: unknown }).value;
      if (typeof nestedValue === 'number') {
        numbers.push(nestedValue);
      }
    }
    if ('queryChunks' in candidate) {
      for (const chunk of (candidate as { queryChunks?: unknown[] }).queryChunks ?? []) {
        visit(chunk);
      }
    }
  }

  visit(value);
  return numbers;
}

function extractPredicateStrings(value: unknown): string[] {
  const strings: string[] = [];

  function visit(candidate: unknown): void {
    if (typeof candidate === 'string') {
      strings.push(candidate);
      return;
    }
    if (!candidate || typeof candidate !== 'object') return;
    if ('value' in candidate) {
      const nestedValue = (candidate as { value?: unknown }).value;
      if (typeof nestedValue === 'string') {
        strings.push(nestedValue);
      }
    }
    if ('queryChunks' in candidate) {
      for (const chunk of (candidate as { queryChunks?: unknown[] }).queryChunks ?? []) {
        visit(chunk);
      }
    }
  }

  visit(value);
  return strings;
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
      allocations: [
        fakeAllocation({
          id: 10,
          externalId: 'payment_prior_allocation',
          lotId: 2,
          allocationDate: '2026-07-01',
          lockedBonusCreditCents: 199_990,
          idempotencyKey: 'daily:2026-07-01:2',
        }),
      ],
    });
    const service = new AllocationService(fakeDb.asDB());

    const summary = await service.allocateDailyLockedBonus({ day: '2026-07-02', budgetCreditCents: 20_000 });
    const todayAllocations = fakeDb.allocationRows.filter((row) => row.allocationDate === '2026-07-02');

    expect(summary).toEqual({
      day: '2026-07-02',
      eligibleLotCount: 2,
      allocationCount: 2,
      totalLockedBonusCreditCents: 1_676,
      remainingBudgetCreditCents: 18_324,
    });
    expect(todayAllocations).toHaveLength(2);
    expect(todayAllocations.map((row) => row.lockedBonusCreditCents)).toEqual([1_666, 10]);
    expect(fakeDb.lotRows.map((row) => row.lockedBonusCreditCents)).toEqual([1_666, 200_000]);
    expect(fakeDb.lotReconciliations).toEqual([
      { lotId: 1, lockedBonusCreditCents: 1_666 },
      { lotId: 2, lockedBonusCreditCents: 200_000 },
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
    expect(fakeDb.lotReconciliations).toEqual([{ lotId: 1, lockedBonusCreditCents: 1_000 }]);
    expect(fakeDb.allocationRows).toHaveLength(1);
    expect(fakeDb.allocationInsertAttempts).toHaveLength(1);
  });

  it('repairs a stale lot locked bonus from an existing allocation row on rerun', async () => {
    const fakeDb = new FakeAllocationDb({
      lots: [fakeLot({ id: 1, lockedBonusCreditCents: 0 })],
      allocations: [fakeAllocation({ lotId: 1, lockedBonusCreditCents: 1_000 })],
    });
    const service = new AllocationService(fakeDb.asDB());

    const summary = await service.allocateDailyLockedBonus({ day: '2026-07-02', budgetCreditCents: 10_000 });

    expect(summary).toMatchObject({
      allocationCount: 1,
      totalLockedBonusCreditCents: 1_000,
      remainingBudgetCreditCents: 9_000,
    });
    expect(fakeDb.lotRows[0]!.lockedBonusCreditCents).toBe(1_000);
    expect(fakeDb.lotReconciliations).toEqual([{ lotId: 1, lockedBonusCreditCents: 1_000 }]);
  });

  it('handles an existing lot/day allocation with a different idempotency key without double-crediting', async () => {
    const fakeDb = new FakeAllocationDb({
      lots: [fakeLot({ id: 1, lockedBonusCreditCents: 0 })],
      allocations: [
        fakeAllocation({
          lotId: 1,
          lockedBonusCreditCents: 1_000,
          idempotencyKey: 'daily:2026-07-02:other-worker',
        }),
      ],
    });
    const service = new AllocationService(fakeDb.asDB());

    const summary = await service.allocateDailyLockedBonus({ day: '2026-07-02', budgetCreditCents: 10_000 });

    expect(summary).toMatchObject({
      allocationCount: 1,
      totalLockedBonusCreditCents: 1_000,
      remainingBudgetCreditCents: 9_000,
    });
    expect(fakeDb.allocationRows).toHaveLength(1);
    expect(fakeDb.lotRows[0]!.lockedBonusCreditCents).toBe(1_000);
    expect(fakeDb.lotReconciliations).toEqual([{ lotId: 1, lockedBonusCreditCents: 1_000 }]);
  });

  it('counts existing same-day allocations against the budget before allocating missing lots', async () => {
    const fakeDb = new FakeAllocationDb({
      lots: [
        fakeLot({ id: 1, apiUnits: 10_500_000, lockedBonusCreditCents: 1_500 }),
        fakeLot({ id: 2, externalId: 'payment_lot_2', apiUnits: 10_500_000 }),
      ],
      allocations: [fakeAllocation({ lotId: 1, lockedBonusCreditCents: 1_500 })],
    });
    const service = new AllocationService(fakeDb.asDB());

    const summary = await service.allocateDailyLockedBonus({ day: '2026-07-02', budgetCreditCents: 2_000 });

    expect(summary).toEqual({
      day: '2026-07-02',
      eligibleLotCount: 2,
      allocationCount: 2,
      totalLockedBonusCreditCents: 2_000,
      remainingBudgetCreditCents: 0,
    });
    expect(fakeDb.allocationRows).toHaveLength(2);
    expect(fakeDb.allocationRows.map((row) => [row.lotId, row.lockedBonusCreditCents])).toEqual([
      [1, 1_500],
      [2, 500],
    ]);
    expect(fakeDb.lotReconciliations).toEqual([
      { lotId: 1, lockedBonusCreditCents: 1_500 },
      { lotId: 2, lockedBonusCreditCents: 500 },
    ]);
    expect(fakeDb.lotRows.map((row) => row.lockedBonusCreditCents)).toEqual([1_500, 500]);
  });

  it('counts existing allocations for now-ineligible lots against the daily budget', async () => {
    const fakeDb = new FakeAllocationDb({
      lots: [
        fakeLot({ id: 1, status: 'frozen', riskStatus: 'normal', lockedBonusCreditCents: 1_500 }),
        fakeLot({ id: 2, externalId: 'payment_lot_2', status: 'accumulating', riskStatus: 'normal' }),
      ],
      allocations: [fakeAllocation({ lotId: 1, lockedBonusCreditCents: 1_500 })],
    });
    const service = new AllocationService(fakeDb.asDB());

    const summary = await service.allocateDailyLockedBonus({ day: '2026-07-02', budgetCreditCents: 2_000 });

    expect(summary).toEqual({
      day: '2026-07-02',
      eligibleLotCount: 1,
      allocationCount: 2,
      totalLockedBonusCreditCents: 2_000,
      remainingBudgetCreditCents: 0,
    });
    expect(fakeDb.allocationRows.map((row) => [row.lotId, row.lockedBonusCreditCents])).toEqual([
      [1, 1_500],
      [2, 500],
    ]);
    expect(fakeDb.lotReconciliations).toEqual([
      { lotId: 1, lockedBonusCreditCents: 1_500 },
      { lotId: 2, lockedBonusCreditCents: 500 },
    ]);
  });

  it('does not create zero-value allocations for rounded-zero shares', async () => {
    const fakeDb = new FakeAllocationDb({
      lots: [
        fakeLot({ id: 1, apiUnits: 10_500_000 }),
        fakeLot({ id: 2, externalId: 'payment_lot_2', apiUnits: 10_500_000 }),
      ],
    });
    const service = new AllocationService(fakeDb.asDB());

    const summary = await service.allocateDailyLockedBonus({ day: '2026-07-02', budgetCreditCents: 1 });

    expect(summary).toEqual({
      day: '2026-07-02',
      eligibleLotCount: 2,
      allocationCount: 0,
      totalLockedBonusCreditCents: 0,
      remainingBudgetCreditCents: 1,
    });
    expect(fakeDb.allocationRows).toEqual([]);
    expect(fakeDb.lotReconciliations).toEqual([]);
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
    expect(fakeDb.lotReconciliations).toEqual([{ lotId: 1, lockedBonusCreditCents: 1_666 }]);
  });
});
