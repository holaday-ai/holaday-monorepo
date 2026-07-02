import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import type { DB } from '../db/client.js';
import {
  partnerRechargeOrders,
  type PartnerLot,
  type PartnerMembership,
  type PartnerRechargeOrder,
} from '../db/schema/partner.js';
import {
  PartnerPaymentConfirmService,
  partnerPaymentIdempotencyKey,
} from './payment-confirm-service.js';

class FakePartnerPaymentDb {
  readonly orders: PartnerRechargeOrder[];
  readonly wherePredicateTexts: string[] = [];
  readonly updatePredicateTexts: string[] = [];
  readonly updateValues: Array<Partial<PartnerRechargeOrder>> = [];
  transactionCalls = 0;
  updateRowsAffected: number[] = [];

  constructor(input: { orders?: PartnerRechargeOrder[] } = {}) {
    this.orders = [...(input.orders ?? [])];
  }

  asDB(): DB {
    return this as unknown as DB;
  }

  async transaction<T>(cb: (tx: DB) => Promise<T>): Promise<T> {
    this.transactionCalls += 1;
    return cb(this.asDB());
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
              onFulfilled?: ((value: PartnerRechargeOrder[]) => unknown) | null,
              onRejected?: ((reason: unknown) => unknown) | null,
            ) => Promise.resolve(this.selectRows(table, predicateText)).then(onFulfilled, onRejected),
          };
          return chain;
        },
      }),
    };
  }

  update(table: unknown) {
    return {
      set: (values: Partial<PartnerRechargeOrder>) => ({
        where: async (predicate: unknown) => {
          if (table !== partnerRechargeOrders) {
            throw new Error('unexpected update table');
          }
          const predicateText = inspect(predicate, { depth: 6, getters: true });
          this.updatePredicateTexts.push(predicateText);
          this.updateValues.push(values);

          const row = this.orders.find(
            (order) => predicateText.includes(order.externalId) && order.status === 'pending',
          );
          if (!row) {
            this.updateRowsAffected.push(0);
            return [{ affectedRows: 0 }, null];
          }

          Object.assign(row, values);
          this.updateRowsAffected.push(1);
          return [{ affectedRows: 1 }, null];
        },
      }),
    };
  }

  private selectRows(table: unknown, predicateText: string): PartnerRechargeOrder[] {
    if (table !== partnerRechargeOrders) return [];

    const externalId = this.orders
      .map((order) => order.externalId)
      .find((candidate) => predicateText.includes(candidate));
    if (externalId) {
      return this.orders.filter((order) => order.externalId === externalId);
    }

    const captureRow = this.orders.find(
      (order) =>
        order.providerCaptureId !== null &&
        predicateText.includes(order.provider) &&
        predicateText.includes(order.providerCaptureId),
    );
    if (captureRow) {
      return [captureRow];
    }

    if (predicateText.includes('user_id') && predicateText.includes('completed')) {
      return this.orders.filter(
        (order) =>
          predicateText.includes(String(order.userId)) &&
          order.status === 'completed' &&
          order.orderKind === 'recharge',
      );
    }

    return [];
  }
}

function fakeOrder(overrides: Partial<PartnerRechargeOrder> = {}): PartnerRechargeOrder {
  return {
    id: 1,
    externalId: 'pay_order_1',
    userId: 123,
    provider: 'wechat',
    providerOrderId: null,
    providerCaptureId: null,
    amountCnyCents: 10_000_00,
    status: 'pending',
    orderKind: 'recharge',
    idempotencyKey: 'order-idem-1',
    metadata: null,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-01T00:00:00.000Z'),
    ...overrides,
  };
}

function fakeMembership(overrides: Partial<PartnerMembership> = {}): PartnerMembership {
  return {
    id: 1,
    externalId: 'pay_membership_1',
    userId: 123,
    status: 'active',
    startsAt: new Date('2026-07-02T00:00:00.000Z'),
    expiresAt: new Date('2027-07-02T00:00:00.000Z'),
    sourcePaymentExternalId: 'pay_order_1',
    metadata: null,
    createdAt: new Date('2026-07-02T00:00:00.000Z'),
    updatedAt: new Date('2026-07-02T00:00:00.000Z'),
    ...overrides,
  };
}

function fakeLot(overrides: Partial<PartnerLot> = {}): PartnerLot {
  return {
    id: 1,
    externalId: 'pay_lot_1',
    userId: 123,
    rechargeOrderId: 1,
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
    accumulationStartsAt: new Date('2026-07-02T00:00:00.000Z'),
    accumulationEndsAt: new Date('2026-10-30T00:00:00.000Z'),
    releaseStartsAt: new Date('2026-10-31T00:00:00.000Z'),
    releaseEndsAt: new Date('2027-07-01T00:00:00.000Z'),
    metadata: null,
    createdAt: new Date('2026-07-02T00:00:00.000Z'),
    updatedAt: new Date('2026-07-02T00:00:00.000Z'),
    ...overrides,
  };
}

