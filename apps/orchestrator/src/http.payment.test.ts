import { type Server, createServer } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { applyAddonPackSpy, fakeDb, grantFirstMonthBonusSpy, paymentRows, userState } = vi.hoisted(
  () => {
    const applyAddonPackSpy = vi.fn(async () => {});
    const grantFirstMonthBonusSpy = vi.fn(async () => {});
    const paymentRows: Array<Record<string, unknown>> = [];
    const userState = {
      id: 42,
      externalId: 'usr_cn_test',
      plan: 'free',
      planExpiresAt: null as Date | null,
    };

    const drizzleName = (table: unknown): string =>
      (table as Record<symbol, string> | null)?.[Symbol.for('drizzle:Name')] ?? '';

    function queryFor(rows: Array<Record<string, unknown>>) {
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
            | ((value: Array<Record<string, unknown>>) => TResult1 | PromiseLike<TResult1>)
            | null,
          onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
        ) {
          return Promise.resolve(rows).then(onfulfilled, onrejected);
        },
      };
      return query;
    }

    const fakeDb = {
      select() {
        return {
          from(table: unknown) {
            if (drizzleName(table) === 'users') return queryFor([{ ...userState }]);
            if (drizzleName(table) === 'payments') {
              return queryFor(paymentRows.map((row) => ({ ...row })));
            }
            return queryFor([]);
          },
        };
      },
      insert(table: unknown) {
        return {
          values(value: Record<string, unknown>) {
            const execute = () => {
              if (drizzleName(table) !== 'payments') return;
              const duplicate = paymentRows.some(
                (row) =>
                  row.provider === value.provider &&
                  row.providerCaptureId === value.providerCaptureId,
              );
              if (!duplicate) paymentRows.push({ id: paymentRows.length + 1, ...value });
            };
            return {
              onDuplicateKeyUpdate() {
                execute();
                return Promise.resolve([{ affectedRows: 1 }, null]);
              },
              // biome-ignore lint/suspicious/noThenProperty: Drizzle insert builders are awaitable.
              then<TResult1 = unknown, TResult2 = never>(
                onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
                onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
              ) {
                execute();
                return Promise.resolve([{ affectedRows: 1 }, null]).then(onfulfilled, onrejected);
              },
            };
          },
        };
      },
      update(table: unknown) {
        return {
          set(values: Record<string, unknown>) {
            return {
              where() {
                if (drizzleName(table) === 'users') Object.assign(userState, values);
                if (drizzleName(table) === 'payments' && paymentRows[0]) {
                  Object.assign(paymentRows[0], values);
                }
                return Promise.resolve([{ affectedRows: 1 }, null]);
              },
            };
          },
        };
      },
      async transaction<T>(callback: (tx: unknown) => Promise<T>): Promise<T> {
        const paymentsBefore = paymentRows.map((row) => ({ ...row }));
        const userBefore = { ...userState };
        try {
          return await callback(fakeDb);
        } catch (error) {
          paymentRows.splice(0, paymentRows.length, ...paymentsBefore);
          Object.assign(userState, userBefore);
          throw error;
        }
      },
    };

    return {
      applyAddonPackSpy,
      fakeDb,
      grantFirstMonthBonusSpy,
      paymentRows,
      userState,
    };
  },
);

vi.mock('./db/client.js', () => ({
  db: fakeDb,
}));

vi.mock('./quota/quota-service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./quota/quota-service.js')>();
  return {
    ...actual,
    QuotaService: vi.fn(() => ({
      applyAddonPack: applyAddonPackSpy,
      grantFirstMonthBonus: grantFirstMonthBonusSpy,
    })),
  };
});

import { createHttpApp } from './http.js';

let server: Server | null = null;

async function postInternalConfirm(body: Record<string, unknown>) {
  const app = createHttpApp({ planner: {} as never });
  const activeServer = createServer(app);
  server = activeServer;
  await new Promise<void>((resolve) => activeServer.listen(0, '127.0.0.1', resolve));
  const address = activeServer.address();
  if (!address || typeof address === 'string') throw new Error('server has no TCP address');
  return fetch(`http://127.0.0.1:${address.port}/internal/payment/confirm`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-internal-secret': 'test-payment-secret',
    },
    body: JSON.stringify(body),
  });
}

