import { inspect } from 'node:util';
import type { PartnerKycStatus } from '@holaday/shared-types';
import { describe, expect, it } from 'vitest';
import type { DB } from '../db/client.js';
import {
  partnerLots,
  partnerRechargeOrders,
  type PartnerLot,
  type PartnerMembership,
  type PartnerRechargeOrder,
} from '../db/schema/partner.js';
import type { KycService } from './kyc-service.js';
import type { PartnerMembershipService } from './membership-service.js';
import {
  RechargeGateError,
  RechargeLotConflictError,
  RechargeOrderIdempotencyConflictError,
  RechargeService,
  validateRechargeAmount,
} from './recharge-service.js';

type FakeRechargeOrderInsert = {
  externalId: string;
  userId: number;
  provider: string;
  providerOrderId?: string | null;
  providerCaptureId?: string | null;
  amountCnyCents: number;
  status: string;
  orderKind: string;
  idempotencyKey: string;
  metadata?: unknown;
};

type FakeLotInsert = {
  externalId: string;
  userId: number;
  rechargeOrderId: number;
  status: string;
  riskStatus: string;
  principalCreditCents: number;
  tierMultiplierBps: number;
  apiUnits: number;
  bonusCapCreditCents: number;
  lockedBonusCreditCents: number;
  releasedPrincipalCreditCents: number;
  releasedBonusCreditCents: number;
  carryForwardCreditCents: number;
  accumulationStartsAt: Date;
  accumulationEndsAt: Date;
  releaseStartsAt: Date;
  releaseEndsAt: Date;
  metadata?: unknown;
};

class FakeRechargeDb {
  readonly orders: PartnerRechargeOrder[];
  readonly lots: PartnerLot[];
  readonly orderInsertAttempts: FakeRechargeOrderInsert[] = [];
  readonly lotInsertAttempts: FakeLotInsert[] = [];
  readonly wherePredicateTexts: string[] = [];
  orderRowsCreated = 0;
  lotRowsCreated = 0;
  orderDuplicateKeyUpdateCalls = 0;
  lotDuplicateKeyUpdateCalls = 0;
  private nextOrderId: number;
  private nextLotId: number;

  constructor(input: { orders?: PartnerRechargeOrder[]; lots?: PartnerLot[] } = {}) {
    this.orders = [...(input.orders ?? [])];
    this.lots = [...(input.lots ?? [])];
    this.nextOrderId = Math.max(0, ...this.orders.map((row) => row.id)) + 1;
    this.nextLotId = Math.max(0, ...this.lots.map((row) => row.id)) + 1;
  }

  asDB(): DB {
    return this as unknown as DB;
  }

  insert(table: unknown) {
    return {
      values: (values: FakeRechargeOrderInsert | FakeLotInsert) => {
        if (table === partnerRechargeOrders) {
          const orderValues = values as FakeRechargeOrderInsert;
          this.orderInsertAttempts.push(orderValues);
          return {
            onDuplicateKeyUpdate: async (_config: unknown) => {
              this.orderDuplicateKeyUpdateCalls += 1;
              const existing = this.orders.find((row) => row.idempotencyKey === orderValues.idempotencyKey);
              if (existing) return;
              this.orders.push({
                id: this.nextOrderId,
                providerOrderId: null,
                providerCaptureId: null,
                metadata: null,
                createdAt: new Date('2026-01-01T00:00:00.000Z'),
                updatedAt: new Date('2026-01-01T00:00:00.000Z'),
                ...orderValues,
              });
              this.nextOrderId += 1;
              this.orderRowsCreated += 1;
            },
          };
        }

        if (table === partnerLots) {
          const lotValues = values as FakeLotInsert;
          this.lotInsertAttempts.push(lotValues);
          return {
            onDuplicateKeyUpdate: async (_config: unknown) => {
              this.lotDuplicateKeyUpdateCalls += 1;
              const existing = this.lots.find((row) => row.rechargeOrderId === lotValues.rechargeOrderId);
              if (existing) return;
              this.lots.push({
                id: this.nextLotId,
                metadata: null,
                createdAt: new Date('2026-01-01T00:00:00.000Z'),
                updatedAt: new Date('2026-01-01T00:00:00.000Z'),
                ...lotValues,
              });
              this.nextLotId += 1;
              this.lotRowsCreated += 1;
            },
          };
        }

        throw new Error('unexpected insert table');
      },
    };
  }

