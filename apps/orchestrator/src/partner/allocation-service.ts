import {
  API_UNITS_PER_HOLA_CREDIT,
  HOLA_CREDIT_CNY_CENTS,
  PARTNER_ACCUMULATION_DAYS,
  newExternalId,
} from '@holaday/shared-types';
import { and, eq, gte, lt, sql } from 'drizzle-orm';
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

const BPS_DENOMINATOR = 10_000n;
const USD_MICROS_PER_USD = 1_000_000n;
const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVITY_FACTOR_BPS = 10_000;
const AGE_FACTOR_BPS = 10_000;
const RISK_FACTOR_BPS = 10_000;
const MYSQL_UNSIGNED_INT_MAX = 4_294_967_295;

export class CostPoolIdempotencyConflictError extends Error {
  constructor() {
    super('API cost pool idempotency key was reused with a different payload');
    this.name = 'CostPoolIdempotencyConflictError';
    Object.setPrototypeOf(this, CostPoolIdempotencyConflictError.prototype);
  }
}

function assertNonNegativeSafeInteger(value: number, fieldName: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${fieldName} must be a non-negative safe integer`);
  }
  return value;
}

function assertPositiveSafeInteger(value: number, fieldName: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${fieldName} must be a positive safe integer`);
  }
  return value;
}

function toSafeInteger(value: bigint, fieldName: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`${fieldName} exceeds Number.MAX_SAFE_INTEGER`);
  }
  return Number(value);
}

function normalizeDay(value: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RangeError('day must be YYYY-MM-DD');
  }

  const [yearText, monthText, dayText] = value.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new RangeError('day must be a valid calendar date');
  }

  return value;
}

function dayBoundsUtc(day: string): { start: Date; end: Date } {
  const normalizedDay = normalizeDay(day);
  const start = new Date(`${normalizedDay}T00:00:00.000Z`);
  return {
    start,
    end: new Date(start.getTime() + DAY_MS),
  };
}

function parseUsdCostMicros(costUsd: string | number): number {
  const text = typeof costUsd === 'number' ? String(costUsd) : costUsd;
  if (typeof text !== 'string' || !/^\d+(?:\.\d{1,6})?$/.test(text)) {
    throw new RangeError('costUsd must be a non-negative decimal with up to 6 fractional digits');
  }

  const [wholeText = '0', fractionText = ''] = text.split('.');
  const micros = BigInt(wholeText) * USD_MICROS_PER_USD + BigInt(fractionText.padEnd(6, '0'));
  return toSafeInteger(micros, 'costUsdMicros');
}

function assertMysqlUnsignedInt(value: number, fieldName: string): number {
  assertNonNegativeSafeInteger(value, fieldName);
  if (value > MYSQL_UNSIGNED_INT_MAX) {
    throw new RangeError(`${fieldName} must fit in a MySQL unsigned int`);
  }
  return value;
}

export function calculateApiUnitsFromUsdCost(input: { costUsdMicros: number; fxBps: number }): number {
  const costUsdMicros = BigInt(assertNonNegativeSafeInteger(input.costUsdMicros, 'costUsdMicros'));
  const fxBps = BigInt(assertPositiveSafeInteger(input.fxBps, 'fxBps'));
  const apiUnits =
    (costUsdMicros * fxBps * BigInt(API_UNITS_PER_HOLA_CREDIT) * 100n) /
    (USD_MICROS_PER_USD * BPS_DENOMINATOR * BigInt(HOLA_CREDIT_CNY_CENTS));
  return toSafeInteger(apiUnits, 'apiUnits');
}

export function calculateLotWeight(input: {
  apiUnits: number;
  ageFactorBps: number;
  activityFactorBps: number;
  riskFactorBps: number;
}): number {
  const apiUnits = BigInt(assertNonNegativeSafeInteger(input.apiUnits, 'apiUnits'));
  const ageFactorBps = BigInt(assertPositiveSafeInteger(input.ageFactorBps, 'ageFactorBps'));
  const activityFactorBps = BigInt(assertPositiveSafeInteger(input.activityFactorBps, 'activityFactorBps'));
  const riskFactorBps = BigInt(assertPositiveSafeInteger(input.riskFactorBps, 'riskFactorBps'));
  const weight =
    (apiUnits * ageFactorBps * activityFactorBps * riskFactorBps) /
    (BPS_DENOMINATOR * BPS_DENOMINATOR * BPS_DENOMINATOR);
  return toSafeInteger(weight, 'apiUnitsWeight');
}

export function capDailyBonus(input: {
  targetCreditCents: number;
  remainingBonusCreditCents: number;
}): number {
  const targetCreditCents = assertNonNegativeSafeInteger(input.targetCreditCents, 'targetCreditCents');
  const remainingBonusCreditCents = assertNonNegativeSafeInteger(
    input.remainingBonusCreditCents,
    'remainingBonusCreditCents',
  );
  return Math.min(targetCreditCents, remainingBonusCreditCents);
}

