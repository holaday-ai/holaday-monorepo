import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import type { DB } from '../db/client.js';
import {
  partnerLots,
  partnerRiskEvents,
  type NewPartnerRiskEvent,
  type PartnerLot,
  type PartnerRiskEvent,
} from '../db/schema/partner.js';
import { PartnerRiskLotService, PartnerRiskLotTransitionError } from './risk-lot-service.js';

type RiskEventInsert = NewPartnerRiskEvent;

class FakeRiskLotDb {
  readonly lotRows: PartnerLot[];
  readonly riskEventRows: PartnerRiskEvent[] = [];
  readonly riskEventInsertAttempts: RiskEventInsert[] = [];
  private nextRiskEventId = 1;

  constructor(input: { lots?: PartnerLot[] } = {}) {
    this.lotRows = [...(input.lots ?? [fakeLot()])];
  }

  asDB(): DB {
    return this as unknown as DB;
  }

  async transaction<T>(callback: (tx: DB) => Promise<T>): Promise<T> {
    return callback(this.asDB());
  }

  select(_selection?: unknown) {
    return {
      from: (table: unknown) => ({
        where: (predicate: unknown) => this.selectRows(table, predicate),
      }),
    };
  }

  update(table: unknown) {
    if (table !== partnerLots) {
      throw new Error(`unexpected update table: ${String(table)}`);
    }

    return {
      set: (values: Partial<PartnerLot>) => ({
        where: async (predicate: unknown) => {
          const lot = this.findLotByPredicate(predicate);
          if (!lot) return;
          Object.assign(lot, values);
        },
      }),
    };
  }

