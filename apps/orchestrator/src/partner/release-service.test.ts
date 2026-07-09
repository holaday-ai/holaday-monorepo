import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import type { DB } from '../db/client.js';
import {
  holaCreditLedgerEntries,
  partnerLots,
  partnerMonthlyReleases,
  type HolaCreditLedgerEntry,
  type PartnerLot,
  type PartnerMonthlyRelease,
} from '../db/schema/partner.js';
import { calculateMonthlyReleaseWithBudget, ReleaseService } from './release-service.js';

type FakeReleaseInsert = Omit<PartnerMonthlyRelease, 'id' | 'createdAt'>;
type FakeLedgerInsert = Omit<HolaCreditLedgerEntry, 'id' | 'createdAt'>;

class FakeReleaseDb {
  readonly lotRows: PartnerLot[];
  readonly releaseRows: PartnerMonthlyRelease[];
  readonly ledgerRows: HolaCreditLedgerEntry[];
  readonly releaseInsertAttempts: FakeReleaseInsert[] = [];
  readonly ledgerInsertAttempts: FakeLedgerInsert[] = [];
  readonly lotReconciliations: Array<{
    lotId: number;
    status?: string;
    releasedPrincipalCreditCents: number;
    releasedBonusCreditCents: number;
    carryForwardCreditCents: number;
  }> = [];
  readonly lotStatusTransitions: Array<{ lotId: number; status: string }> = [];
  private nextReleaseId: number;
  private nextLedgerId: number;
  private lastLedgerIdempotencyKey: string | null = null;

  constructor(input: {
    lots?: PartnerLot[];
    releases?: PartnerMonthlyRelease[];
    ledgerEntries?: HolaCreditLedgerEntry[];
  } = {}) {
    this.lotRows = [...(input.lots ?? [])];
    this.releaseRows = [...(input.releases ?? [])];
    this.ledgerRows = [...(input.ledgerEntries ?? [])];
    this.nextReleaseId = Math.max(0, ...this.releaseRows.map((row) => row.id)) + 1;
    this.nextLedgerId = Math.max(0, ...this.ledgerRows.map((row) => row.id)) + 1;
  }

  asDB(): DB {
    return this as unknown as DB;
  }

