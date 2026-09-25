import { createHash } from 'node:crypto';
import { z } from 'zod';

const text = z.string().min(1).max(256);
const money = z.number().int().safe().positive();
const inputSchema = z
  .object({
    provider: z.literal('paypal'),
    environment: z.enum(['sandbox', 'production']),
    orderId: z.string().regex(/^[A-Z0-9]{1,36}$/),
    referenceId: text,
    amountCents: money,
    currency: z.enum(['USD', 'CNY']),
    merchantId: text,
    clientId: text,
    clientSecret: z.string().min(1).max(4096),
    settlement: z
      .object({ transactionId: text, amountCents: money, currency: text })
      .strict()
      .nullable(),
  })
  .strict();
const amount = z.object({ currency_code: text, value: z.string().regex(/^\d{1,12}\.\d{2}$/) });
const responseSchema = z.object({
  id: text,
  intent: z.literal('CAPTURE'),
  status: text,
  purchase_units: z
    .array(
      z.object({
        reference_id: text,
        payee: z.object({ merchant_id: text }),
        amount,
        payments: z
          .object({
            captures: z.array(
              z.object({ id: text, status: text, final_capture: z.boolean(), amount }),
            ),
            refunds: z.array(z.unknown()).optional(),
            authorizations: z.array(z.unknown()).optional(),
          })
          .optional(),
      }),
    )
    .length(1),
});
export type PaymentObservation = {
  provider: 'paypal';
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
const cents = (value: string) => Number(value.replace('.', ''));

/** No settlement/capture fallback. Caller must retain raw response in private evidence. */
export async function queryPaymentOrder(value: unknown, io: QueryIO): Promise<PaymentObservation> {
  const parsed = inputSchema.safeParse(value);
  if (!parsed.success || typeof io?.retain !== 'function')
    throw new Error('MAINTENANCE_PAYMENT_QUERY_UNSUPPORTED');
  const input = parsed.data;
  const now = io.now ?? Date.now;
  const request = io.transport ?? fetch;
  const base =
    input.environment === 'production'
      ? 'https://api-m.paypal.com'
      : 'https://api-m.sandbox.paypal.com';
  const merchantDigest = hash(
    JSON.stringify(['paypal', input.environment, input.clientId, input.merchantId]),
  );
  try {
    const oauth = await request(`${base}/v1/oauth2/token`, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
      headers: {
        authorization: `Basic ${Buffer.from(`${input.clientId}:${input.clientSecret}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    if (!oauth.ok) throw new Error('oauth');
    const token = z
      .object({
        access_token: z.string().min(1).max(8192),
        token_type: z.literal('Bearer'),
        expires_in: z.number().positive(),
      })
      .parse(await oauth.json());
    const response = await request(`${base}/v2/checkout/orders/${input.orderId}`, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
      headers: { authorization: `Bearer ${token.access_token}`, accept: 'application/json' },
    });
    if (!response.ok) throw new Error('query');
    const raw = await response.text();
    const observedAtMs = now();
    if (Buffer.byteLength(raw) > 256 * 1024) throw new Error('size');
    await io.retain(raw);
    const result: PaymentObservation = {
      provider: 'paypal',
      environment: input.environment,
      merchantDigest,
      orderRef: hash(JSON.stringify([merchantDigest, input.orderId])),
      observedAtMs,
      rawDigest: hash(raw),
      state: 'unknown',
    };
    const order = responseSchema.safeParse(JSON.parse(raw));
    if (!order.success) return result;
    const unit = order.data.purchase_units[0];
    if (
      !unit ||
      order.data.id !== input.orderId ||
      unit.reference_id !== input.referenceId ||
      unit.payee.merchant_id !== input.merchantId ||
      unit.amount.currency_code !== input.currency ||
      cents(unit.amount.value) !== input.amountCents
    )
      return result;
    const captures = unit.payments?.captures ?? [];
    const capture = captures[0];
    if (
      captures.length === 0 &&
      !unit.payments?.refunds?.length &&
      !unit.payments?.authorizations?.length &&
      input.settlement === null
    ) {
      if (['CREATED', 'SAVED', 'APPROVED', 'PAYER_ACTION_REQUIRED'].includes(order.data.status))
        result.state = 'unpaid-valid';
      else if (order.data.status === 'VOIDED') result.state = 'closed';
      return result;
    }
    if (
      order.data.status !== 'COMPLETED' ||
      captures.length !== 1 ||
      !capture ||
      capture.status !== 'COMPLETED' ||
      !capture.final_capture ||
      unit.payments?.refunds?.length ||
      unit.payments?.authorizations?.length ||
      capture.amount.currency_code !== input.currency ||
      cents(capture.amount.value) !== input.amountCents
    )
      return result;
    result.state =
      input.settlement?.transactionId === capture.id &&
      input.settlement.amountCents === input.amountCents &&
      input.settlement.currency === input.currency
        ? 'settled'
        : 'paid-unsettled';
    return result;
  } catch {
    throw new Error('MAINTENANCE_PAYMENT_QUERY_FAILED');
  }
}
