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
  it.each([ali, wx])(
    'accepts a signed $provider response exactly at the byte limit',
    async (input) => {
      const value = {
        ...(input.provider === 'alipay' ? alipayOrder() : wechatOrder()),
        extra: '中文',
      };
      const initial = await signed(input.provider, value).arrayBuffer();
      value.extra += 'a'.repeat(256 * 1024 - initial.byteLength);
      const response = signed(input.provider, value);
      const bytes = new Uint8Array(await response.arrayBuffer());
      expect(bytes.byteLength).toBe(256 * 1024);
      let offset = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(bytes.slice(offset, offset + 32767));
          offset += 32767;
          if (offset >= bytes.length) controller.close();
        },
      });
      const f = fixture(input.provider, value);
      f.io.transport = async () => new Response(body, { headers: response.headers });
      expect((await queryPaymentOrder(input, f.io)).state).toBe('paid-unsettled');
      expect(f.kept).toHaveLength(1);
      const archive = JSON.parse(f.kept[0] ?? '{}');
      expect(
        input.provider === 'alipay'
          ? Buffer.from(archive.bodyBase64, 'base64')
          : Buffer.from(archive.body),
      ).toEqual(Buffer.from(bytes));
      expect(body.locked).toBe(false);
    },
  );

  it.each([ali, wx])(
    'cancels an oversized $provider stream before consuming the remainder',
    async (input) => {
      let pulls = 0;
      let cancelled = false;
      let requests = 0;
      const kept: string[] = [];
      const body = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            pulls++;
            controller.enqueue(new Uint8Array(64 * 1024));
            if (pulls === 8) controller.close();
          },
          cancel() {
            cancelled = true;
          },
        },
        { highWaterMark: 0 },
      );
      await expect(
        queryPaymentOrder(input, {
          now: () => 100_000,
          retain: async (raw) => {
            kept.push(raw);
          },
          transport: async () => {
            requests++;
            // A lying or absent Content-Length must not bypass the byte limit.
            return new Response(body, { headers: { 'content-length': '1' } });
          },
        }),
      ).rejects.toThrow(/^MAINTENANCE_PAYMENT_QUERY_FAILED$/);
      expect(cancelled).toBe(true);
      expect(pulls).toBe(5);
      expect(requests).toBe(1);
      expect(kept).toEqual([]);
      expect(body.locked).toBe(false);
    },
  );

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
    const archive = JSON.parse(f.kept[0] ?? '{}');
    expect(Buffer.from(archive.bodyBase64, 'base64').toString('utf8')).toContain('"sign":');
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
  it.each([false, true])('verifies original GBK response bytes, tampered=%s', async (tampered) => {
    // Catches decoding to UTF-8 before verification. These are literal GBK bytes for 错误.
    const payload = Buffer.concat([
      Buffer.from('{"code":"40004","msg":"'),
      Buffer.from([0xb4, 0xed, 0xce, 0xf3]),
      Buffer.from('","sub_code":"ACQ.TRADE_NOT_EXIST","out_trade_no":"PRIVATEORDER"}'),
    ]);
    const signature = createSign('RSA-SHA256').update(payload).sign(keys.privateKey, 'base64');
    const body = Buffer.concat([
      Buffer.from('{"alipay_trade_query_response":'),
      payload,
      Buffer.from(`,"sign":${JSON.stringify(signature)}}`),
    ]);
    if (tampered) body[body.indexOf(Buffer.from('40004'))] = 0x35;
    const f = fixture('alipay', alipayOrder());
    f.io.transport = async () =>
      new Response(body, { headers: { 'content-type': 'text/html;charset=GBK' } });
    if (tampered) {
      await expect(queryPaymentOrder(ali, f.io)).rejects.toThrow(
        'MAINTENANCE_PAYMENT_QUERY_FAILED',
      );
    } else {
      const result = await queryPaymentOrder(ali, f.io);
      expect(result.state).toBe('unknown');
      const archive = JSON.parse(f.kept[0] ?? '{}');
      expect(archive.contentType).toBe('text/html;charset=GBK');
      expect(Buffer.from(archive.bodyBase64, 'base64')).toEqual(body);
    }
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
  it('recognizes a signed closed WeChat order when the provider omits amount', async () => {
    // Real Native CLOSED responses omit both amount and transaction_id. Only
    // the transport is replaced; the production SDK/signature verifier is real.
    const response = {
      appid: 'APP',
      mchid: 'MERCHANT',
      out_trade_no: 'PRIVATEORDER',
      trade_state: 'CLOSED',
    };
    const f = fixture('wechat', response);
    const result = await queryPaymentOrder(wx, f.io);
    expect(result.state).toBe('closed');
    expect(result.rawDigest).toBe(
      createHash('sha256')
        .update(f.kept[0] ?? '')
        .digest('hex'),
    );
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0]?.init.method).toBe('GET');
    expect(f.sent[0]?.init.body).toBeUndefined();
  });
  it.each([
    { appid: 'OTHER' },
    { mchid: 'OTHER' },
    { out_trade_no: 'OTHER' },
    { transaction_id: 'TRADE' },
    { amount: null },
    { amount: { total: 1, currency: 'CNY' } },
    { amount: { total: 1234, currency: 'USD' } },
    { amount: { total: 0, currency: 'CNY' } },
    { amount: { total: 1234 } },
  ])('does not accept conflicting or malformed closure evidence: %j', async (override) => {
    const response = {
      appid: 'APP',
      mchid: 'MERCHANT',
      out_trade_no: 'PRIVATEORDER',
      trade_state: 'CLOSED',
      ...override,
    };
    expect((await queryPaymentOrder(wx, fixture('wechat', response).io)).state).toBe('unknown');
  });
  it.each(['SUCCESS', 'NOTPAY', 'REFUND', 'USERPAYING', 'PAYERROR'])(
    'still requires amount for a non-closed WeChat response: %s',
    async (trade_state) => {
      const response = {
        appid: 'APP',
        mchid: 'MERCHANT',
        out_trade_no: 'PRIVATEORDER',
        trade_state,
        ...(trade_state === 'SUCCESS' ? { transaction_id: 'TRADE' } : {}),
      };
      expect((await queryPaymentOrder(wx, fixture('wechat', response).io)).state).toBe('unknown');
    },
  );
  it('does not accept missing-amount closure over a local settlement or invalid signature', async () => {
    const response = {
      appid: 'APP',
      mchid: 'MERCHANT',
      out_trade_no: 'PRIVATEORDER',
      trade_state: 'CLOSED',
    };
    const settlement = { transactionId: 'TRADE', amountCents: 1234, currency: 'CNY' };
    expect(
      (await queryPaymentOrder({ ...wx, settlement }, fixture('wechat', response).io)).state,
    ).toBe('unknown');
    await expect(queryPaymentOrder(wx, fixture('wechat', response, true).io)).rejects.toThrow(
      'MAINTENANCE_PAYMENT_QUERY_FAILED',
    );
  });
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