  select(_selection?: unknown) {
    return {
      from: (table: unknown) => ({
        where: (predicate: unknown) => {
          const predicateText = inspect(predicate, { depth: 6, getters: true });
          this.wherePredicateTexts.push(predicateText);
          const chain = {
            limit: async (count: number) => this.selectRows(table, predicateText).slice(0, count),
            then: (
              onFulfilled?: ((value: Array<PartnerRechargeOrder | PartnerLot>) => unknown) | null,
              onRejected?: ((reason: unknown) => unknown) | null,
            ) => Promise.resolve(this.selectRows(table, predicateText)).then(onFulfilled, onRejected),
          };
          return chain;
        },
      }),
    };
  }

  private selectRows(table: unknown, predicateText: string): Array<PartnerRechargeOrder | PartnerLot> {
    if (table === partnerRechargeOrders) {
      const byKey = this.orders.find((row) => predicateText.includes(row.idempotencyKey));
      if (byKey) return [byKey];
      const byExternalId = this.orders.find((row) => predicateText.includes(row.externalId));
      return byExternalId ? [byExternalId] : [];
    }

    if (table === partnerLots) {
      const byExternalId = this.lots.find((row) => predicateText.includes(row.externalId));
      if (byExternalId) return [byExternalId];
      const byRechargeOrderId = this.lots.find(
        (row) => predicateText.includes('recharge_order_id') && predicateText.includes(String(row.rechargeOrderId)),
      );
      return byRechargeOrderId ? [byRechargeOrderId] : [];
    }

    return [];
  }
}

