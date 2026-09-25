import { createHash, createSign, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { queryPaymentOrder } from './payment-cutover-query.js';

const keys = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const base = { orderId: 'PRIVATEORDER', amountCents: 1234, currency: 'CNY', settlement: null };
const ali = {
  ...base,
  provider: 'alipay',
  environment: 'sandbox',
  appId: 'APP',
  merchantId: 'MERCHANT',
  privateKey: keys.privateKey,
  publicKey: keys.publicKey,
};
const wx = {
  ...base,
  provider: 'wechat',
  environment: 'production',
  appId: 'APP',
  merchantId: 'MERCHANT',
  privateKey: keys.privateKey,
  certificate: keys.publicKey,
  serial: 'AABB',
  verifySerial: 'PUB_KEY_ID_01',
  verifyKey: keys.publicKey,
};
const alipayOrder = () => ({
  code: '10000',
  msg: 'Success',
  out_trade_no: 'PRIVATEORDER',
  trade_no: 'TRADE',
  seller_id: 'MERCHANT',
  trade_status: 'TRADE_SUCCESS',
  total_amount: '12.34',
});
const wechatOrder = () => ({
  appid: 'APP',
  mchid: 'MERCHANT',
  out_trade_no: 'PRIVATEORDER',
  transaction_id: 'TRADE',
  trade_state: 'SUCCESS',
  amount: { total: 1234, currency: 'CNY' },
});
function signed(provider: string, value: unknown, badSign = false): Response {
  const content = JSON.stringify(value);
  const sign = createSign('RSA-SHA256');
  sign.update(provider === 'wechat' ? `100\nnonce\n${content}\n` : content);
  const signature = badSign ? 'bad' : sign.sign(keys.privateKey, 'base64');
  return provider === 'wechat'
    ? new Response(content, {
        headers: {
          'wechatpay-timestamp': '100',
          'wechatpay-nonce': 'nonce',
          'wechatpay-serial': 'PUB_KEY_ID_01',
          'wechatpay-signature': signature,
        },
      })
    : new Response(
        `{"alipay_trade_query_response":${content},"sign":${JSON.stringify(signature)}}`,
      );
}
function fixture(provider: string, value: unknown, badSign = false) {
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
        return signed(provider, value, badSign);
      },
    },
  };
}
describe('domestic payment cutover queries', () => {
  it('uses only signed alipay.trade.query and retains signed raw bytes', async () => {
    const f = fixture('alipay', alipayOrder());
    const result = await queryPaymentOrder(ali, f.io);
    expect(result.state).toBe('paid-unsettled');
    const request = f.sent[0];
    if (!request) throw new Error('Missing Alipay request');
    expect(request.url).toBe('https://openapi.alipaydev.com/gateway.do');
    const body = new URLSearchParams(String(request.init.body));
    expect(body.get('method')).toBe('alipay.trade.query');
    expect(JSON.parse(body.get('biz_content') ?? '')).toEqual({ out_trade_no: 'PRIVATEORDER' });
    expect(body.get('sign')).toBeTruthy();
    expect(f.kept[0]).toContain('"sign":');
    expect(JSON.stringify(result)).not.toMatch(/PRIVATEORDER|MERCHANT|TRADE/);
  });
  it('uses a signed WeChat GET and verifies response before classifying', async () => {
    const f = fixture('wechat', wechatOrder());
    expect((await queryPaymentOrder(wx, f.io)).state).toBe('paid-unsettled');
    const request = f.sent[0];
    if (!request) throw new Error('Missing WeChat request');
    expect(request.url).toBe(
      'https://api.mch.weixin.qq.com/v3/pay/transactions/out-trade-no/PRIVATEORDER?mchid=MERCHANT',
    );
    expect(request.init.method).toBe('GET');
    expect(request.init.body).toBeUndefined();
    expect(new Headers(request.init.headers).get('authorization')).toContain(
      'WECHATPAY2-SHA256-RSA2048',
    );
  });
  it.each(['alipay', 'wechat'])('requires verified local accounting for %s', async (provider) => {
    const request = provider === 'alipay' ? ali : wx;
    const value = provider === 'alipay' ? alipayOrder() : wechatOrder();
    expect(
      (
        await queryPaymentOrder(
          {
            ...request,
            settlement: {
              transactionId: 'TRADE',
              amountCents: 1234,
              currency: 'CNY',
            },
          },
          fixture(provider, value).io,
        )
      ).state,
    ).toBe('settled');
    await expect(queryPaymentOrder(request, fixture(provider, value, true).io)).rejects.toThrow(
      'MAINTENANCE_PAYMENT_QUERY_FAILED',
    );
  });
  it.each(['TRADE_CLOSED', 'OTHER'])(
    'never guesses the financial meaning of %s',
    async (trade_status) => {
      expect(
        (await queryPaymentOrder(ali, fixture('alipay', { ...alipayOrder(), trade_status }).io))
          .state,
      ).toBe('unknown');
    },
  );
  it.each(['USERPAYING', 'REFUND', 'PAYERROR', 'OTHER'])(
    'never guesses payment or expiry from %s',
    async (trade_state) => {
      expect(
        (await queryPaymentOrder(wx, fixture('wechat', { ...wechatOrder(), trade_state }).io))
          .state,
      ).toBe('unknown');
    },
  );
  it('classifies current signed waiting state without inventing an expiry deadline', async () => {
    const waiting = { ...alipayOrder(), trade_status: 'WAIT_BUYER_PAY' };
    expect((await queryPaymentOrder(ali, fixture('alipay', waiting).io)).state).toBe(
      'unpaid-valid',
    );
    const unpaid = { ...wechatOrder(), trade_state: 'NOTPAY', transaction_id: undefined };
    expect((await queryPaymentOrder(wx, fixture('wechat', unpaid).io)).state).toBe('unpaid-valid');
    expect(
      (await queryPaymentOrder(wx, fixture('wechat', { ...unpaid, trade_state: 'CLOSED' }).io))
        .state,
    ).toBe('closed');
    const settlement = { transactionId: 'TRADE', amountCents: 1234, currency: 'CNY' };
    expect(
      (await queryPaymentOrder({ ...ali, settlement }, fixture('alipay', waiting).io)).state,
    ).toBe('unknown');
    expect(
      (await queryPaymentOrder({ ...wx, settlement }, fixture('wechat', unpaid).io)).state,
    ).toBe('unknown');
  });
  it.each(['merchant', 'amount', 'order', 'currency', 'appid'])(
    'rejects mismatched WeChat %s',
    async (field) => {
      const value = wechatOrder();
      if (field === 'merchant') value.mchid = 'OTHER';
      if (field === 'amount') value.amount.total = 1;
      if (field === 'order') value.out_trade_no = 'OTHER';
      if (field === 'currency') value.amount.currency = 'USD';
      if (field === 'appid') value.appid = 'OTHER';
      expect((await queryPaymentOrder(wx, fixture('wechat', value).io)).state).toBe('unknown');
    },
  );
  it.each(['seller', 'amount', 'order'])('rejects mismatched Alipay %s', async (field) => {
    const value = alipayOrder();
    if (field === 'seller') value.seller_id = 'OTHER';
    if (field === 'amount') value.total_amount = '1.00';
    if (field === 'order') value.out_trade_no = 'OTHER';
    expect((await queryPaymentOrder(ali, fixture('alipay', value).io)).state).toBe('unknown');
  });
  it('requires configured verification keys before calling either provider', async () => {
    for (const input of [
      { ...ali, publicKey: '' },
      { ...wx, verifyKey: '' },
      { ...wx, environment: 'sandbox' },
    ]) {
      const f = fixture('wechat', wechatOrder());
      await expect(queryPaymentOrder(input, f.io)).rejects.toThrow(
        'MAINTENANCE_PAYMENT_QUERY_UNSUPPORTED',
      );
      expect(f.sent).toEqual([]);
    }
  });
  it('network errors remain unknown and do not disclose provider bodies', async () => {
    const f = fixture('alipay', alipayOrder());
    f.io.transport = async () => {
      throw new Error('PRIVATE');
    };
    await expect(queryPaymentOrder(ali, f.io)).rejects.toThrow(
      /^MAINTENANCE_PAYMENT_QUERY_FAILED$/,
    );
  });
  it('accepts the documented direct-merchant response without inventing a seller echo field', async () => {
    const { seller_id: _sellerId, ...documentedResponse } = alipayOrder();
    const f = fixture('alipay', documentedResponse);
    const result = await queryPaymentOrder(ali, f.io);
    expect(result.state).toBe('paid-unsettled');
    const request = f.sent[0];
    if (!request) throw new Error('Missing request');
    const params = new URLSearchParams(String(request.init.body));
    expect(params.get('app_id')).toBe('APP');
    expect(params.has('app_auth_token')).toBe(false);
  });
  it('binds the entire signed archive and does not refresh source age during storage', async () => {
    const f = fixture('wechat', wechatOrder());
    let clock = 100_000;
    f.io.now = () => clock;
    f.io.retain = async (raw) => {
      f.kept.push(raw);
      clock = 200_000;
    };
    const result = await queryPaymentOrder(wx, f.io);
    expect(result.observedAtMs).toBe(100_000);
    expect(result.rawDigest).toBe(
      createHash('sha256')
        .update(f.kept[0] ?? '')
        .digest('hex'),
    );
  });
});