function sumUsdCostMicros(rows: ReadonlyArray<{ costUsd: string | number }>): number {
  let total = 0n;
  for (const row of rows) {
    total += BigInt(parseUsdCostMicros(row.costUsd));
  }
  return toSafeInteger(total, 'costUsdMicros');
}

function assertCostPoolPayloadMatches(
  row: ApiCostPoolEvent,
  expected: {
    eventDate: string;
    source: string;
    costUsdMicros: number;
    fxBps: number;
    apiUnits: number;
  },
): void {
  if (
    row.eventDate !== expected.eventDate ||
    row.source !== expected.source ||
    row.costUsdMicros !== expected.costUsdMicros ||
    row.fxBps !== expected.fxBps ||
    row.apiUnits !== expected.apiUnits
  ) {
    throw new CostPoolIdempotencyConflictError();
  }
}

function remainingBonusCreditCents(lot: PartnerLot, allocatedBonusCreditCents: number): number {
  assertNonNegativeSafeInteger(allocatedBonusCreditCents, 'allocatedBonusCreditCents');
  if (allocatedBonusCreditCents >= lot.bonusCapCreditCents) return 0;
  return lot.bonusCapCreditCents - allocatedBonusCreditCents;
}

function weightLot(lot: PartnerLot): number {
  return calculateLotWeight({
    apiUnits: lot.apiUnits,
    ageFactorBps: AGE_FACTOR_BPS,
    activityFactorBps: ACTIVITY_FACTOR_BPS,
    riskFactorBps: RISK_FACTOR_BPS,
  });
}

function calculateLotDailyTarget(lot: PartnerLot): number {
  return Math.floor(lot.bonusCapCreditCents / PARTNER_ACCUMULATION_DAYS);
}

function calculateProportionalShare(input: {
  budgetCreditCents: number;
  lotWeight: number;
  totalWeight: bigint;
}): number {
  if (input.budgetCreditCents === 0 || input.lotWeight === 0 || input.totalWeight === 0n) return 0;
  const share =
    (BigInt(input.budgetCreditCents) * BigInt(input.lotWeight)) / input.totalWeight;
  return toSafeInteger(share, 'targetCreditCents');
}

function assertAllocationBudget(value: number): number {
  return assertMysqlUnsignedInt(value, 'budgetCreditCents');
}

function sumLockedBonusCreditCents(rows: ReadonlyArray<{ lockedBonusCreditCents: number }>): number {
  return rows.reduce((sum, row) => sum + row.lockedBonusCreditCents, 0);
}

export interface DailyLockedBonusSummary {
  day: string;
  eligibleLotCount: number;
  allocationCount: number;
  totalLockedBonusCreditCents: number;
  remainingBudgetCreditCents: number;
}

interface LotAllocationState {
  lot: PartnerLot;
  weight: number;
  idempotencyKey: string;
  existingAllocation: PartnerDailyAllocation | undefined;
  allocatedBonusCreditCents: number;
}

export class AllocationService {
  constructor(private readonly db: DB) {}

  private async readDailyAllocation(lotId: number, day: string): Promise<PartnerDailyAllocation | undefined> {
    const [allocation] = await this.db
      .select()
      .from(partnerDailyAllocations)
      .where(and(eq(partnerDailyAllocations.lotId, lotId), eq(partnerDailyAllocations.allocationDate, day)))
      .limit(1);
    return allocation;
  }

  private async reconcileLotLockedBonus(lotId: number): Promise<void> {
    await this.db
      .update(partnerLots)
      .set({
        lockedBonusCreditCents: sql<number>`(
          SELECT COALESCE(SUM(${partnerDailyAllocations.lockedBonusCreditCents}), 0)
          FROM ${partnerDailyAllocations}
          WHERE ${partnerDailyAllocations.lotId} = ${lotId}
        )`,
      })
      .where(eq(partnerLots.id, lotId));
  }

  async buildDailyCostPool(input: { day: string; fxBps: number }): Promise<ApiCostPoolEvent> {
    const day = normalizeDay(input.day);
    const fxBps = assertPositiveSafeInteger(input.fxBps, 'fxBps');
    const { start, end } = dayBoundsUtc(day);
    const idempotencyKey = `llm_calls:${day}`;

    const rows = await this.db
      .select({ costUsd: llmCalls.costUsd })
      .from(llmCalls)
      .where(and(gte(llmCalls.createdAt, start), lt(llmCalls.createdAt, end)));
    const costUsdMicros = sumUsdCostMicros(rows);
    const apiUnits = calculateApiUnitsFromUsdCost({ costUsdMicros, fxBps });
    const expected = {
      eventDate: day,
      source: 'llm_calls',
      costUsdMicros,
      fxBps,
      apiUnits,
    };

    await this.db
      .insert(apiCostPoolEvents)
      .values({
        externalId: newExternalId('payment'),
        ...expected,
        idempotencyKey,
        metadata: null,
      })
      .onDuplicateKeyUpdate({ set: { idempotencyKey: sql`idempotency_key` } });

    const [row] = await this.db
      .select()
      .from(apiCostPoolEvents)
      .where(eq(apiCostPoolEvents.idempotencyKey, idempotencyKey))
      .limit(1);

    if (!row) {
      throw new Error('API cost pool event vanished after idempotent insert');
    }
    assertCostPoolPayloadMatches(row, expected);
    return row;
  }

