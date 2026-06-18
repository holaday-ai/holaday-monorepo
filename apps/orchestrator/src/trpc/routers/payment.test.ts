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

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { applyAddonPackSpy, grantFirstMonthBonusSpy } = vi.hoisted(() => ({
  applyAddonPackSpy: vi.fn(async () => {}),
  grantFirstMonthBonusSpy: vi.fn(async () => {}),
}));

vi.mock('../../quota/quota-service.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../quota/quota-service.js')>();
  return {
    ...actual,
    QuotaService: vi.fn(() => ({
      applyAddonPack: applyAddonPackSpy,
      grantFirstMonthBonus: grantFirstMonthBonusSpy,
    })),
  };
});

import { paymentRouter } from './payment.js';

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
          const affected =
            tName === 'payments' && 'status' in setObj ? opts.gateAffected : 1;
          return Promise.resolve([{ affectedRows: affected }, null]);
        },
      };
    },
  });
  const db = {
    select() {
      return {
        from(table: unknown) {
          return {
            where() {
              return {
                limit() {
                  const tName = drizzleName(table);
                  if (tName === 'payments') return Promise.resolve([opts.orderRow]);
                  if (tName === 'users') return Promise.resolve([opts.userRow]);
                  return Promise.resolve([]);
                },
              };
            },
          };
        },
      };
    },
    update: makeUpdate(),
    async transaction(cb: (tx: unknown) => Promise<unknown>) {
      return cb({ update: makeUpdate() });
    },
  };
  const paypalAdapter = {
    env: 'sandbox',
    captureOrder: vi.fn(async () => ({
      captureId: 'cap_1',
      status: 'COMPLETED',
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
  providerOrderId: 'ord_addon',
  status: 'pending',
  kind: 'addon',
  plan: 'pack-20',
  metadata: {},
};
const proUser = { id: 42, plan: 'pro', planExpiresAt: null };

const subOrder = {
  id: 2,
  externalId: 'pay_sub',
  userExternalId: 'usr_test',
  providerOrderId: 'ord_sub',
  status: 'pending',
  kind: 'subscription',
  plan: 'pro',
  metadata: { firstMonth: true, cycle: 'monthly' },
};
const freeUser = { id: 42, plan: 'free', planExpiresAt: null };

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
    expect(
      updates.some((u) => u.table === 'users' && u.set.plan === 'pro'),
    ).toBe(true);
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
    expect(
      updates.some((u) => u.table === 'users' && u.set.plan === 'pro'),
    ).toBe(false);
    expect(grantFirstMonthBonusSpy).not.toHaveBeenCalled();
  });
});