function serviceWithFakes(fakeDb: FakePartnerPaymentDb) {
  const membershipActivations: Array<{
    userId: number;
    sourcePaymentExternalId?: string;
    now?: Date;
  }> = [];
  const lotCreations: Array<{
    userId: number;
    rechargeOrderId: number;
    amountCnyCents: number;
    rollingThirtyDayCnyCents: number;
    now?: Date;
  }> = [];

  const service = new PartnerPaymentConfirmService(fakeDb.asDB(), {
    membershipService: () => ({
      activate: async (input) => {
        membershipActivations.push(input);
        return fakeMembership({
          userId: input.userId,
          sourcePaymentExternalId: input.sourcePaymentExternalId ?? null,
          startsAt: input.now ?? new Date('2026-07-02T00:00:00.000Z'),
        });
      },
    }),
    rechargeService: () => ({
      createLotForCapturedRecharge: async (input) => {
        lotCreations.push(input);
        return fakeLot({
          userId: input.userId,
          rechargeOrderId: input.rechargeOrderId,
          principalCreditCents: input.amountCnyCents,
        });
      },
    }),
  });

  return { service, membershipActivations, lotCreations };
}

const confirmInput = {
  orderExternalId: 'pay_order_1',
  provider: 'wechat',
  providerCaptureId: 'cap_1',
  amountCnyCents: 10_000_00,
  now: new Date('2026-07-02T00:00:00.000Z'),
};

describe('partnerPaymentIdempotencyKey', () => {
  it('builds a partner payment key from provider and capture id', () => {
    expect(partnerPaymentIdempotencyKey({ provider: 'wechat', providerCaptureId: 'cap_1' })).toBe(
      'partner-payment:wechat:cap_1',
    );
  });

  it.each([
    [{ provider: '', providerCaptureId: 'cap_1' }],
    [{ provider: '   ', providerCaptureId: 'cap_1' }],
    [{ provider: 'x'.repeat(25), providerCaptureId: 'cap_1' }],
    [{ provider: 'wechat', providerCaptureId: '' }],
    [{ provider: 'wechat', providerCaptureId: '   ' }],
    [{ provider: 'wechat', providerCaptureId: 'x'.repeat(129) }],
  ])('rejects invalid idempotency key input %o', (input) => {
    expect(() => partnerPaymentIdempotencyKey(input)).toThrow(RangeError);
  });
});