  async allocateDailyLockedBonus(input: {
    day: string;
    budgetCreditCents: number;
  }): Promise<DailyLockedBonusSummary> {
    const day = normalizeDay(input.day);
    const budgetCreditCents = assertAllocationBudget(input.budgetCreditCents);
    const existingAllocationsForDay = await this.db
      .select()
      .from(partnerDailyAllocations)
      .where(eq(partnerDailyAllocations.allocationDate, day));
    const existingAllocationByLotId = new Map<number, PartnerDailyAllocation>();
    const lotIdsToReconcile = new Set<number>();

    for (const allocation of existingAllocationsForDay) {
      if (!existingAllocationByLotId.has(allocation.lotId)) {
        existingAllocationByLotId.set(allocation.lotId, allocation);
      }
      lotIdsToReconcile.add(allocation.lotId);
    }

    const lots = await this.db
      .select()
      .from(partnerLots)
      .where(and(eq(partnerLots.status, 'accumulating'), eq(partnerLots.riskStatus, 'normal')));
    const weightedLots = lots.map((lot) => ({ lot, weight: weightLot(lot) }));
    const lotAllocationStates: LotAllocationState[] = [];

    for (const { lot, weight } of weightedLots) {
      const idempotencyKey = `daily:${day}:${lot.id}`;
      const allocationRowsForLot = await this.db
        .select()
        .from(partnerDailyAllocations)
        .where(eq(partnerDailyAllocations.lotId, lot.id));
      const allocatedBonusCreditCents = sumLockedBonusCreditCents(allocationRowsForLot);
      const existingAllocation =
        allocationRowsForLot.find((allocation) => allocation.allocationDate === day) ??
        existingAllocationByLotId.get(lot.id);

      if (allocatedBonusCreditCents > 0) {
        lotIdsToReconcile.add(lot.id);
      }

      lotAllocationStates.push({ lot, weight, idempotencyKey, existingAllocation, allocatedBonusCreditCents });
    }

    const existingLockedBonusCreditCents = sumLockedBonusCreditCents(existingAllocationsForDay);
    const remainingBudgetForNewAllocations = Math.max(0, budgetCreditCents - existingLockedBonusCreditCents);
    const missingAllocationWeight = lotAllocationStates
      .filter((item) => !item.existingAllocation)
      .reduce((sum, item) => sum + BigInt(item.weight), 0n);

    let totalLockedBonusCreditCents = existingLockedBonusCreditCents;
    let allocationCount = existingAllocationsForDay.length;

    for (const { lot, weight, idempotencyKey, existingAllocation, allocatedBonusCreditCents } of lotAllocationStates) {
      let lockedBonusCreditCents = existingAllocation?.lockedBonusCreditCents ?? 0;

      if (!existingAllocation) {
        const targetCreditCents = calculateProportionalShare({
          budgetCreditCents: remainingBudgetForNewAllocations,
          lotWeight: weight,
          totalWeight: missingAllocationWeight,
        });
        const cappedByRemaining = capDailyBonus({
          targetCreditCents,
          remainingBonusCreditCents: remainingBonusCreditCents(lot, allocatedBonusCreditCents),
        });
        lockedBonusCreditCents = capDailyBonus({
          targetCreditCents: cappedByRemaining,
          remainingBonusCreditCents: calculateLotDailyTarget(lot),
        });
      }

      if (!existingAllocation && lockedBonusCreditCents === 0) {
        continue;
      }

      await this.db
        .insert(partnerDailyAllocations)
        .values({
          externalId: newExternalId('payment'),
          lotId: lot.id,
          allocationDate: day,
          lockedBonusCreditCents: assertMysqlUnsignedInt(lockedBonusCreditCents, 'lockedBonusCreditCents'),
          apiUnitsWeight: weight,
          idempotencyKey,
          metadata: null,
        })
        .onDuplicateKeyUpdate({ set: { idempotencyKey: sql`idempotency_key` } });

      const allocation = await this.readDailyAllocation(lot.id, day);

      if (!allocation) {
        throw new Error('partner daily allocation vanished after idempotent insert');
      }

      if (!existingAllocation) {
        allocationCount += 1;
        totalLockedBonusCreditCents += allocation.lockedBonusCreditCents;
      }
      lotIdsToReconcile.add(allocation.lotId);
    }

    for (const lotId of lotIdsToReconcile) {
      await this.reconcileLotLockedBonus(lotId);
    }

    return {
      day,
      eligibleLotCount: lots.length,
      allocationCount,
      totalLockedBonusCreditCents,
      remainingBudgetCreditCents: Math.max(0, budgetCreditCents - totalLockedBonusCreditCents),
    };
  }
}
