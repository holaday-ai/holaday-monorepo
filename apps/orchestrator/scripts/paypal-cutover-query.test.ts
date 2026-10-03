import { describe, expect, it } from 'vitest';
import { queryPaymentOrder } from './paypal-cutover-query.js';

const input = {
  provider: 'paypal',
  environment: 'sandbox',
  orderId: 'TESTORDER',
  referenceId: 'local-order',
  amountCents: 1234,
  currency: 'USD',
  merchantId: 'MERCHANT',
  clientId: 'CLIENT',
  clientSecret: 'PRIVATE',
  settlement: null,
};
const order = () => ({
  id: 'TESTORDER',
  intent: 'CAPTURE',
  status: 'COMPLETED',
  purchase_units: [
    {
      reference_id: 'local-order',
      payee: { merchant_id: 'MERCHANT' },
      amount: { currency_code: 'USD', value: '12.34' },
      payments: {
        captures: [
          {
            id: 'CAPTURE',
            status: 'COMPLETED',
            final_capture: true,
            amount: { currency_code: 'USD', value: '12.34' },
          },
        ],
      },
    },
  ],
});
function fixture(value: unknown = order(), status = 200) {
  const sent: Array<{ url: string; init: RequestInit }> = [];
  const kept: string[] = [];
  return {
    sent,
    kept,
    io: {
      now: () => 100_000,
      retain: async (raw: string) => {
        kept.push(raw);
      },
      transport: async (url: string, init: RequestInit) => {
        sent.push({ url, init });
        return url.endsWith('/token')
          ? new Response(
              JSON.stringify({ access_token: 'TOKEN', token_type: 'Bearer', expires_in: 300 }),
            )
          : new Response(JSON.stringify(value), { status });
      },
    },
  };
}
describe('read-only PayPal cutover query', () => {
  it('uses only OAuth and GET, validates captured money, and redacts the observation', async () => {
    const f = fixture();
    const result = await queryPaymentOrder(input, f.io);
    expect(result.state).toBe('paid-unsettled');
    expect(f.sent.map((r) => [new URL(r.url).pathname, r.init.method])).toEqual([
      ['/v1/oauth2/token', 'POST'],
      ['/v2/checkout/orders/TESTORDER', 'GET'],
    ]);
    expect(f.sent.every((r) => r.init.redirect === 'error' && r.init.signal)).toBe(true);
    expect(f.kept).toEqual([JSON.stringify(order())]);
    for (const secret of ['TESTORDER', 'local-order', 'MERCHANT', 'CLIENT', 'PRIVATE', 'TOKEN'])
      expect(JSON.stringify(result)).not.toContain(secret);
  });
  it('requires matching local settlement, not merely COMPLETED', async () => {
    const f = fixture();
    expect(
      (
        await queryPaymentOrder(
          {
            ...input,
            settlement: {
              transactionId: 'CAPTURE',
              amountCents: 1234,
              currency: 'USD',
            },
          },
          f.io,
        )
      ).state,
    ).toBe('settled');
    expect(
      (
        await queryPaymentOrder(
          {
            ...input,
            settlement: {
              transactionId: 'OTHER',
              amountCents: 1234,
              currency: 'USD',
            },
          },
          f.io,
        )
      ).state,
    ).toBe('paid-unsettled');
  });
  it.each(['APPROVED', 'CREATED', 'PAYER_ACTION_REQUIRED', 'UNKNOWN'])(
    'does not infer payment or closure from %s',
    async (status) => {
      const value = { ...order(), status };
      const f = fixture(value);
      expect((await queryPaymentOrder(input, f.io)).state).toBe('unknown');
    },
  );
  it.each(['merchant', 'reference', 'currency', 'amount', 'capture', 'multiple', 'id', 'refunded'])(
    'rejects mismatched %s',
    async (kind) => {
      const value = order();
      const unit = value.purchase_units[0];
      if (!unit) throw new Error('fixture');
      if (kind === 'merchant') unit.payee.merchant_id = 'OTHER';
      if (kind === 'reference') unit.reference_id = 'OTHER';
      if (kind === 'currency') unit.amount.currency_code = 'CNY';
      if (kind === 'amount') unit.amount.value = '12.35';
      if (kind === 'capture') unit.payments.captures = [];
      if (kind === 'multiple') value.purchase_units.push(unit);
      if (kind === 'id') value.id = 'OTHER';
      if (kind === 'refunded') {
        const capture = unit.payments.captures[0];
        if (!capture) throw new Error('Missing capture fixture');
        capture.status = 'REFUNDED';
      }
      expect((await queryPaymentOrder(input, fixture(value).io)).state).toBe('unknown');
    },
  );
  it('cannot turn 404, network errors, or stale pending orders into closed', async () => {
    await expect(queryPaymentOrder(input, fixture({}, 404).io)).rejects.toThrow(
      'MAINTENANCE_PAYMENT_QUERY_FAILED',
    );
    const f = fixture();
    f.io.transport = async () => {
      throw new Error('PRIVATE provider error');
    };
    await expect(queryPaymentOrder(input, f.io)).rejects.toThrow(
      /^MAINTENANCE_PAYMENT_QUERY_FAILED$/,
    );
  });
  it('classifies an open order only with no payment attempts and a matching merchant', async () => {
    const value = order();
    value.status = 'APPROVED';
    const unit = value.purchase_units[0];
    if (!unit) throw new Error('Missing purchase unit');
    unit.payments.captures = [];
    expect((await queryPaymentOrder(input, fixture(value).io)).state).toBe('unpaid-valid');
    value.status = 'VOIDED';
    expect((await queryPaymentOrder(input, fixture(value).io)).state).toBe('closed');
    const settlement = { transactionId: 'CAPTURE', amountCents: 1234, currency: 'USD' };
    expect((await queryPaymentOrder({ ...input, settlement }, fixture(value).io)).state).toBe(
      'unknown',
    );
  });
  it('rejects unconfigured merchant, arbitrary environments and path injection before requests', async () => {
    for (const changed of [
      { merchantId: '' },
      { environment: 'other' },
      { orderId: '../capture' },
    ]) {
      const f = fixture();
      await expect(queryPaymentOrder({ ...input, ...changed }, f.io)).rejects.toThrow(
        'MAINTENANCE_PAYMENT_QUERY_UNSUPPORTED',
      );
      expect(f.sent).toEqual([]);
    }
  });
  it('does not turn archival delay into a fresh provider observation', async () => {
    const f = fixture();
    let clock = 100_000;
    f.io.now = () => clock;
    f.io.retain = async (raw) => {
      f.kept.push(raw);
      clock = 200_000;
    };
    expect((await queryPaymentOrder(input, f.io)).observedAtMs).toBe(100_000);
  });
});