async function postPaypalWebhook(
  body: Record<string, unknown>,
  paypalAdapter: {
    verifyWebhookSignature: ReturnType<typeof vi.fn>;
  },
) {
  const app = createHttpApp({
    planner: {} as never,
    paypalAdapter: paypalAdapter as never,
  });
  const activeServer = createServer(app);
  server = activeServer;
  await new Promise<void>((resolve) => activeServer.listen(0, '127.0.0.1', resolve));
  const address = activeServer.address();
  if (!address || typeof address === 'string') throw new Error('server has no TCP address');
  return fetch(`http://127.0.0.1:${address.port}/payment/paypal/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const firstMonthConfirm = {
  userId: 'usr_cn_test',
  planId: 'pro',
  cycle: 'monthly',
  provider: 'wechat',
  outTradeNo: 'pay_cn_first',
  transactionId: 'wx_txn_first',
  amountCents: 4900,
  kind: 'subscription',
  isFirstMonth: true,
};

function seedPendingPaypalPayment() {
  paymentRows.push({
    id: 1,
    externalId: 'pay_paypal_test',
    userExternalId: 'usr_cn_test',
    provider: 'paypal',
    providerOrderId: 'ORDER-123',
    providerCaptureId: null,
    status: 'pending',
    kind: 'subscription',
    plan: 'pro',
    amountCents: 4900,
    currency: 'USD',
    metadata: { cycle: 'monthly', firstMonth: false },
  });
}

describe('internal payment confirmation', () => {
  beforeEach(() => {
    process.env.INTERNAL_SHARED_SECRET = 'test-payment-secret';
    paymentRows.length = 0;
    Object.assign(userState, {
      id: 42,
      externalId: 'usr_cn_test',
      plan: 'free',
      planExpiresAt: null,
    });
    applyAddonPackSpy.mockReset().mockResolvedValue(undefined);
    grantFirstMonthBonusSpy.mockReset().mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      if (!server) return resolve();
      server.close((error) => (error ? reject(error) : resolve()));
    });
    server = null;
  });

  it('consumes a verified CN first-month flag and grants the promised bonus', async () => {
    const response = await postInternalConfirm(firstMonthConfirm);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, deduped: false });
    expect(userState.plan).toBe('pro');
    expect(paymentRows).toHaveLength(1);
    expect(paymentRows[0]?.status).toBe('completed');
    expect(grantFirstMonthBonusSpy).toHaveBeenCalledWith(42, 'pro');
  });

  it('does not persist completed or upgrade the user when the CN bonus grant fails', async () => {
    grantFirstMonthBonusSpy.mockRejectedValueOnce(new Error('quota unavailable'));

    const response = await postInternalConfirm(firstMonthConfirm);

    expect(response.status).toBe(500);
    expect(paymentRows.some((row) => row.status === 'completed')).toBe(false);
    expect(userState.plan).toBe('free');
  });
});

describe('PayPal webhook verification', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production');
    paymentRows.length = 0;
    Object.assign(userState, {
      id: 42,
      externalId: 'usr_cn_test',
      plan: 'free',
      planExpiresAt: null,
    });
    grantFirstMonthBonusSpy.mockReset().mockResolvedValue(undefined);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await new Promise<void>((resolve, reject) => {
      if (!server) return resolve();
      server.close((error) => (error ? reject(error) : resolve()));
    });
    server = null;
  });

  it('fails closed in production when PAYPAL_WEBHOOK_ID is missing', async () => {
    delete process.env.PAYPAL_WEBHOOK_ID;
    const verifyWebhookSignature = vi.fn(async () => true);

    const response = await postPaypalWebhook(
      { event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: {} },
      { verifyWebhookSignature },
    );

    expect(response.status).toBe(503);
    expect(verifyWebhookSignature).not.toHaveBeenCalled();
  });

  it('does not grant entitlements when a signed capture amount mismatches the order', async () => {
    vi.stubEnv('PAYPAL_WEBHOOK_ID', 'WH-TEST');
    seedPendingPaypalPayment();
    const verifyWebhookSignature = vi.fn(async () => true);

    const response = await postPaypalWebhook(
      {
        event_type: 'PAYMENT.CAPTURE.COMPLETED',
        resource: {
          id: 'CAPTURE-123',
          status: 'COMPLETED',
          amount: { currency_code: 'USD', value: '1.00' },
          supplementary_data: { related_ids: { order_id: 'ORDER-123' } },
        },
      },
      { verifyWebhookSignature },
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('review required');
    expect(userState.plan).toBe('free');
    expect(paymentRows[0]?.status).toBe('failed');
  });

  it('settles a signed capture only when status, amount and currency match', async () => {
    vi.stubEnv('PAYPAL_WEBHOOK_ID', 'WH-TEST');
    seedPendingPaypalPayment();
    const verifyWebhookSignature = vi.fn(async () => true);

    const response = await postPaypalWebhook(
      {
        event_type: 'PAYMENT.CAPTURE.COMPLETED',
        resource: {
          id: 'CAPTURE-123',
          status: 'COMPLETED',
          amount: { currency_code: 'USD', value: '49.00' },
          supplementary_data: { related_ids: { order_id: 'ORDER-123' } },
        },
      },
      { verifyWebhookSignature },
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('ok');
    expect(userState.plan).toBe('pro');
    expect(paymentRows[0]?.status).toBe('completed');
  });
});