describe('PartnerPaymentConfirmService.confirmCapturedOrder', () => {
  it('treats a missing order as an idempotent no-op', async () => {
    const fakeDb = new FakePartnerPaymentDb();
    const { service, membershipActivations, lotCreations } = serviceWithFakes(fakeDb);

    await expect(service.confirmCapturedOrder(confirmInput)).resolves.toEqual({
      ok: true,
      status: 'unknown_order',
      orderExternalId: 'pay_order_1',
      deduped: true,
    });
    expect(fakeDb.updateRowsAffected).toEqual([]);
    expect(membershipActivations).toHaveLength(0);
    expect(lotCreations).toHaveLength(0);
  });

  it.each([
    ['provider mismatch', { provider: 'alipay' }, /provider mismatch/i],
    ['amount mismatch', { amountCnyCents: 11_000_00 }, /amount mismatch/i],
  ])('throws on %s without side effects', async (_name, patch, expectedMessage) => {
    const order = fakeOrder({ orderKind: 'membership' });
    const fakeDb = new FakePartnerPaymentDb({ orders: [order] });
    const { service, membershipActivations, lotCreations } = serviceWithFakes(fakeDb);

    await expect(service.confirmCapturedOrder({ ...confirmInput, ...patch })).rejects.toThrow(expectedMessage);
    expect(order.status).toBe('pending');
    expect(order.providerCaptureId).toBeNull();
    expect(fakeDb.updateRowsAffected).toEqual([]);
    expect(membershipActivations).toHaveLength(0);
    expect(lotCreations).toHaveLength(0);
  });

  it('completes a pending membership order and activates membership exactly once', async () => {
    const order = fakeOrder({ orderKind: 'membership', amountCnyCents: 999_00 });
    const fakeDb = new FakePartnerPaymentDb({ orders: [order] });
    const { service, membershipActivations, lotCreations } = serviceWithFakes(fakeDb);
    const input = { ...confirmInput, amountCnyCents: 999_00 };

    await expect(service.confirmCapturedOrder(input)).resolves.toEqual({
      ok: true,
      status: 'completed',
      orderExternalId: 'pay_order_1',
      orderKind: 'membership',
      deduped: false,
    });
    await expect(service.confirmCapturedOrder(input)).resolves.toEqual({
      ok: true,
      status: 'completed',
      orderExternalId: 'pay_order_1',
      orderKind: 'membership',
      deduped: true,
    });

    expect(order).toMatchObject({
      status: 'completed',
      providerCaptureId: 'cap_1',
      updatedAt: new Date('2026-07-02T00:00:00.000Z'),
    });
    expect(membershipActivations).toEqual([
      {
        userId: 123,
        sourcePaymentExternalId: 'pay_order_1',
        now: new Date('2026-07-02T00:00:00.000Z'),
      },
    ]);
    expect(lotCreations).toHaveLength(0);
  });

  it('completes a pending recharge order and creates one lot across retry', async () => {
    const order = fakeOrder({ orderKind: 'recharge' });
    const fakeDb = new FakePartnerPaymentDb({ orders: [order] });
    const { service, membershipActivations, lotCreations } = serviceWithFakes(fakeDb);

    await expect(service.confirmCapturedOrder(confirmInput)).resolves.toMatchObject({
      ok: true,
      status: 'completed',
      orderExternalId: 'pay_order_1',
      orderKind: 'recharge',
      deduped: false,
    });
    await expect(service.confirmCapturedOrder(confirmInput)).resolves.toMatchObject({
      ok: true,
      status: 'completed',
      orderExternalId: 'pay_order_1',
      orderKind: 'recharge',
      deduped: true,
    });

    expect(order.status).toBe('completed');
    expect(order.providerCaptureId).toBe('cap_1');
    expect(lotCreations).toEqual([
      {
        userId: 123,
        rechargeOrderId: 1,
        amountCnyCents: 10_000_00,
        rollingThirtyDayCnyCents: 10_000_00,
        now: new Date('2026-07-02T00:00:00.000Z'),
      },
    ]);
    expect(membershipActivations).toHaveLength(0);
  });

  it('does not process a capture id already attached to another partner order', async () => {
    const current = fakeOrder({ id: 1, externalId: 'pay_order_1', status: 'pending' });
    const other = fakeOrder({
      id: 2,
      externalId: 'pay_order_2',
      providerCaptureId: 'cap_1',
      status: 'completed',
      amountCnyCents: 20_000_00,
      updatedAt: new Date('2026-07-02T00:00:00.000Z'),
    });
    const fakeDb = new FakePartnerPaymentDb({ orders: [current, other] });
    const { service, lotCreations } = serviceWithFakes(fakeDb);

    await expect(service.confirmCapturedOrder(confirmInput)).rejects.toThrow(/provider capture.*another partner order/i);
    expect(current.status).toBe('pending');
    expect(current.providerCaptureId).toBeNull();
    expect(fakeDb.updateRowsAffected).toEqual([]);
    expect(lotCreations).toHaveLength(0);
  });

  it('includes prior completed recharge orders in the rolling 30-day amount', async () => {
    const current = fakeOrder({
      id: 1,
      externalId: 'pay_order_1',
      userId: 123,
      orderKind: 'recharge',
      amountCnyCents: 10_000_00,
      createdAt: new Date('2026-07-02T00:00:00.000Z'),
      updatedAt: new Date('2026-07-02T00:00:00.000Z'),
    });
    const priorInsideWindow = fakeOrder({
      id: 2,
      externalId: 'pay_order_2',
      userId: 123,
      providerCaptureId: 'cap_2',
      status: 'completed',
      amountCnyCents: 40_001_00,
      createdAt: new Date('2026-06-20T00:00:00.000Z'),
      updatedAt: new Date('2026-06-20T00:00:00.000Z'),
    });
    const priorOutsideWindow = fakeOrder({
      id: 3,
      externalId: 'pay_order_3',
      userId: 123,
      providerCaptureId: 'cap_3',
      status: 'completed',
      amountCnyCents: 200_000_00,
      createdAt: new Date('2026-05-01T00:00:00.000Z'),
      updatedAt: new Date('2026-05-01T00:00:00.000Z'),
    });
    const completedMembership = fakeOrder({
      id: 4,
      externalId: 'pay_order_4',
      userId: 123,
      providerCaptureId: 'cap_4',
      status: 'completed',
      orderKind: 'membership',
      amountCnyCents: 999_00,
      createdAt: new Date('2026-06-25T00:00:00.000Z'),
      updatedAt: new Date('2026-06-25T00:00:00.000Z'),
    });
    const fakeDb = new FakePartnerPaymentDb({
      orders: [current, priorInsideWindow, priorOutsideWindow, completedMembership],
    });
    const { service, lotCreations } = serviceWithFakes(fakeDb);

    await service.confirmCapturedOrder(confirmInput);

    expect(lotCreations[0]?.rollingThirtyDayCnyCents).toBe(50_001_00);
  });

  it('throws for an unknown order kind before applying side effects', async () => {
    const order = fakeOrder({ orderKind: 'bonus' });
    const fakeDb = new FakePartnerPaymentDb({ orders: [order] });
    const { service, membershipActivations, lotCreations } = serviceWithFakes(fakeDb);

    await expect(service.confirmCapturedOrder(confirmInput)).rejects.toThrow(/unknown partner order kind/i);
    expect(order.status).toBe('pending');
    expect(fakeDb.updateRowsAffected).toEqual([]);
    expect(membershipActivations).toHaveLength(0);
    expect(lotCreations).toHaveLength(0);
  });
});
