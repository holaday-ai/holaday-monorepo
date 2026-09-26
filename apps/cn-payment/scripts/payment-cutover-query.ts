import { createHash, createVerify, randomBytes } from 'node:crypto';
import { AlipaySdk } from 'alipay-sdk';
import WxPay from 'wechatpay-node-v3';
import { z } from 'zod';
import { verifyWechatPaySignature } from '../src/wechat-pay.js';

const text = z.string().min(1).max(256);
const key = z
  .string()
  .min(1)
  .max(32 * 1024);
const money = z.number().int().safe().positive();
const common = {
  orderId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  amountCents: money,
  currency: z.literal('CNY'),
  appId: text,
  merchantId: text,
  privateKey: key,
  settlement: z
    .object({ transactionId: text, amountCents: money, currency: text })
    .strict()
    .nullable(),
};
const inputSchema = z.discriminatedUnion('provider', [
  z
    .object({
      ...common,
      provider: z.literal('alipay'),
      environment: z.enum(['sandbox', 'production']),
      publicKey: key,
    })
    .strict(),
  z
    .object({
      ...common,
      provider: z.literal('wechat'),
      environment: z.literal('production'),
      certificate: key,
      serial: text,
      verifySerial: text,
      verifyKey: key,
    })
    .strict(),
]);
const alipayResponse = z.object({
  code: z.literal('10000'),
  out_trade_no: text,
  trade_no: text,
  seller_id: text.optional(),
  trade_status: text,
  total_amount: z.string().regex(/^\d{1,12}\.\d{2}$/),
});
const wechatResponse = z.object({
  appid: text,
  mchid: text,
  out_trade_no: text,
  transaction_id: text.optional(),
  trade_state: text,
  amount: z.object({ total: money, currency: z.literal('CNY') }),
});
export type PaymentObservation = {
  provider: 'alipay' | 'wechat';
  orderRef: string;
  merchantDigest: string;
  environment: 'sandbox' | 'production';
  observedAtMs: number;
  rawDigest: string;
  state: 'settled' | 'closed' | 'unpaid-valid' | 'paid-unsettled' | 'unknown';
};
type QueryIO = {
  transport?: (url: string, init: RequestInit) => Promise<Response>;
  retain(raw: string): Promise<void>;
  now?: () => number;
};
const hash = (text: string) => createHash('sha256').update(text).digest('hex');

