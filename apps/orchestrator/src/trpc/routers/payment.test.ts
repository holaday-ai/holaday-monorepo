/**
 * captureOrder — entitlement gating regression.
 *
 * The pending→completed transition is guarded by a conditional UPDATE
 * (`WHERE status='pending'`) whose affectedRows decides whether the
 * entitlement is applied. The drizzle/mysql2 result is an ARRAY
 * `[ResultSetHeader, fields]`; reading the top-level `.affectedRows`
 * (the old bug) returned `undefined`, so a real capture (affectedRows=1)
 * was read as 0 → the customer was charged but applyAddonPack / plan
 * upgrade / first-month bonus NEVER ran. These tests pin both the HIT
 * path (entitlement granted) and the retry/race path (no double-grant),
 * using the REAL array envelope the runtime returns.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { applyAddonPackSpy, grantFirstMonthBonusSpy } = vi.hoisted(() => ({
  applyAddonPackSpy: vi.fn(async () => {}),
  grantFirstMonthBonusSpy: vi.fn(async () => {}),
}));

vi.mock('../../quota/quota-service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../quota/quota-service.js')>();
  return {
    ...actual,
    QuotaService: vi.fn(() => ({
      applyAddonPack: applyAddonPackSpy,
      grantFirstMonthBonus: grantFirstMonthBonusSpy,
    })),
  };
});

import {
  CN_PAYMENT_CREATE_TIMEOUT_MS,
  CN_PAYMENT_HEALTH_TIMEOUT_MS,
  paymentRouter,
} from './payment.js';

const drizzleName = (t: unknown): string =>
  (t as Record<symbol, string> | null)?.[Symbol.for('drizzle:Name')] ?? '';

function makeCtx(opts: {
  orderRow: Record<string, unknown>;
  userRow: Record<string, unknown>;
  gateAffected: 0 | 1; // affectedRows the payments status-flip UPDATE reports
}) {
  const updates: Array<{ table: string; set: Record<string, unknown> }> = [];
  const makeUpdate = () => (table: unknown) => ({
    set(setObj: Record<string, unknown>) {
      return {
        where() {
          const tName = drizzleName(table);
          updates.push({ table: tName, set: setObj });
          // The payments status-flip is the guarded transition; every
          // other write (users.plan) is unconditional → affectedRows 1.
          // Returns the REAL mysql2/drizzle envelope [header, fields].
          const affected = tName === 'payments' && 'status' in setObj ? opts.gateAffected : 1;
          return Promise.resolve([{ affectedRows: affected }, null]);
        },
      };
    },
  });
  const db = {
    select() {
      return {
        from(table: unknown) {
          const tName = drizzleName(table);
          const rows =
            tName === 'payments' ? [opts.orderRow] : tName === 'users' ? [opts.userRow] : [];
          const query = {
            where() {
              return query;
            },
            limit() {
              return query;
            },
            for() {
              return query;
            },
            // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are awaitable.
            then<TResult1 = unknown, TResult2 = never>(
              onfulfilled?:
                | ((value: Record<string, unknown>[]) => TResult1 | PromiseLike<TResult1>)
                | null,
              onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
            ) {
              return Promise.resolve(rows).then(onfulfilled, onrejected);
            },
          };
          return query;
        },
      };
    },
    update: makeUpdate(),
    async transaction(cb: (tx: unknown) => Promise<unknown>) {
      return cb(db);
    },
  };
  const paypalAdapter = {
    env: 'sandbox',
    captureOrder: vi.fn(async () => ({
      captureId: 'cap_1',
      status: 'COMPLETED',
      amountCents: opts.orderRow.amountCents,
      currency: opts.orderRow.currency,
      payerEmail: 'payer@example.com',
    })),
  };
  const ctx = {
    db,
    userId: 'usr_test',
    paypalAdapter,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn(),
    },
  } as unknown as Parameters<typeof paymentRouter.createCaller>[0];
  return { ctx, updates };
}

const addonOrder = {
  id: 1,
  externalId: 'pay_addon',
  userExternalId: 'usr_test',
  provider: 'paypal',
  providerOrderId: 'ord_addon',
  status: 'pending',
  kind: 'addon',
  plan: 'pack-20',
  amountCents: 150,
  currency: 'USD',
  metadata: {},
};
const proUser = { id: 42, plan: 'pro', planExpiresAt: null, status: 'active' };

const subOrder = {
  id: 2,
  externalId: 'pay_sub',
  userExternalId: 'usr_test',
  provider: 'paypal',
  providerOrderId: 'ord_sub',
  status: 'pending',
  kind: 'subscription',
  plan: 'pro',
  amountCents: 690,
  currency: 'USD',
  metadata: { firstMonth: true, cycle: 'monthly' },
};
const freeUser = { id: 42, plan: 'free', planExpiresAt: null, status: 'active' };

describe('captureOrder — affectedRows-gated entitlement (regression)', () => {
  beforeEach(() => {
    applyAddonPackSpy.mockClear();
    grantFirstMonthBonusSpy.mockClear();
  });

  it('addon: capture flips the row (affectedRows=1) → applyAddonPack IS called', async () => {
    const { ctx } = makeCtx({
      orderRow: { ...addonOrder },
      userRow: proUser,
      gateAffected: 1,
    });
    const res = await paymentRouter
      .createCaller(ctx)
      .captureOrder({ paymentId: 'pay_addon', orderId: 'ord_addon' });
    expect(res).toEqual({ ok: true, plan: 'pack-20' });
    expect(applyAddonPackSpy).toHaveBeenCalledTimes(1);
    expect(applyAddonPackSpy).toHaveBeenCalledWith(42, 'pro', 'pack-20');
  });

  it('addon: concurrent flip (affectedRows=0) → applyAddonPack NOT called (no double-grant)', async () => {
    const { ctx } = makeCtx({
      orderRow: { ...addonOrder },
      userRow: proUser,
      gateAffected: 0,
    });
    const res = await paymentRouter
      .createCaller(ctx)
      .captureOrder({ paymentId: 'pay_addon', orderId: 'ord_addon' });
    expect(res).toEqual({ ok: true, plan: 'pack-20' });
    expect(applyAddonPackSpy).not.toHaveBeenCalled();
  });

  it('subscription: capture flips the row (affectedRows=1) → users.plan updated + first-month bonus granted', async () => {
    const { ctx, updates } = makeCtx({
      orderRow: { ...subOrder },
      userRow: freeUser,
      gateAffected: 1,
    });
    const res = await paymentRouter
      .createCaller(ctx)
      .captureOrder({ paymentId: 'pay_sub', orderId: 'ord_sub' });
    expect(res).toEqual({ ok: true, plan: 'pro' });
    expect(updates.some((u) => u.table === 'users' && u.set.plan === 'pro')).toBe(true);
    const paymentWrite = updates.find(
      (update) => update.table === 'payments' && update.set.status === 'completed',
    );
    expect(paymentWrite?.set.metadata).toEqual({
      firstMonth: true,
      cycle: 'monthly',
      payerEmail: 'payer@example.com',
      captureStatus: 'COMPLETED',
      firstMonthConsumed: true,
    });
    expect(grantFirstMonthBonusSpy).toHaveBeenCalledTimes(1);
    expect(grantFirstMonthBonusSpy).toHaveBeenCalledWith(42, 'pro');
  });

  it('subscription: concurrent flip (affectedRows=0) → plan NOT changed, bonus NOT granted', async () => {
    const { ctx, updates } = makeCtx({
      orderRow: { ...subOrder },
      userRow: freeUser,
      gateAffected: 0,
    });
    const res = await paymentRouter
      .createCaller(ctx)
      .captureOrder({ paymentId: 'pay_sub', orderId: 'ord_sub' });
    expect(res).toEqual({ ok: true, plan: 'pro' });
    expect(updates.some((u) => u.table === 'users' && u.set.plan === 'pro')).toBe(false);
    expect(grantFirstMonthBonusSpy).not.toHaveBeenCalled();
  });

  it('records a captured settlement but never restores entitlement for a closing account', async () => {
    const { ctx, updates } = makeCtx({
      orderRow: {
        ...subOrder,
        metadata: {
          cycle: 'monthly',
          payerEmail: 'private@example.test',
          approveUrl: 'https://provider.example/private',
          rawPayload: { secret: true },
        },
      },
      userRow: { ...freeUser, status: 'closure_processing' },
      gateAffected: 1,
    });

    await expect(
      paymentRouter.createCaller(ctx).captureOrder({ paymentId: 'pay_sub', orderId: 'ord_sub' }),
    ).resolves.toEqual({ ok: true, plan: 'pro' });

    const paymentWrite = updates.find(
      (update) => update.table === 'payments' && update.set.status === 'completed',
    );
    expect(paymentWrite?.set.metadata).toEqual({
      provider: 'paypal',
      cycle: 'monthly',
      providerStatus: 'COMPLETED',
      currency: 'USD',
      settledAt: expect.any(String),
    });
    expect(updates.some((update) => update.table === 'users' && update.set.plan === 'pro')).toBe(
      false,
    );
    expect(grantFirstMonthBonusSpy).not.toHaveBeenCalled();
  });
});

type MutablePayment = typeof subOrder & {
  amountCents?: number;
  currency?: string;
};

function makeStatefulCaptureCtx(opts: {
  orderRow: MutablePayment;
  userRow: typeof freeUser;
}) {
  const paymentState = { ...opts.orderRow };
  const userState = { ...opts.userRow };

  const makeDb = () => {
    const db = {
      select() {
        return {
          from(table: unknown) {
            const rows =
              drizzleName(table) === 'payments'
                ? [{ ...paymentState }]
                : drizzleName(table) === 'users'
                  ? [{ ...userState }]
                  : [];
            const query = {
              where() {
                return query;
              },
              limit() {
                return query;
              },
              for() {
                return query;
              },
              // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are awaitable.
              then<TResult1 = unknown, TResult2 = never>(
                onfulfilled?:
                  | ((value: Record<string, unknown>[]) => TResult1 | PromiseLike<TResult1>)
                  | null,
                onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
              ) {
                return Promise.resolve(rows).then(onfulfilled, onrejected);
              },
            };
            return query;
          },
        };
      },
      update(table: unknown) {
        return {
          set(values: Record<string, unknown>) {
            return {
              where() {
                if (drizzleName(table) === 'payments') Object.assign(paymentState, values);
                if (drizzleName(table) === 'users') Object.assign(userState, values);
                return Promise.resolve([{ affectedRows: 1 }, null]);
              },
            };
          },
        };
      },
      async transaction<T>(callback: (tx: unknown) => Promise<T>): Promise<T> {
        const paymentBefore = { ...paymentState };
        const userBefore = { ...userState };
        try {
          return await callback(db);
        } catch (error) {
          Object.assign(paymentState, paymentBefore);
          Object.assign(userState, userBefore);
          throw error;
        }
      },
    };
    return db;
  };

  const paypalAdapter = {
    env: 'sandbox',
    createOrder: vi.fn(),
    captureOrder: vi.fn(async () => ({
      captureId: 'cap_stateful',
      status: 'COMPLETED',
      amountCents: opts.orderRow.amountCents ?? 690,
      currency: opts.orderRow.currency ?? 'USD',
      payerEmail: 'payer@example.com',
    })),
  };
  const ctx = {
    db: makeDb(),
    userId: 'usr_test',
    paypalAdapter,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn(),
    },
  } as unknown as Parameters<typeof paymentRouter.createCaller>[0];
  return { ctx, paymentState, userState, paypalAdapter };
}

function makeCreateCtx(opts: {
  userRow?: Record<string, unknown>;
  existingPayments?: Record<string, unknown>[];
}) {
  const inserted: Record<string, unknown>[] = [];
  const existingPayments = opts.existingPayments ?? [];
  const userRow = opts.userRow ?? {
    id: 42,
    externalId: 'usr_test',
    plan: 'free',
    planExpiresAt: null,
  };
  const db = {
    select() {
      return {
        from(table: unknown) {
          const rows =
            drizzleName(table) === 'users'
              ? [userRow]
              : drizzleName(table) === 'payments'
                ? existingPayments
                : [];
          const query = {
            where() {
              return query;
            },
            limit() {
              return query;
            },
            for() {
              return query;
            },
            // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are awaitable.
            then<TResult1 = unknown, TResult2 = never>(
              onfulfilled?:
                | ((value: Record<string, unknown>[]) => TResult1 | PromiseLike<TResult1>)
                | null,
              onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
            ) {
              return Promise.resolve(rows).then(onfulfilled, onrejected);
            },
          };
          return query;
        },
      };
    },
    insert() {
      return {
        values(value: Record<string, unknown>) {
          inserted.push(value);
          return Promise.resolve();
        },
      };
    },
    async transaction<T>(callback: (tx: unknown) => Promise<T>): Promise<T> {
      return callback(db);
    },
  };
  const paypalAdapter = {
    env: 'sandbox',
    createOrder: vi.fn(async () => ({
      orderId: 'ord_new',
      approveUrl: 'https://paypal.test/ord_new',
    })),
    captureOrder: vi.fn(),
  };
  const ctx = {
    db,
    userId: 'usr_test',
    paypalAdapter,
    req: {
      protocol: 'https',
      get: vi.fn(() => 'holaday.test'),
    },
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn(),
    },
  } as unknown as Parameters<typeof paymentRouter.createCaller>[0];
  return { ctx, inserted, paypalAdapter };
}

describe('first-month checkout serialization', () => {
  beforeEach(() => {
    applyAddonPackSpy.mockReset().mockResolvedValue(undefined);
    grantFirstMonthBonusSpy.mockReset().mockResolvedValue(undefined);
  });

  it('reuses an existing pending PayPal first-month checkout instead of pre-creating another', async () => {
    const existing = {
      id: 9,
      externalId: 'pay_existing',
      userExternalId: 'usr_test',
      provider: 'paypal',
      providerOrderId: 'ord_existing',
      status: 'pending',
      kind: 'subscription',
      plan: 'pro',
      amountCents: 690,
      metadata: {
        firstMonth: true,
        cycle: 'monthly',
        approveUrl: 'https://paypal.test/ord_existing',
      },
    };
    const { ctx, inserted, paypalAdapter } = makeCreateCtx({
      existingPayments: [existing],
    });

    await expect(
      paymentRouter.createCaller(ctx).createOrder({ plan: 'pro', cycle: 'monthly' }),
    ).resolves.toEqual({
      paymentId: 'pay_existing',
      orderId: 'ord_existing',
      approveUrl: 'https://paypal.test/ord_existing',
    });
    expect(paypalAdapter.createOrder).not.toHaveBeenCalled();
    expect(inserted).toHaveLength(0);
  });

  it('never stamps a yearly order as a first-month promotion', async () => {
    const { ctx, inserted } = makeCreateCtx({});

    await paymentRouter.createCaller(ctx).createOrder({ plan: 'pro', cycle: 'yearly' });

    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.metadata).toMatchObject({ cycle: 'yearly', firstMonth: false });
  });
});

describe('CN first-month checkout reservation', () => {
  beforeEach(() => {
    vi.stubEnv('CN_PAYMENT_URL', 'https://cn-pay.test');
    vi.stubEnv('INTERNAL_SHARED_SECRET', 'cn-secret');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('persists a CN first-month checkout as pending before returning it', async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            provider: 'wechat',
            outTradeNo: 'pay_cn_new',
            codeUrl: 'weixin://wxpay/new',
            amountCents: 4900,
            description: 'HOLA DAY 专业版（月付）',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const { ctx, inserted } = makeCreateCtx({});

    const result = await paymentRouter.createCaller(ctx).createCnOrder({
      provider: 'wechat',
      purchase: { kind: 'subscription', planId: 'pro', cycle: 'monthly' },
    });

    expect(result).toMatchObject({
      provider: 'wechat',
      outTradeNo: 'pay_cn_new',
      codeUrl: 'weixin://wxpay/new',
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://cn-pay.test/payment/create',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      userExternalId: 'usr_test',
      provider: 'wechat',
      providerOrderId: 'pay_cn_new',
      plan: 'pro',
      kind: 'subscription',
      amountCents: 4900,
      currency: 'CNY',
      status: 'pending',
      metadata: {
        cycle: 'monthly',
        firstMonth: true,
      },
    });
  });

  it('reuses an existing pending CN first-month checkout without calling the gateway again', async () => {
    const checkout = {
      provider: 'wechat',
      outTradeNo: 'pay_cn_existing',
      codeUrl: 'weixin://wxpay/existing',
      amountCents: 4900,
      description: 'HOLA DAY 专业版（月付）',
    };
    const fetchSpy = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            provider: 'wechat',
            outTradeNo: 'pay_cn_duplicate',
            codeUrl: 'weixin://wxpay/duplicate',
            amountCents: 4900,
            description: 'duplicate',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const { ctx, inserted } = makeCreateCtx({
      existingPayments: [
        {
          id: 10,
          externalId: 'pay_local_existing',
          userExternalId: 'usr_test',
          provider: 'wechat',
          providerOrderId: 'pay_cn_existing',
          status: 'pending',
          kind: 'subscription',
          plan: 'pro',
          amountCents: 4900,
          metadata: {
            firstMonth: true,
            cycle: 'monthly',
            checkout,
          },
        },
      ],
    });

    await expect(
      paymentRouter.createCaller(ctx).createCnOrder({
        provider: 'wechat',
        purchase: { kind: 'subscription', planId: 'pro', cycle: 'monthly' },
      }),
    ).resolves.toEqual(checkout);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(inserted).toHaveLength(0);
  });

  it('does not expose gateway diagnostics to the checkout UI', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('private provider diagnostic', { status: 503 })),
    );
    const { ctx } = makeCreateCtx({});

    await expect(
      paymentRouter.createCaller(ctx).createCnOrder({
        provider: 'wechat',
        purchase: { kind: 'subscription', planId: 'pro', cycle: 'monthly' },
      }),
    ).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: '支付服务暂时不可用，请稍后重试',
    });
  });
});

describe('captureOrder — settlement-time eligibility and atomic entitlements', () => {
  beforeEach(() => {
    applyAddonPackSpy.mockReset().mockResolvedValue(undefined);
    grantFirstMonthBonusSpy.mockReset().mockResolvedValue(undefined);
  });

  it('rejects a stale first-month order before asking PayPal to capture it', async () => {
    const { ctx, paymentState, paypalAdapter } = makeStatefulCaptureCtx({
      orderRow: { ...subOrder, amountCents: 690 },
      userRow: { ...freeUser, plan: 'pro' },
    });

    await expect(
      paymentRouter.createCaller(ctx).captureOrder({ paymentId: 'pay_sub', orderId: 'ord_sub' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(paypalAdapter.captureOrder).not.toHaveBeenCalled();
    expect(paymentState.status).toBe('pending');
  });

  it('rolls back subscription completion and plan upgrade when first-month quota grant fails', async () => {
    grantFirstMonthBonusSpy.mockRejectedValueOnce(new Error('quota unavailable'));
    const { ctx, paymentState, userState } = makeStatefulCaptureCtx({
      orderRow: { ...subOrder, amountCents: 690 },
      userRow: { ...freeUser },
    });

    await expect(
      paymentRouter.createCaller(ctx).captureOrder({ paymentId: 'pay_sub', orderId: 'ord_sub' }),
    ).rejects.toThrow('quota unavailable');
    expect(paymentState.status).toBe('pending');
    expect(userState.plan).toBe('free');
  });

  it('rolls back addon completion when quota application fails', async () => {
    applyAddonPackSpy.mockRejectedValueOnce(new Error('quota unavailable'));
    const { ctx, paymentState } = makeStatefulCaptureCtx({
      orderRow: {
        ...addonOrder,
        plan: 'pack-20',
        amountCents: 150,
      } as MutablePayment,
      userRow: { ...freeUser, plan: 'pro' },
    });

    await expect(
      paymentRouter
        .createCaller(ctx)
        .captureOrder({ paymentId: 'pay_addon', orderId: 'ord_addon' }),
    ).rejects.toThrow('quota unavailable');
    expect(paymentState.status).toBe('pending');
  });

  it('rejects a completed capture whose amount does not match the stored order', async () => {
    const { ctx, paymentState, paypalAdapter } = makeStatefulCaptureCtx({
      orderRow: { ...subOrder },
      userRow: { ...freeUser },
    });
    paypalAdapter.captureOrder.mockResolvedValueOnce({
      captureId: 'cap_wrong_amount',
      status: 'COMPLETED',
      amountCents: 1,
      currency: 'USD',
      payerEmail: 'payer@example.com',
    });

    await expect(
      paymentRouter.createCaller(ctx).captureOrder({ paymentId: 'pay_sub', orderId: 'ord_sub' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(paymentState.status).toBe('pending');
    expect(grantFirstMonthBonusSpy).not.toHaveBeenCalled();
  });

  it('rejects a completed capture whose currency does not match the stored order', async () => {
    const { ctx, paymentState, paypalAdapter } = makeStatefulCaptureCtx({
      orderRow: { ...subOrder },
      userRow: { ...freeUser },
    });
    paypalAdapter.captureOrder.mockResolvedValueOnce({
      captureId: 'cap_wrong_currency',
      status: 'COMPLETED',
      amountCents: 690,
      currency: 'CNY',
      payerEmail: 'payer@example.com',
    });

    await expect(
      paymentRouter.createCaller(ctx).captureOrder({ paymentId: 'pay_sub', orderId: 'ord_sub' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(paymentState.status).toBe('pending');
    expect(grantFirstMonthBonusSpy).not.toHaveBeenCalled();
  });
});

describe('cnStatus — tenant isolation', () => {
  it('does not reveal another user payment status', async () => {
    const db = {
      select() {
        return {
          from() {
            const query = {
              where() {
                return query;
              },
              limit() {
                return query;
              },
              // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are awaitable.
              then<TResult1 = unknown, TResult2 = never>(
                onfulfilled?:
                  | ((value: Record<string, unknown>[]) => TResult1 | PromiseLike<TResult1>)
                  | null,
                onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
              ) {
                return Promise.resolve([
                  {
                    status: 'completed',
                    plan: 'pro',
                    kind: 'subscription',
                    userExternalId: 'usr_other',
                  },
                ]).then(onfulfilled, onrejected);
              },
            };
            return query;
          },
        };
      },
    };
    const ctx = {
      db,
      userId: 'usr_test',
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        child: vi.fn(),
      },
    } as unknown as Parameters<typeof paymentRouter.createCaller>[0];

    await expect(
      paymentRouter.createCaller(ctx).cnStatus({ outTradeNo: 'pay_cn_other' }),
    ).resolves.toEqual({ status: 'pending' });
  });
});

describe('history — safe customer payment records', () => {
  it('returns only the current user records without gateway secrets', async () => {
    let selectedFields: Record<string, unknown> | undefined;
    let requestedLimit: number | undefined;
    const db = {
      select(fields: Record<string, unknown>) {
        selectedFields = fields;
        return {
          from() {
            const query = {
              where() {
                return query;
              },
              orderBy() {
                return query;
              },
              limit(value: number) {
                requestedLimit = value;
                return Promise.resolve([
                  {
                    externalId: 'pay_own',
                    userExternalId: 'usr_test',
                    provider: 'wechat',
                    kind: 'subscription',
                    plan: 'basic',
                    amountCents: 2900,
                    currency: 'CNY',
                    status: 'completed',
                    createdAt: new Date('2026-08-04T15:14:34.852Z'),
                    completedAt: new Date('2026-08-04T15:14:56.168Z'),
                  },
                  {
                    externalId: 'pay_other',
                    userExternalId: 'usr_other',
                    provider: 'alipay',
                    kind: 'addon',
                    plan: 'pack-20',
                    amountCents: 990,
                    currency: 'CNY',
                    status: 'completed',
                    createdAt: new Date('2026-08-04T16:00:00.000Z'),
                    completedAt: new Date('2026-08-04T16:00:10.000Z'),
                  },
                ]);
              },
            };
            return query;
          },
        };
      },
    };
    const ctx = {
      db,
      userId: 'usr_test',
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        child: vi.fn(),
      },
    } as unknown as Parameters<typeof paymentRouter.createCaller>[0];

    await expect(paymentRouter.createCaller(ctx).history()).resolves.toEqual([
      {
        orderId: 'pay_own',
        provider: 'wechat',
        kind: 'subscription',
        plan: 'basic',
        amountCents: 2900,
        currency: 'CNY',
        status: 'completed',
        createdAt: '2026-08-04T15:14:34.852Z',
        completedAt: '2026-08-04T15:14:56.168Z',
      },
    ]);
    expect(requestedLimit).toBe(20);
    expect(Object.keys(selectedFields ?? {}).sort()).toEqual(
      [
        'amountCents',
        'completedAt',
        'createdAt',
        'currency',
        'externalId',
        'kind',
        'plan',
        'provider',
        'status',
        'userExternalId',
      ].sort(),
    );
    expect(selectedFields).not.toHaveProperty('metadata');
    expect(selectedFields).not.toHaveProperty('providerCaptureId');
    expect(selectedFields).not.toHaveProperty('providerOrderId');
  });
});

describe('ledger — paginated customer payment records', () => {
  const ledgerRows = [
    {
      externalId: 'pay_completed',
      userExternalId: 'usr_test',
      provider: 'wechat',
      kind: 'subscription',
      plan: 'basic',
      amountCents: 2900,
      currency: 'CNY',
      status: 'completed',
      createdAt: new Date('2026-08-04T15:00:00.000Z'),
      completedAt: new Date('2026-08-04T15:00:10.000Z'),
    },
    {
      externalId: 'pay_refunded',
      userExternalId: 'usr_test',
      provider: 'alipay',
      kind: 'addon',
      plan: 'pack-20',
      amountCents: 990,
      currency: 'CNY',
      status: 'refunded',
      createdAt: new Date('2026-08-04T14:00:00.000Z'),
      completedAt: new Date('2026-08-04T14:00:10.000Z'),
    },
    {
      externalId: 'pay_completed_older',
      userExternalId: 'usr_test',
      provider: 'paypal',
      kind: 'subscription',
      plan: 'pro',
      amountCents: 690,
      currency: 'USD',
      status: 'completed',
      createdAt: new Date('2026-08-04T13:00:00.000Z'),
      completedAt: new Date('2026-08-04T13:00:10.000Z'),
    },
    {
      externalId: 'pay_pending',
      userExternalId: 'usr_test',
      provider: 'wechat',
      kind: 'subscription',
      plan: 'pro',
      amountCents: 6900,
      currency: 'CNY',
      status: 'pending',
      createdAt: new Date('2026-08-04T12:00:00.000Z'),
      completedAt: null,
    },
    {
      externalId: 'pay_failed',
      userExternalId: 'usr_test',
      provider: 'alipay',
      kind: 'subscription',
      plan: 'basic',
      amountCents: 2900,
      currency: 'CNY',
      status: 'failed',
      createdAt: new Date('2026-08-04T11:00:00.000Z'),
      completedAt: null,
    },
    {
      externalId: 'pay_other',
      userExternalId: 'usr_other',
      provider: 'paypal',
      kind: 'subscription',
      plan: 'pro',
      amountCents: 690,
      currency: 'USD',
      status: 'completed',
      createdAt: new Date('2026-08-04T10:00:00.000Z'),
      completedAt: new Date('2026-08-04T10:00:10.000Z'),
    },
  ];

  function makeLedgerCtx(rows = ledgerRows) {
    let selectedFields: Record<string, unknown> | undefined;
    let requestedLimit: number | undefined;
    let selectCalls = 0;
    const db = {
      select(fields: Record<string, unknown>) {
        selectCalls += 1;
        selectedFields = fields;
        return {
          from() {
            const query = {
              where() {
                return query;
              },
              orderBy() {
                return query;
              },
              limit(value: number) {
                requestedLimit = value;
                return Promise.resolve(rows);
              },
            };
            return query;
          },
        };
      },
    };
    const ctx = {
      db,
      userId: 'usr_test',
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        child: vi.fn(),
      },
    } as unknown as Parameters<typeof paymentRouter.createCaller>[0];
    return {
      ctx,
      selectedFields: () => selectedFields,
      requestedLimit: () => requestedLimit,
      selectCalls: () => selectCalls,
    };
  }

  it('separates settled records, paginates them, and returns only safe fields', async () => {
    const mock = makeLedgerCtx();
    const settled = await paymentRouter
      .createCaller(mock.ctx)
      .ledger({ section: 'settled', limit: 2 });

    expect(settled.items.map((row) => row.orderId)).toEqual(['pay_completed', 'pay_refunded']);
    expect(settled.nextCursor).toEqual({
      createdAt: '2026-08-04T14:00:00.000Z',
      orderId: 'pay_refunded',
    });
    expect(mock.requestedLimit()).toBe(3);
    expect(Object.keys(mock.selectedFields() ?? {}).sort()).toEqual(
      [
        'amountCents',
        'completedAt',
        'createdAt',
        'currency',
        'externalId',
        'kind',
        'plan',
        'provider',
        'status',
        'userExternalId',
      ].sort(),
    );
    expect(settled.items[0]).not.toHaveProperty('metadata');
    expect(settled.items[0]).not.toHaveProperty('userExternalId');
    expect(settled.items[0]).not.toHaveProperty('providerOrderId');
    expect(settled.items[0]).not.toHaveProperty('providerCaptureId');
  });

  it('keeps unfinished attempts separate and excludes another account', async () => {
    const mock = makeLedgerCtx();
    const unfinished = await paymentRouter.createCaller(mock.ctx).ledger({ section: 'unfinished' });

    expect(unfinished.items.map((row) => [row.orderId, row.status])).toEqual([
      ['pay_pending', 'pending'],
      ['pay_failed', 'failed'],
    ]);
    expect(unfinished.items.some((row) => row.orderId === 'pay_other')).toBe(false);
    expect(unfinished.nextCursor).toBeNull();
    expect(mock.requestedLimit()).toBe(11);
  });

  it('accepts a bounded keyset cursor and rejects malformed inputs before querying', async () => {
    const mock = makeLedgerCtx([]);
    const caller = paymentRouter.createCaller(mock.ctx);

    await expect(
      caller.ledger({
        section: 'settled',
        cursor: {
          createdAt: '2026-08-04T14:00:00.000Z',
          orderId: 'pay_refunded',
        },
      }),
    ).resolves.toEqual({ items: [], nextCursor: null });
    expect(mock.selectCalls()).toBe(1);

    await expect(caller.ledger({ section: 'settled', limit: 21 })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    await expect(
      caller.ledger({
        section: 'settled',
        cursor: { createdAt: 'not-a-date', orderId: '../other' },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(mock.selectCalls()).toBe(1);
  });
});

describe('cnOptions — production provider readiness', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('fails closed when the gateway is not configured', async () => {
    vi.stubEnv('CN_PAYMENT_URL', '');
    vi.stubEnv('INTERNAL_SHARED_SECRET', '');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await expect(
      paymentRouter
        .createCaller({} as Parameters<typeof paymentRouter.createCaller>[0])
        .cnOptions(),
    ).resolves.toEqual({ enabled: false, wechat: false, alipay: false });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('allows the cross-region readiness probe the order-creation timeout budget', () => {
    expect(CN_PAYMENT_HEALTH_TIMEOUT_MS).toBe(8_000);
    expect(CN_PAYMENT_CREATE_TIMEOUT_MS).toBeGreaterThan(10_000);
  });

  it('returns readiness for each provider from the live gateway health response', async () => {
    vi.stubEnv('CN_PAYMENT_URL', 'https://hd-pay.orangebench.tech/');
    vi.stubEnv('INTERNAL_SHARED_SECRET', 'configured');
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        status: 'ok',
        providers: { wechat: 'ready', alipay: 'unconfigured: missing credentials' },
        bridge: 'ready',
      }),
    }));
    vi.stubGlobal('fetch', fetchSpy);

    await expect(
      paymentRouter
        .createCaller({} as Parameters<typeof paymentRouter.createCaller>[0])
        .cnOptions(),
    ).resolves.toEqual({ enabled: true, wechat: true, alipay: false });
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://hd-pay.orangebench.tech/healthz',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('does not advertise payment providers when the settlement bridge is unavailable', async () => {
    vi.stubEnv('CN_PAYMENT_URL', 'https://hd-pay.orangebench.tech');
    vi.stubEnv('INTERNAL_SHARED_SECRET', 'configured');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          status: 'ok',
          providers: { wechat: 'ready', alipay: 'ready' },
          bridge: 'unavailable: Vultr health rejected',
        }),
      })),
    );

    await expect(
      paymentRouter
        .createCaller({} as Parameters<typeof paymentRouter.createCaller>[0])
        .cnOptions(),
    ).resolves.toEqual({ enabled: false, wechat: false, alipay: false });
  });

  it('fails closed when the gateway health request fails', async () => {
    vi.stubEnv('CN_PAYMENT_URL', 'https://hd-pay.orangebench.tech');
    vi.stubEnv('INTERNAL_SHARED_SECRET', 'configured');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new Error('offline'))),
    );

    await expect(
      paymentRouter
        .createCaller({} as Parameters<typeof paymentRouter.createCaller>[0])
        .cnOptions(),
    ).resolves.toEqual({ enabled: false, wechat: false, alipay: false });
  });
});