  insert(table: unknown) {
    if (table !== partnerRiskEvents) {
      throw new Error(`unexpected insert table: ${String(table)}`);
    }

    return {
      values: async (values: RiskEventInsert) => {
        this.riskEventInsertAttempts.push(values);
        this.riskEventRows.push({
          id: this.nextRiskEventId,
          externalId: values.externalId,
          userId: values.userId,
          lotId: values.lotId ?? null,
          eventType: values.eventType,
          severity: values.severity,
          status: values.status ?? 'open',
          metadata: values.metadata ?? null,
          createdAt: values.createdAt ?? new Date('2026-07-02T00:00:00.000Z'),
          updatedAt: values.updatedAt ?? new Date('2026-07-02T00:00:00.000Z'),
        });
        this.nextRiskEventId += 1;
      },
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

  private rowsForTable(table: unknown, predicate: unknown): unknown[] {
    if (table === partnerLots) {
      const lot = this.findLotByPredicate(predicate);
      return lot ? [lot] : [];
    }
    throw new Error(`unexpected select table: ${String(table)}`);
  }

  private findLotByPredicate(predicate: unknown): PartnerLot | undefined {
    const predicateText = inspect(predicate, { depth: 8, getters: true });
    return this.lotRows.find((lot) => predicateText.includes(lot.externalId));
  }
}

function fakeLot(overrides: Partial<PartnerLot> = {}): PartnerLot {
  return {
    id: 1,
    externalId: 'pay_risk_lot_1',
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
    accumulationStartsAt: new Date('2026-07-01T03:04:05.006Z'),
    accumulationEndsAt: new Date('2026-10-29T03:04:05.006Z'),
    releaseStartsAt: new Date('2026-10-30T03:04:05.006Z'),
    releaseEndsAt: new Date('2027-10-30T03:04:05.006Z'),
    metadata: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('PartnerRiskLotService', () => {
  it('freezes a lot and records a risk event with reviewer metadata', async () => {
    const now = new Date('2026-07-03T09:00:00.000Z');
    const fakeDb = new FakeRiskLotDb();
    const service = new PartnerRiskLotService(fakeDb.asDB());

    const row = await service.freezeLot({
      lotExternalId: 'pay_risk_lot_1',
      reviewerUserId: 9,
      reason: 'bank dispute signal',
      now,
    });

    expect(row).toMatchObject({
      externalId: 'pay_risk_lot_1',
      status: 'frozen',
      riskStatus: 'frozen',
      updatedAt: now,
    });
    expect(row.metadata).toMatchObject({
      riskFrozenByUserId: 9,
      riskFrozenAt: now.toISOString(),
      riskFreezeReason: 'bank dispute signal',
      statusBeforeFreeze: 'accumulating',
      riskStatusBeforeFreeze: 'normal',
    });
    expect(fakeDb.riskEventRows).toHaveLength(1);
    expect(fakeDb.riskEventRows[0]).toMatchObject({
      userId: 123,
      lotId: 1,
      eventType: 'lot_frozen',
      severity: 'high',
      status: 'open',
      metadata: {
        reviewerUserId: 9,
        reason: 'bank dispute signal',
        lotExternalId: 'pay_risk_lot_1',
      },
      createdAt: now,
      updatedAt: now,
    });
  });

  it('resumes a frozen lot by restoring the pre-freeze status and closing the event trail', async () => {
    const now = new Date('2026-07-04T10:30:00.000Z');
    const fakeDb = new FakeRiskLotDb({
      lots: [
        fakeLot({
          status: 'frozen',
          riskStatus: 'frozen',
          metadata: {
            riskFrozenByUserId: 9,
            riskFrozenAt: '2026-07-03T09:00:00.000Z',
            riskFreezeReason: 'bank dispute signal',
            statusBeforeFreeze: 'releasing',
            riskStatusBeforeFreeze: 'review',
          },
        }),
      ],
    });
    const service = new PartnerRiskLotService(fakeDb.asDB());

    const row = await service.resumeLot({
      lotExternalId: 'pay_risk_lot_1',
      reviewerUserId: 10,
      note: 'manual review cleared',
      now,
    });

    expect(row).toMatchObject({
      externalId: 'pay_risk_lot_1',
      status: 'releasing',
      riskStatus: 'review',
      updatedAt: now,
    });
    expect(row.metadata).toMatchObject({
      riskResumedByUserId: 10,
      riskResumedAt: now.toISOString(),
      riskResumeNote: 'manual review cleared',
    });
    expect(fakeDb.riskEventRows).toHaveLength(1);
    expect(fakeDb.riskEventRows[0]).toMatchObject({
      userId: 123,
      lotId: 1,
      eventType: 'lot_resumed',
      severity: 'medium',
      status: 'closed',
      metadata: {
        reviewerUserId: 10,
        note: 'manual review cleared',
        restoredStatus: 'releasing',
        restoredRiskStatus: 'review',
      },
    });
  });

  it('rejects resume for a lot that is not currently frozen', async () => {
    const fakeDb = new FakeRiskLotDb();
    const service = new PartnerRiskLotService(fakeDb.asDB());

    await expect(
      service.resumeLot({
        lotExternalId: 'pay_risk_lot_1',
        reviewerUserId: 10,
      }),
    ).rejects.toEqual(new PartnerRiskLotTransitionError('not_frozen'));
  });

  it('closes a frozen lot with audit metadata and a terminal risk event', async () => {
    const now = new Date('2026-07-05T11:00:00.000Z');
    const fakeDb = new FakeRiskLotDb({
      lots: [
        fakeLot({
          status: 'frozen',
          riskStatus: 'frozen',
          metadata: {
            riskFrozenByUserId: 9,
            riskFrozenAt: '2026-07-03T09:00:00.000Z',
            riskFreezeReason: 'bank dispute signal',
            statusBeforeFreeze: 'releasing',
            riskStatusBeforeFreeze: 'review',
          },
        }),
      ],
    });
    const service = new PartnerRiskLotService(fakeDb.asDB());

    const row = await service.closeLot({
      lotExternalId: 'pay_risk_lot_1',
      reviewerUserId: 11,
      reason: 'provider refund completed',
      resolutionKind: 'refund',
      resolutionRef: 'wx-refund-20260705',
      now,
    });

    expect(row).toMatchObject({
      externalId: 'pay_risk_lot_1',
      status: 'closed',
      riskStatus: 'frozen',
      updatedAt: now,
    });
    expect(row.metadata).toMatchObject({
      riskClosedByUserId: 11,
      riskClosedAt: now.toISOString(),
      riskCloseReason: 'provider refund completed',
      riskCloseResolutionKind: 'refund',
      riskCloseResolutionRef: 'wx-refund-20260705',
    });
    expect(fakeDb.riskEventRows).toHaveLength(1);
    expect(fakeDb.riskEventRows[0]).toMatchObject({
      userId: 123,
      lotId: 1,
      eventType: 'lot_closed',
      severity: 'high',
      status: 'closed',
      metadata: {
        reviewerUserId: 11,
        reason: 'provider refund completed',
        resolutionKind: 'refund',
        resolutionRef: 'wx-refund-20260705',
        lotExternalId: 'pay_risk_lot_1',
      },
      createdAt: now,
      updatedAt: now,
    });
  });

  it('rejects close for a lot that is not currently frozen', async () => {
    const fakeDb = new FakeRiskLotDb({
      lots: [fakeLot({ status: 'accumulating', riskStatus: 'review' })],
    });
    const service = new PartnerRiskLotService(fakeDb.asDB());

    await expect(
      service.closeLot({
        lotExternalId: 'pay_risk_lot_1',
        reviewerUserId: 11,
        reason: 'provider refund completed',
      }),
    ).rejects.toEqual(new PartnerRiskLotTransitionError('not_frozen'));
    expect(fakeDb.riskEventRows).toHaveLength(0);
  });

  it('rejects resume for a terminally closed lot', async () => {
    const fakeDb = new FakeRiskLotDb({
      lots: [
        fakeLot({
          status: 'closed',
          riskStatus: 'frozen',
          metadata: {
            riskClosedByUserId: 11,
            riskClosedAt: '2026-07-05T11:00:00.000Z',
            riskCloseReason: 'provider refund completed',
          },
        }),
      ],
    });
    const service = new PartnerRiskLotService(fakeDb.asDB());

    await expect(
      service.resumeLot({
        lotExternalId: 'pay_risk_lot_1',
        reviewerUserId: 10,
      }),
    ).rejects.toEqual(new PartnerRiskLotTransitionError('closed'));
  });
});