/** SDK signing/verification with raw HTTP retained; never create, close, refund or settle. */
export async function queryPaymentOrder(value: unknown, io: QueryIO): Promise<PaymentObservation> {
  const parsed = inputSchema.safeParse(value);
  if (!parsed.success || typeof io?.retain !== 'function')
    throw new Error('MAINTENANCE_PAYMENT_QUERY_UNSUPPORTED');
  const input = parsed.data;
  const now = io.now ?? Date.now;
  const request = io.transport ?? fetch;
  const merchantDigest = hash(
    JSON.stringify([input.provider, input.environment, input.appId, input.merchantId]),
  );
  try {
    let raw: string;
    let archive: string;
    let observedAtMs: number;
    let data: unknown;
    if (input.provider === 'alipay') {
      const gateway =
        input.environment === 'production'
          ? 'https://openapi.alipay.com/gateway.do'
          : 'https://openapi.alipaydev.com/gateway.do';
      // SDK exec drops the signed envelope. Use its public signer/verifier and keep bytes.
      const sdk = new AlipaySdk({
        appId: input.appId,
        privateKey: input.privateKey,
        alipayPublicKey: input.publicKey,
        gateway,
        signType: 'RSA2',
        camelcase: false,
        keyType: input.privateKey.includes('-----BEGIN PRIVATE KEY-----') ? 'PKCS8' : 'PKCS1',
      });
      const response = await request(gateway, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
        },
        body: sdk.sdkExecute('alipay.trade.query', { bizContent: { outTradeNo: input.orderId } }),
      });
      if (!response.ok) throw new Error('query');
      const bytes = Buffer.from(await response.arrayBuffer());
      observedAtMs = now();
      if (bytes.length > 256 * 1024) throw new Error('size');
      const contentType = response.headers.get('content-type');
      archive = JSON.stringify({ contentType, bodyBase64: bytes.toString('base64') });
      await io.retain(archive);
      const charset =
        /charset\s*=\s*["']?([a-zA-Z0-9_-]+)/i.exec(contentType ?? '')?.[1]?.toLowerCase() ??
        'utf-8';
      if (!['utf-8', 'utf8', 'gbk', 'gb2312', 'gb18030'].includes(charset))
        throw new Error('charset');
      raw = new TextDecoder(charset, { fatal: true }).decode(bytes);
      const envelope = z
        .object({ alipay_trade_query_response: z.unknown(), sign: z.string().min(1) })
        .parse(JSON.parse(raw));
      // SDK checkResponseSign re-encodes text as UTF-8. GBK responses are signed over
      // their original bytes; use the SDK envelope slicer with a lossless byte mapping.
      const signedBytes = Buffer.from(
        sdk.getSignStr(bytes.toString('latin1'), 'alipay_trade_query_response'),
        'latin1',
      );
      if (
        !createVerify('RSA-SHA256')
          .update(signedBytes)
          .verify(sdk.config.alipayPublicKey, envelope.sign, 'base64')
      )
        throw new Error('signature');
      data = envelope.alipay_trade_query_response;
    } else {
      const sdk = new WxPay({
        appid: input.appId,
        mchid: input.merchantId,
        serial_no: input.serial,
        publicKey: Buffer.from(input.certificate),
        privateKey: Buffer.from(input.privateKey),
      });
      const path = `/v3/pay/transactions/out-trade-no/${encodeURIComponent(input.orderId)}?mchid=${encodeURIComponent(input.merchantId)}`;
      const nonce = randomBytes(16).toString('hex');
      const timestamp = String(Math.floor(now() / 1000));
      const signature = sdk.getSignature('GET', nonce, timestamp, path);
      const response = await request(`https://api.mch.weixin.qq.com${path}`, {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
        headers: {
          authorization: sdk.getAuthorization(nonce, timestamp, signature),
          accept: 'application/json',
        },
      });
      if (!response.ok) throw new Error('query');
      raw = await response.text();
      observedAtMs = now();
      if (Buffer.byteLength(raw) > 256 * 1024) throw new Error('size');
      const headers = Object.fromEntries(response.headers.entries());
      archive = JSON.stringify({ headers, body: raw });
      await io.retain(archive);
      const stamp = response.headers.get('wechatpay-timestamp') ?? '';
      const serial = response.headers.get('wechatpay-serial');
      if (
        !/^\d+$/.test(stamp) ||
        Math.abs(observedAtMs - Number(stamp) * 1000) > 60_000 ||
        serial !== input.verifySerial ||
        !verifyWechatPaySignature(
          input.verifyKey,
          stamp,
          response.headers.get('wechatpay-nonce') ?? '',
          raw,
          response.headers.get('wechatpay-signature') ?? '',
        )
      )
        throw new Error('signature');
      data = JSON.parse(raw);
    }
    const result: PaymentObservation = {
      provider: input.provider,
      environment: input.environment,
      merchantDigest,
      orderRef: hash(JSON.stringify([merchantDigest, input.orderId])),
      observedAtMs,
      rawDigest: hash(archive),
      state: 'unknown',
    };
    let transactionId: string;
    if (input.provider === 'alipay') {
      const order = alipayResponse.safeParse(data);
      if (
        !order.success ||
        order.data.out_trade_no !== input.orderId ||
        (order.data.seller_id !== undefined && order.data.seller_id !== input.merchantId) ||
        Number(order.data.total_amount.replace('.', '')) !== input.amountCents
      )
        return result;
      if (order.data.trade_status === 'WAIT_BUYER_PAY' && input.settlement === null) {
        result.state = 'unpaid-valid';
        return result;
      }
      // TRADE_CLOSED also includes full refunds; never infer a harmless closure.
      if (!['TRADE_SUCCESS', 'TRADE_FINISHED'].includes(order.data.trade_status)) return result;
      transactionId = order.data.trade_no;
    } else {
      const order = wechatResponse.safeParse(data);
      if (
        !order.success ||
        order.data.out_trade_no !== input.orderId ||
        order.data.mchid !== input.merchantId ||
        order.data.appid !== input.appId ||
        order.data.amount.total !== input.amountCents
      )
        return result;
      if (
        input.settlement === null &&
        !order.data.transaction_id &&
        ['NOTPAY', 'CLOSED'].includes(order.data.trade_state)
      ) {
        result.state = order.data.trade_state === 'NOTPAY' ? 'unpaid-valid' : 'closed';
        return result;
      }
      if (order.data.trade_state !== 'SUCCESS' || !order.data.transaction_id) return result;
      transactionId = order.data.transaction_id;
    }
    result.state =
      input.settlement?.transactionId === transactionId &&
      input.settlement.amountCents === input.amountCents &&
      input.settlement.currency === input.currency
        ? 'settled'
        : 'paid-unsettled';
    return result;
  } catch {
    throw new Error('MAINTENANCE_PAYMENT_QUERY_FAILED');
  }
}