function fakeOrder(overrides: Partial<PartnerRechargeOrder> = {}): PartnerRechargeOrder {
  return {
    id: 1,
    externalId: 'pay_existing_order',
    userId: 123,
    provider: 'wechat',
    providerOrderId: null,
    providerCaptureId: null,
    amountCnyCents: 10_000_00,
    status: 'pending',
    orderKind: 'recharge',
    idempotencyKey: 'order-idem-1',
    metadata: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function fakeLot(overrides: Partial<PartnerLot> = {}): PartnerLot {
  return {
    id: 1,
    externalId: 'pay_existing_lot',
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
    releaseEndsAt: new Date('2027-06-30T03:04:05.006Z'),
    metadata: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function fakeActiveMembership(): PartnerMembership {
  return {
    id: 99,
    externalId: 'pay_membership',
    userId: 123,
    status: 'active',
    startsAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: new Date('2027-01-01T00:00:00.000Z'),
    sourcePaymentExternalId: null,
    metadata: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

function fakeMembershipService(
  membership: PartnerMembership | null,
): Pick<PartnerMembershipService, 'getActiveMembership'> {
  return {
    getActiveMembership: async () => membership,
  };
}

function fakeKycService(status: PartnerKycStatus): Pick<KycService, 'getStatus'> {
  return {
    getStatus: async () => status,
  };
}

const validRechargeOrderInput: Parameters<RechargeService['createPendingOrder']>[0] = {
  userId: 123,
  provider: 'wechat',
  amountCnyCents: 10_000_00,
  orderKind: 'recharge',
  idempotencyKey: 'order-idem-1',
  now: new Date('2026-07-02T00:00:00.000Z'),
};

function serviceWithGates(
  fakeDb: FakeRechargeDb,
  input: {
    membership?: PartnerMembership | null;
    kycStatus?: PartnerKycStatus;
  } = {},
): RechargeService {
  return new RechargeService(fakeDb.asDB(), {
    membership: fakeMembershipService(
      Object.hasOwn(input, 'membership') ? (input.membership ?? null) : fakeActiveMembership(),
    ) as PartnerMembershipService,
    kyc: fakeKycService(input.kycStatus ?? 'passed') as KycService,
  });
}

describe('validateRechargeAmount', () => {
  it.each([
    [9_999_00, { ok: false, reason: 'below_minimum' }],
    [10_000_00, { ok: true }],
    [200_000_00, { ok: true }],
    [200_001_00, { ok: false, reason: 'above_single_maximum' }],
    [10_000_01, { ok: false, reason: 'not_whole_cny' }],
    [-100_00, { ok: false, reason: 'invalid_amount' }],
    [Number.NaN, { ok: false, reason: 'invalid_amount' }],
    [10_000_00.5, { ok: false, reason: 'invalid_amount' }],
  ])('validates %s as %o', (amount, expected) => {
    expect(validateRechargeAmount(amount)).toEqual(expected);
  });
});

describe('RechargeService createPendingOrder', () => {
  it('blocks recharge orders when membership is missing', async () => {
    const fakeDb = new FakeRechargeDb();
    const service = serviceWithGates(fakeDb, { membership: null, kycStatus: 'passed' });

    await expect(service.createPendingOrder(validRechargeOrderInput)).rejects.toBeInstanceOf(RechargeGateError);
    expect(fakeDb.orderRowsCreated).toBe(0);
  });

  it('blocks recharge orders when KYC has not passed', async () => {
    const fakeDb = new FakeRechargeDb();
    const service = serviceWithGates(fakeDb, { membership: fakeActiveMembership(), kycStatus: 'pending' });

    await expect(service.createPendingOrder(validRechargeOrderInput)).rejects.toBeInstanceOf(RechargeGateError);
    expect(fakeDb.orderRowsCreated).toBe(0);
  });

  it('inserts a pending recharge order and returns the readback row when gates pass', async () => {
    const fakeDb = new FakeRechargeDb();
    const service = serviceWithGates(fakeDb);

    const row = await service.createPendingOrder(validRechargeOrderInput);

    expect(row).toMatchObject({
      userId: 123,
      provider: 'wechat',
      amountCnyCents: 10_000_00,
      status: 'pending',
      orderKind: 'recharge',
      idempotencyKey: 'order-idem-1',
      metadata: null,
    });
    expect(row.externalId).toMatch(/^pay_/);
    expect(fakeDb.orderRowsCreated).toBe(1);
    expect(fakeDb.wherePredicateTexts.some((predicateText) => predicateText.includes('idempotency_key'))).toBe(true);
  });

  it('returns an existing order for the same idempotency key and same payload', async () => {
    const existing = fakeOrder();
    const fakeDb = new FakeRechargeDb({ orders: [existing] });
    const service = serviceWithGates(fakeDb);

    const row = await service.createPendingOrder(validRechargeOrderInput);

    expect(row).toBe(existing);
    expect(fakeDb.orders).toHaveLength(1);
    expect(fakeDb.orderRowsCreated).toBe(0);
  });

  it.each([
    ['different amount', { amountCnyCents: 11_000_00 }],
    ['different user', { userId: 456 }],
  ])('throws a conflict error for the same idempotency key with a %s', async (_name, patch) => {
    const fakeDb = new FakeRechargeDb({ orders: [fakeOrder()] });
    const service = serviceWithGates(fakeDb);

    await expect(
      service.createPendingOrder({
        ...validRechargeOrderInput,
        ...patch,
      }),
    ).rejects.toBeInstanceOf(RechargeOrderIdempotencyConflictError);
  });

  it('allows membership orders to bypass recharge gates while still requiring positive whole CNY', async () => {
    const fakeDb = new FakeRechargeDb();
    const service = new RechargeService(fakeDb.asDB(), {
      membership: {
        getActiveMembership: async () => {
          throw new Error('membership gate should not run for membership orders');
        },
      } as unknown as PartnerMembershipService,
      kyc: {
        getStatus: async () => {
          throw new Error('KYC gate should not run for membership orders');
        },
      } as unknown as KycService,
    });

    const row = await service.createPendingOrder({
      userId: 123,
      provider: 'wechat',
      amountCnyCents: 999_00,
      orderKind: 'membership',
      idempotencyKey: 'membership-idem-1',
    });

    expect(row).toMatchObject({
      userId: 123,
      amountCnyCents: 999_00,
      orderKind: 'membership',
      status: 'pending',
    });
    await expect(
      service.createPendingOrder({
        userId: 123,
        provider: 'wechat',
        amountCnyCents: 999_01,
        orderKind: 'membership',
        idempotencyKey: 'membership-idem-bad',
      }),
    ).rejects.toBeInstanceOf(RangeError);
  });
});

describe('RechargeService createLotForCapturedRecharge', () => {
  it('creates an accumulating lot with calculated caps, API units, and schedule dates', async () => {
    const fakeDb = new FakeRechargeDb();
    const service = new RechargeService(fakeDb.asDB());

    const row = await service.createLotForCapturedRecharge({
      userId: 123,
      rechargeOrderId: 77,
      amountCnyCents: 10_000_00,
      rollingThirtyDayCnyCents: 10_000_00,
      now: new Date('2026-07-01T03:04:05.006Z'),
    });

    expect(row).toMatchObject({
      userId: 123,
      rechargeOrderId: 77,
      principalCreditCents: 10_000_00,
      tierMultiplierBps: 10_500,
      apiUnits: 10_500_000,
      bonusCapCreditCents: 2_000_00,
      status: 'accumulating',
      riskStatus: 'normal',
      lockedBonusCreditCents: 0,
      releasedPrincipalCreditCents: 0,
      releasedBonusCreditCents: 0,
      carryForwardCreditCents: 0,
      metadata: null,
    });
    expect(row.externalId).toMatch(/^pay_/);
    expect(row.accumulationStartsAt.toISOString()).toBe('2026-07-01T03:04:05.006Z');
    expect(row.accumulationEndsAt.toISOString()).toBe('2026-10-29T03:04:05.006Z');
    expect(row.releaseStartsAt.toISOString()).toBe('2026-10-30T03:04:05.006Z');
    expect(row.releaseEndsAt.toISOString()).toBe('2027-06-30T03:04:05.006Z');
    expect(fakeDb.lotRowsCreated).toBe(1);
    expect(fakeDb.lotDuplicateKeyUpdateCalls).toBe(1);
    expect(fakeDb.wherePredicateTexts.some((predicateText) => predicateText.includes('recharge_order_id'))).toBe(
      true,
    );
  });

  it('rejects rollingThirtyDayCnyCents below the current amount', async () => {
    const fakeDb = new FakeRechargeDb();
    const service = new RechargeService(fakeDb.asDB());

    await expect(
      service.createLotForCapturedRecharge({
        userId: 123,
        rechargeOrderId: 77,
        amountCnyCents: 10_000_00,
        rollingThirtyDayCnyCents: 9_999_00,
        now: new Date('2026-07-01T03:04:05.006Z'),
      }),
    ).rejects.toThrow(/include the current recharge amount/);
    expect(fakeDb.lotInsertAttempts).toHaveLength(0);
  });

  it('rejects rollingThirtyDayCnyCents above the 30-day cap', async () => {
    const fakeDb = new FakeRechargeDb();
    const service = new RechargeService(fakeDb.asDB());

    await expect(
      service.createLotForCapturedRecharge({
        userId: 123,
        rechargeOrderId: 77,
        amountCnyCents: 200_000_00,
        rollingThirtyDayCnyCents: 500_001_00,
        now: new Date('2026-07-01T03:04:05.006Z'),
      }),
    ).rejects.toThrow(/monthly maximum/);
    expect(fakeDb.lotInsertAttempts).toHaveLength(0);
  });

  it('uses duplicate-key idempotency and returns an existing lot for the same recharge order and same payload', async () => {
    const existing = fakeLot();
    const fakeDb = new FakeRechargeDb({ lots: [existing] });
    const service = new RechargeService(fakeDb.asDB());

    const row = await service.createLotForCapturedRecharge({
      userId: 123,
      rechargeOrderId: 77,
      amountCnyCents: 10_000_00,
      rollingThirtyDayCnyCents: 10_000_00,
      now: new Date('2026-07-01T03:04:05.006Z'),
    });

    expect(row).toBe(existing);
    expect(fakeDb.lots).toHaveLength(1);
    expect(fakeDb.lotRowsCreated).toBe(0);
    expect(fakeDb.lotInsertAttempts).toHaveLength(1);
    expect(fakeDb.lotDuplicateKeyUpdateCalls).toBe(1);
  });

  it.each([
    ['different amount', { amountCnyCents: 11_000_00, rollingThirtyDayCnyCents: 11_000_00 }],
    ['different user', { userId: 456 }],
  ])('throws a conflict error for an existing recharge-order lot with a %s', async (_name, patch) => {
    const fakeDb = new FakeRechargeDb({ lots: [fakeLot()] });
    const service = new RechargeService(fakeDb.asDB());

    await expect(
      service.createLotForCapturedRecharge({
        userId: 123,
        rechargeOrderId: 77,
        amountCnyCents: 10_000_00,
        rollingThirtyDayCnyCents: 10_000_00,
        now: new Date('2026-07-01T03:04:05.006Z'),
        ...patch,
      }),
    ).rejects.toBeInstanceOf(RechargeLotConflictError);
  });
});