  insert(table: unknown) {
    return {
      values: (values: FakeReleaseInsert | FakeLedgerInsert) => {
        if (table === partnerMonthlyReleases) {
          const releaseValues = values as FakeReleaseInsert;
          this.releaseInsertAttempts.push(releaseValues);
          return {
            onDuplicateKeyUpdate: async (_config: unknown) => {
              const existing = this.releaseRows.find(
                (row) =>
                  row.idempotencyKey === releaseValues.idempotencyKey ||
                  (row.lotId === releaseValues.lotId && row.releaseMonth === releaseValues.releaseMonth),
              );
              if (existing) return;
              this.releaseRows.push({
                id: this.nextReleaseId,
                createdAt: new Date('2026-11-01T00:00:00.000Z'),
                ...releaseValues,
              });
              this.nextReleaseId += 1;
            },
          };
        }

        if (table === holaCreditLedgerEntries) {
          const ledgerValues = values as FakeLedgerInsert;
          this.ledgerInsertAttempts.push(ledgerValues);
          this.lastLedgerIdempotencyKey = ledgerValues.idempotencyKey;
          return {
            onDuplicateKeyUpdate: async (_config: unknown) => {
              const existing = this.ledgerRows.find((row) => row.idempotencyKey === ledgerValues.idempotencyKey);
              if (existing) return;
              this.ledgerRows.push({
                id: this.nextLedgerId,
                createdAt: new Date('2026-11-01T00:00:00.000Z'),
                ...ledgerValues,
              });
              this.nextLedgerId += 1;
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
      set: (
        values: Partial<
          Pick<
            PartnerLot,
            'status' | 'releasedPrincipalCreditCents' | 'releasedBonusCreditCents' | 'carryForwardCreditCents'
          >
        >,
      ) => ({
        where: (predicate: unknown) => {
          if (
            values.status === 'release_pending' &&
            values.releasedPrincipalCreditCents === undefined &&
            values.releasedBonusCreditCents === undefined &&
            values.carryForwardCreditCents === undefined
          ) {
            const now = extractPredicateDates(predicate)[0] ?? new Date('2100-01-01T00:00:00.000Z');
            for (const lot of this.lotRows) {
              if (
                lot.status === 'accumulating' &&
                lot.riskStatus === 'normal' &&
                lot.accumulationEndsAt.getTime() <= now.getTime()
              ) {
                lot.status = values.status;
                lot.updatedAt = new Date('2026-11-01T00:00:00.000Z');
                this.lotStatusTransitions.push({ lotId: lot.id, status: values.status });
              }
            }
            return Promise.resolve([{ affectedRows: this.lotStatusTransitions.length }, null]);
          }

          const lotId = extractPredicateNumbers(predicate)[0] ?? null;
          const lot = lotId === null ? undefined : this.lotRows.find((row) => row.id === lotId);
          if (!lot) return Promise.resolve();

          if (values.status !== undefined) lot.status = values.status;
          if (values.releasedPrincipalCreditCents !== undefined) {
            lot.releasedPrincipalCreditCents = values.releasedPrincipalCreditCents;
          }
          if (values.releasedBonusCreditCents !== undefined) {
            lot.releasedBonusCreditCents = values.releasedBonusCreditCents;
          }
          if (values.carryForwardCreditCents !== undefined) {
            lot.carryForwardCreditCents = values.carryForwardCreditCents;
          }
          lot.updatedAt = new Date('2026-11-01T00:00:00.000Z');
          this.lotReconciliations.push({
            lotId: lot.id,
            ...(values.status === undefined ? {} : { status: values.status }),
            releasedPrincipalCreditCents: lot.releasedPrincipalCreditCents,
            releasedBonusCreditCents: lot.releasedBonusCreditCents,
            carryForwardCreditCents: lot.carryForwardCreditCents,
          });
          return Promise.resolve();
        },
      }),
    };
  }

  select(_selection?: unknown) {
    return {
      from: (table: unknown) => ({
        where: (predicate: unknown) => this.selectRows(table, predicate),
        then: (
          onFulfilled?: ((value: unknown[]) => unknown) | null,
          onRejected?: ((reason: unknown) => unknown) | null,
        ) => Promise.resolve(this.rowsForTable(table, null)).then(onFulfilled, onRejected),
      }),
    };
  }

  private selectRows(table: unknown, predicate: unknown) {
    const rows = this.rowsForTable(table, predicate);
    return {
      limit: async (count: number) => rows.slice(0, count),
      then: (
        onFulfilled?: ((value: unknown[]) => unknown) | null,
        onRejected?: ((reason: unknown) => unknown) | null,
      ) => Promise.resolve(rows).then(onFulfilled, onRejected),
    };
  }

  private rowsForTable(table: unknown, predicate: unknown | null): unknown[] {
    const predicateText = predicate ? inspect(predicate, { depth: 10, getters: true }) : '';
    const predicateStrings = extractPredicateStrings(predicate);
    const predicateNumbers = extractPredicateNumbers(predicate);

    if (table === partnerLots) {
      if (predicateText.includes('id') && predicateNumbers.length > 0) {
        return this.lotRows.filter((row) => predicateNumbers.includes(row.id));
      }
      return [...this.lotRows];
    }

    if (table === partnerMonthlyReleases) {
      let rows = [...this.releaseRows];
      if (predicateText.includes('lot_id') && predicateNumbers.length > 0) {
        rows = rows.filter((row) => predicateNumbers.includes(row.lotId));
      }
      const releaseMonths = predicateStrings.filter((value) => /^\d{4}-\d{2}$/.test(value));
      if (predicateText.includes('release_month') && releaseMonths.length > 0) {
        rows = rows.filter((row) => releaseMonths.includes(row.releaseMonth));
      }
      const idempotencyKeys = predicateStrings.filter((value) => value.startsWith('monthly_release:'));
      if (predicateText.includes('idempotency_key') && idempotencyKeys.length > 0) {
        rows = rows.filter((row) => idempotencyKeys.includes(row.idempotencyKey));
      }
      return rows;
    }

    if (table === holaCreditLedgerEntries) {
      if (!predicateText) return [...this.ledgerRows];
      const readbackKey =
        this.lastLedgerIdempotencyKey &&
        predicateText.includes('idempotency_key') &&
        predicateText.includes(this.lastLedgerIdempotencyKey)
          ? this.lastLedgerIdempotencyKey
          : predicateStrings.find((value) => value.startsWith('monthly_release_')) ?? null;
      if (!readbackKey) return [...this.ledgerRows];
      return this.ledgerRows.filter((row) => row.idempotencyKey === readbackKey);
    }

    return [];
  }
}

function extractPredicateDates(value: unknown): Date[] {
  const dates: Date[] = [];
  const seen = new WeakSet<object>();

  function visit(candidate: unknown): void {
    if (candidate instanceof Date) {
      dates.push(candidate);
      return;
    }
    if (!candidate || typeof candidate !== 'object' || seen.has(candidate)) return;
    seen.add(candidate);

    if ('value' in candidate && (candidate as { value?: unknown }).value instanceof Date) {
      dates.push((candidate as { value: Date }).value);
    }
    if ('queryChunks' in candidate) {
      for (const chunk of (candidate as { queryChunks?: unknown[] }).queryChunks ?? []) visit(chunk);
    }
    if ('params' in candidate) {
      for (const param of (candidate as { params?: unknown[] }).params ?? []) visit(param);
    }
  }

  visit(value);
  return dates;
}

function extractPredicateNumbers(value: unknown): number[] {
  const numbers: number[] = [];
  const seen = new WeakSet<object>();

  function visit(candidate: unknown): void {
    if (typeof candidate === 'number') {
      numbers.push(candidate);
      return;
    }
    if (!candidate || typeof candidate !== 'object' || seen.has(candidate)) return;
    seen.add(candidate);

    if ('value' in candidate && typeof (candidate as { value?: unknown }).value === 'number') {
      numbers.push((candidate as { value: number }).value);
    }
    if ('queryChunks' in candidate) {
      for (const chunk of (candidate as { queryChunks?: unknown[] }).queryChunks ?? []) visit(chunk);
    }
    if ('params' in candidate) {
      for (const param of (candidate as { params?: unknown[] }).params ?? []) visit(param);
    }
  }

  visit(value);
  return numbers;
}

function extractPredicateStrings(value: unknown): string[] {
  const strings: string[] = [];
  const seen = new WeakSet<object>();

  function visit(candidate: unknown): void {
    if (typeof candidate === 'string') {
      strings.push(candidate);
      return;
    }
    if (!candidate || typeof candidate !== 'object' || seen.has(candidate)) return;
    seen.add(candidate);

    if ('value' in candidate && typeof (candidate as { value?: unknown }).value === 'string') {
      strings.push((candidate as { value: string }).value);
    }
    if ('queryChunks' in candidate) {
      for (const chunk of (candidate as { queryChunks?: unknown[] }).queryChunks ?? []) visit(chunk);
    }
    if ('params' in candidate) {
      for (const param of (candidate as { params?: unknown[] }).params ?? []) visit(param);
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
    status: 'release_pending',
    riskStatus: 'normal',
    principalCreditCents: 80_000,
    tierMultiplierBps: 10_500,
    apiUnits: 840_000,
    bonusCapCreditCents: 16_000,
    lockedBonusCreditCents: 16_000,
    releasedPrincipalCreditCents: 0,
    releasedBonusCreditCents: 0,
    carryForwardCreditCents: 0,
    accumulationStartsAt: new Date('2026-07-01T00:00:00.000Z'),
    accumulationEndsAt: new Date('2026-10-29T00:00:00.000Z'),
    releaseStartsAt: new Date('2026-11-01T00:00:00.000Z'),
    releaseEndsAt: new Date('2027-10-31T00:00:00.000Z'),
    metadata: null,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-01T00:00:00.000Z'),
    ...overrides,
  };
}

function fakeRelease(overrides: Partial<PartnerMonthlyRelease> = {}): PartnerMonthlyRelease {
  return {
    id: 1,
    externalId: 'payment_existing_release',
    lotId: 1,
    releaseMonth: '2026-11',
    principalCreditCents: 6_667,
    bonusCreditCents: 1_334,
    carryForwardCreditCents: 0,
    status: 'posted',
    idempotencyKey: 'monthly_release:2026-11:1',
    metadata: null,
    createdAt: new Date('2026-11-01T00:00:00.000Z'),
    ...overrides,
  };
}

function priorMonthlyReleases(count: number, lotId = 1): PartnerMonthlyRelease[] {
  const months = [
    '2026-11',
    '2026-12',
    '2027-01',
    '2027-02',
    '2027-03',
    '2027-04',
    '2027-05',
    '2027-06',
    '2027-07',
    '2027-08',
    '2027-09',
    '2027-10',
  ];
  return months.slice(0, count).map((releaseMonth, index) =>
    fakeRelease({
      id: index + 1,
      externalId: `payment_prior_release_${index + 1}`,
      lotId,
      releaseMonth,
      principalCreditCents: 6_667,
      bonusCreditCents: 1_334,
      idempotencyKey: `monthly_release:${releaseMonth}:${lotId}`,
      createdAt: new Date(`${releaseMonth}-01T00:00:00.000Z`),
    }),
  );
}

describe('partner monthly release pure rules', () => {
  it('releases the full target when budget is enough', () => {
    expect(calculateMonthlyReleaseWithBudget({ targetCreditCents: 1_500_00, budgetCreditCents: 2_000_00 })).toEqual({
      releasedCreditCents: 1_500_00,
      carryForwardCreditCents: 0,
    });
  });

  it('carries forward the unreleased target when budget is short', () => {
    expect(calculateMonthlyReleaseWithBudget({ targetCreditCents: 1_500_00, budgetCreditCents: 500_00 })).toEqual({
      releasedCreditCents: 500_00,
      carryForwardCreditCents: 1_000_00,
    });
  });

  it('throws RangeError for invalid pure-function inputs', () => {
    expect(() =>
      calculateMonthlyReleaseWithBudget({ targetCreditCents: -1, budgetCreditCents: 500_00 }),
    ).toThrow(RangeError);
    expect(() =>
      calculateMonthlyReleaseWithBudget({ targetCreditCents: 1_500_00, budgetCreditCents: 1.5 }),
    ).toThrow(RangeError);
    expect(() =>
      calculateMonthlyReleaseWithBudget({
        targetCreditCents: Number.MAX_SAFE_INTEGER + 1,
        budgetCreditCents: 500_00,
      }),
    ).toThrow(RangeError);
  });
});

describe('ReleaseService releaseEligibleLots', () => {
  it('throws RangeError for invalid months and budgets', async () => {
    const service = new ReleaseService(new FakeReleaseDb().asDB());

    await expect(service.releaseEligibleLots({ releaseMonth: '2026-13', budgetCreditCents: 1 })).rejects.toThrow(
      RangeError,
    );
    await expect(service.releaseEligibleLots({ releaseMonth: '2026-02-01', budgetCreditCents: 1 })).rejects.toThrow(
      RangeError,
    );
    await expect(service.releaseEligibleLots({ releaseMonth: '2026-11', budgetCreditCents: -1 })).rejects.toThrow(
      RangeError,
    );
  });

  it('creates a full-budget monthly release, credits withdrawable ledger, and reconciles lot totals', async () => {
    const fakeDb = new FakeReleaseDb({ lots: [fakeLot()] });
    const service = new ReleaseService(fakeDb.asDB());

    const summary = await service.releaseEligibleLots({ releaseMonth: '2026-11', budgetCreditCents: 50_000 });

    expect(summary).toEqual({
      releaseMonth: '2026-11',
      eligibleLotCount: 1,
      releaseCount: 1,
      totalReleasedCreditCents: 8_001,
      remainingBudgetCreditCents: 41_999,
    });
    expect(fakeDb.releaseRows).toHaveLength(1);
    expect(fakeDb.releaseRows[0]).toMatchObject({
      lotId: 1,
      releaseMonth: '2026-11',
      principalCreditCents: 6_667,
      bonusCreditCents: 1_334,
      carryForwardCreditCents: 0,
      idempotencyKey: 'monthly_release:2026-11:1',
    });
    expect(fakeDb.ledgerRows.map((row) => [row.entryType, row.bucket, row.amountCreditCents])).toEqual([
      ['monthly_release_principal', 'withdrawable', 6_667],
      ['monthly_release_bonus', 'withdrawable', 1_334],
    ]);
    expect(fakeDb.lotRows[0]).toMatchObject({
      status: 'releasing',
      releasedPrincipalCreditCents: 6_667,
      releasedBonusCreditCents: 1_334,
      carryForwardCreditCents: 0,
    });
  });

  it('transitions matured accumulating lots before monthly release and is idempotent', async () => {
    const fakeDb = new FakeReleaseDb({
      lots: [
        fakeLot({
          status: 'accumulating',
          accumulationEndsAt: new Date('2026-10-29T00:00:00.000Z'),
          releaseStartsAt: new Date('2026-11-01T00:00:00.000Z'),
        }),
        fakeLot({
          id: 2,
          externalId: 'payment_lot_not_matured',
          status: 'accumulating',
          accumulationEndsAt: new Date('2026-12-15T00:00:00.000Z'),
          releaseStartsAt: new Date('2026-12-16T00:00:00.000Z'),
        }),
        fakeLot({
          id: 3,
          externalId: 'payment_lot_frozen',
          status: 'accumulating',
          riskStatus: 'frozen',
          accumulationEndsAt: new Date('2026-10-29T00:00:00.000Z'),
          releaseStartsAt: new Date('2026-11-01T00:00:00.000Z'),
        }),
      ],
    });
    const service = new ReleaseService(fakeDb.asDB());

    const first = await service.releaseEligibleLots({ releaseMonth: '2026-11', budgetCreditCents: 50_000 });
    const second = await service.releaseEligibleLots({ releaseMonth: '2026-11', budgetCreditCents: 50_000 });

    expect(first).toMatchObject({
      eligibleLotCount: 1,
      releaseCount: 1,
      totalReleasedCreditCents: 8_001,
    });
    expect(second).toEqual(first);
    expect(fakeDb.lotStatusTransitions).toEqual([{ lotId: 1, status: 'release_pending' }]);
    expect(fakeDb.lotRows.map((lot) => [lot.id, lot.status])).toEqual([
      [1, 'releasing'],
      [2, 'accumulating'],
      [3, 'accumulating'],
    ]);
    expect(fakeDb.releaseRows).toHaveLength(1);
  });

  it('carries forward a short-budget release and consumes the remaining budget', async () => {
    const fakeDb = new FakeReleaseDb({ lots: [fakeLot()] });
    const service = new ReleaseService(fakeDb.asDB());

    const summary = await service.releaseEligibleLots({ releaseMonth: '2026-11', budgetCreditCents: 5_000 });

    expect(summary).toEqual({
      releaseMonth: '2026-11',
      eligibleLotCount: 1,
      releaseCount: 1,
      totalReleasedCreditCents: 5_000,
      remainingBudgetCreditCents: 0,
    });
    expect(fakeDb.releaseRows[0]).toMatchObject({
      principalCreditCents: 5_000,
      bonusCreditCents: 0,
      carryForwardCreditCents: 3_001,
    });
    expect(fakeDb.ledgerRows.map((row) => [row.entryType, row.amountCreditCents])).toEqual([
      ['monthly_release_principal', 5_000],
    ]);
    expect(fakeDb.lotRows[0]).toMatchObject({
      releasedPrincipalCreditCents: 5_000,
      releasedBonusCreditCents: 0,
      carryForwardCreditCents: 3_001,
    });
  });

  it('uses next-month budget to catch up carried-forward principal before paying bonus ahead', async () => {
    const fakeDb = new FakeReleaseDb({ lots: [fakeLot()] });
    const service = new ReleaseService(fakeDb.asDB());

    await service.releaseEligibleLots({ releaseMonth: '2026-11', budgetCreditCents: 5_000 });
    const summary = await service.releaseEligibleLots({ releaseMonth: '2026-12', budgetCreditCents: 50_000 });

    expect(summary).toEqual({
      releaseMonth: '2026-12',
      eligibleLotCount: 1,
      releaseCount: 1,
      totalReleasedCreditCents: 11_275,
      remainingBudgetCreditCents: 38_725,
    });
    expect(
      fakeDb.releaseRows.map((row) => [
        row.releaseMonth,
        row.principalCreditCents,
        row.bonusCreditCents,
        row.carryForwardCreditCents,
      ]),
    ).toEqual([
      ['2026-11', 5_000, 0, 3_001],
      ['2026-12', 9_820, 1_455, 0],
    ]);
    expect(fakeDb.lotRows[0]).toMatchObject({
      releasedPrincipalCreditCents: 14_820,
      releasedBonusCreditCents: 1_455,
      carryForwardCreditCents: 0,
    });
  });

  it('releases carried-forward principal when bonus is already exhausted', async () => {
    const fakeDb = new FakeReleaseDb({
      lots: [
        fakeLot({
          lockedBonusCreditCents: 2_000,
        }),
      ],
      releases: [
        fakeRelease({
          principalCreditCents: 5_000,
          bonusCreditCents: 2_000,
          carryForwardCreditCents: 7_000,
        }),
      ],
    });
    const service = new ReleaseService(fakeDb.asDB());

    const summary = await service.releaseEligibleLots({ releaseMonth: '2026-12', budgetCreditCents: 50_000 });

    expect(summary).toEqual({
      releaseMonth: '2026-12',
      eligibleLotCount: 1,
      releaseCount: 1,
      totalReleasedCreditCents: 13_819,
      remainingBudgetCreditCents: 36_181,
    });
    expect(fakeDb.releaseRows.at(-1)).toMatchObject({
      releaseMonth: '2026-12',
      principalCreditCents: 13_819,
      bonusCreditCents: 0,
      carryForwardCreditCents: 0,
    });
    expect(fakeDb.lotRows[0]).toMatchObject({
      releasedPrincipalCreditCents: 18_819,
      releasedBonusCreditCents: 2_000,
      carryForwardCreditCents: 0,
    });
  });

  it('reruns an existing release row to repair missing ledger entries and stale lot summaries', async () => {
    const existingRelease = fakeRelease();
    const fakeDb = new FakeReleaseDb({
      lots: [
        fakeLot({
          releasedPrincipalCreditCents: 0,
          releasedBonusCreditCents: 0,
          carryForwardCreditCents: 99,
        }),
      ],
      releases: [existingRelease],
    });
    const service = new ReleaseService(fakeDb.asDB());

    const first = await service.releaseEligibleLots({ releaseMonth: '2026-11', budgetCreditCents: 50_000 });
    const second = await service.releaseEligibleLots({ releaseMonth: '2026-11', budgetCreditCents: 50_000 });

    expect(first).toEqual(second);
    expect(fakeDb.releaseRows).toHaveLength(1);
    expect(fakeDb.releaseInsertAttempts).toEqual([]);
    expect(fakeDb.ledgerRows).toHaveLength(2);
    expect(fakeDb.ledgerInsertAttempts).toHaveLength(4);
    expect(fakeDb.lotRows[0]).toMatchObject({
      releasedPrincipalCreditCents: 6_667,
      releasedBonusCreditCents: 1_334,
      carryForwardCreditCents: 0,
    });
  });

  it('counts an existing release for a now-ineligible lot against the budget before allocating others', async () => {
    const fakeDb = new FakeReleaseDb({
      lots: [
        fakeLot({ id: 1, status: 'frozen', userId: 123 }),
        fakeLot({ id: 2, externalId: 'payment_lot_2', userId: 456 }),
      ],
      releases: [fakeRelease({ lotId: 1 })],
    });
    const service = new ReleaseService(fakeDb.asDB());

    const summary = await service.releaseEligibleLots({ releaseMonth: '2026-11', budgetCreditCents: 15_000 });

    expect(summary).toEqual({
      releaseMonth: '2026-11',
      eligibleLotCount: 1,
      releaseCount: 2,
      totalReleasedCreditCents: 15_000,
      remainingBudgetCreditCents: 0,
    });
    expect(fakeDb.releaseRows.map((row) => [row.lotId, row.principalCreditCents, row.bonusCreditCents, row.carryForwardCreditCents])).toEqual([
      [1, 6_667, 1_334, 0],
      [2, 6_667, 332, 1_002],
    ]);
    expect(fakeDb.ledgerRows.map((row) => [row.lotId, row.entryType, row.amountCreditCents])).toEqual([
      [1, 'monthly_release_principal', 6_667],
      [1, 'monthly_release_bonus', 1_334],
      [2, 'monthly_release_principal', 6_667],
      [2, 'monthly_release_bonus', 332],
    ]);
  });

  it('uses prior releases to reduce remaining principal, bonus, and release-month count', async () => {
    const fakeDb = new FakeReleaseDb({
      lots: [
        fakeLot({
          releasedPrincipalCreditCents: 0,
          releasedBonusCreditCents: 0,
        }),
      ],
      releases: priorMonthlyReleases(11),
    });
    const service = new ReleaseService(fakeDb.asDB());

    const summary = await service.releaseEligibleLots({ releaseMonth: '2027-10', budgetCreditCents: 50_000 });

    expect(summary).toEqual({
      releaseMonth: '2027-10',
      eligibleLotCount: 1,
      releaseCount: 1,
      totalReleasedCreditCents: 7_989,
      remainingBudgetCreditCents: 42_011,
    });
    expect(fakeDb.releaseRows.at(-1)).toMatchObject({
      releaseMonth: '2027-10',
      principalCreditCents: 6_663,
      bonusCreditCents: 1_326,
      carryForwardCreditCents: 0,
    });
    expect(fakeDb.lotRows[0]).toMatchObject({
      status: 'completed',
      releasedPrincipalCreditCents: 80_000,
      releasedBonusCreditCents: 16_000,
      carryForwardCreditCents: 0,
    });
  });

  it('does not backfill an earlier month when later releases already consumed the lot capacity', async () => {
    const fakeDb = new FakeReleaseDb({
      lots: [
        fakeLot({
          releasedPrincipalCreditCents: 0,
          releasedBonusCreditCents: 0,
          carryForwardCreditCents: 99,
        }),
      ],
      releases: [
        fakeRelease({
          releaseMonth: '2026-12',
          principalCreditCents: 80_000,
          bonusCreditCents: 16_000,
          idempotencyKey: 'monthly_release:2026-12:1',
        }),
      ],
    });
    const service = new ReleaseService(fakeDb.asDB());

    const summary = await service.releaseEligibleLots({ releaseMonth: '2026-11', budgetCreditCents: 50_000 });

    expect(summary).toEqual({
      releaseMonth: '2026-11',
      eligibleLotCount: 1,
      releaseCount: 0,
      totalReleasedCreditCents: 0,
      remainingBudgetCreditCents: 50_000,
    });
    expect(fakeDb.releaseRows).toHaveLength(1);
    expect(fakeDb.ledgerRows).toEqual([]);
    expect(fakeDb.lotRows[0]).toMatchObject({
      releasedPrincipalCreditCents: 80_000,
      releasedBonusCreditCents: 16_000,
      carryForwardCreditCents: 0,
    });
  });

  it('caps an earlier backfill release to capacity left after later releases', async () => {
    const fakeDb = new FakeReleaseDb({
      lots: [fakeLot()],
      releases: [
        fakeRelease({
          releaseMonth: '2026-12',
          principalCreditCents: 75_000,
          bonusCreditCents: 15_000,
          idempotencyKey: 'monthly_release:2026-12:1',
        }),
      ],
    });
    const service = new ReleaseService(fakeDb.asDB());

    const summary = await service.releaseEligibleLots({ releaseMonth: '2026-11', budgetCreditCents: 50_000 });

    expect(summary).toEqual({
      releaseMonth: '2026-11',
      eligibleLotCount: 1,
      releaseCount: 1,
      totalReleasedCreditCents: 6_000,
      remainingBudgetCreditCents: 44_000,
    });
    expect(fakeDb.releaseRows.at(-1)).toMatchObject({
      releaseMonth: '2026-11',
      principalCreditCents: 5_000,
      bonusCreditCents: 1_000,
      carryForwardCreditCents: 0,
    });
    expect(fakeDb.ledgerRows.map((row) => [row.entryType, row.amountCreditCents])).toEqual([
      ['monthly_release_principal', 5_000],
      ['monthly_release_bonus', 1_000],
    ]);
    expect(fakeDb.lotRows[0]).toMatchObject({
      releasedPrincipalCreditCents: 80_000,
      releasedBonusCreditCents: 16_000,
      carryForwardCreditCents: 0,
    });
  });

  it('does not create a release row when budget is zero', async () => {
    const fakeDb = new FakeReleaseDb({ lots: [fakeLot()] });
    const service = new ReleaseService(fakeDb.asDB());

    const summary = await service.releaseEligibleLots({ releaseMonth: '2026-11', budgetCreditCents: 0 });

    expect(summary).toEqual({
      releaseMonth: '2026-11',
      eligibleLotCount: 1,
      releaseCount: 0,
      totalReleasedCreditCents: 0,
      remainingBudgetCreditCents: 0,
    });
    expect(fakeDb.releaseRows).toEqual([]);
    expect(fakeDb.ledgerRows).toEqual([]);
  });

  it('does not create a zero-value release when the computed slice is zero', async () => {
    const fakeDb = new FakeReleaseDb({
      lots: [
        fakeLot({
          principalCreditCents: 0,
          lockedBonusCreditCents: 0,
          bonusCapCreditCents: 0,
        }),
      ],
    });
    const service = new ReleaseService(fakeDb.asDB());

    const summary = await service.releaseEligibleLots({ releaseMonth: '2026-11', budgetCreditCents: 50_000 });

    expect(summary).toEqual({
      releaseMonth: '2026-11',
      eligibleLotCount: 1,
      releaseCount: 0,
      totalReleasedCreditCents: 0,
      remainingBudgetCreditCents: 50_000,
    });
    expect(fakeDb.releaseRows).toEqual([]);
    expect(fakeDb.ledgerRows).toEqual([]);
  });

  it('skips lots outside the release window or with non-normal risk', async () => {
    const fakeDb = new FakeReleaseDb({
      lots: [
        fakeLot({ id: 1, releaseStartsAt: new Date('2026-12-01T00:00:00.000Z') }),
        fakeLot({
          id: 2,
          externalId: 'payment_lot_2',
          releaseEndsAt: new Date('2026-10-31T00:00:00.000Z'),
        }),
        fakeLot({ id: 3, externalId: 'payment_lot_3', riskStatus: 'frozen' }),
        fakeLot({
          id: 4,
          externalId: 'payment_lot_4',
          status: 'accumulating',
          accumulationEndsAt: new Date('2026-12-15T00:00:00.000Z'),
          releaseStartsAt: new Date('2026-12-16T00:00:00.000Z'),
        }),
      ],
    });
    const service = new ReleaseService(fakeDb.asDB());

    const summary = await service.releaseEligibleLots({ releaseMonth: '2026-11', budgetCreditCents: 50_000 });

    expect(summary).toEqual({
      releaseMonth: '2026-11',
      eligibleLotCount: 0,
      releaseCount: 0,
      totalReleasedCreditCents: 0,
      remainingBudgetCreditCents: 50_000,
    });
    expect(fakeDb.releaseRows).toEqual([]);
    expect(fakeDb.ledgerRows).toEqual([]);
  });
});
