/**
 * PayPal Checkout v2 adapter — raw fetch, no SDK.
 *
 * Two operations the tRPC layer needs:
 *   - createOrder({ plan, userId, returnUrl, cancelUrl }) → orderId + approvalUrl
 *   - captureOrder(orderId) → captureId + payer email + final amount
 *
 * Plus webhook helpers:
 *   - verifyWebhookSignature(headers, rawBody) — uses PayPal's
 *     /v1/notifications/verify-webhook-signature endpoint, which echoes
 *     back a `verification_status` of SUCCESS or FAILURE. Returns true
 *     only on SUCCESS so a tampered body is rejected.
 *
 * Rationale for raw fetch:
 *   The official `@paypal/checkout-server-sdk` is unmaintained (last
 *   release 2021) and bloats the install with axios + promise polyfills.
 *   The v2 REST API is small enough to call directly — same pattern
 *   we use for Resend (apps/orchestrator/src/auth/email-code.ts).
 *
 * Env switches:
 *   PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET — required to construct.
 *   PAYPAL_ENV = 'sandbox' | 'live' (default 'sandbox' so we can't
 *     accidentally charge real cards before BOSS flips the switch).
 *   PAYPAL_WEBHOOK_ID — required in production for webhook signature verification.
 */

import { logger } from '../config/logger.js';

export interface PayPalAdapter {
  /** Create an order; returns the PayPal order id and the approve URL. */
  createOrder(opts: {
    amountCents: number;
    currency?: string;
    referenceId: string;
    description: string;
    returnUrl: string;
    cancelUrl: string;
  }): Promise<{ orderId: string; approveUrl: string }>;

  /** Capture an approved order; returns the capture id + payer info. */
  captureOrder(orderId: string): Promise<{
    captureId: string;
    status: string;
    amountCents: number;
    currency: string;
    payerEmail: string | null;
  }>;

  /** Verify a webhook signature; returns true only on PayPal SUCCESS. */
  verifyWebhookSignature(opts: {
    headers: Record<string, string | string[] | undefined>;
    body: unknown;
    webhookId: string;
  }): Promise<boolean>;

  readonly env: 'sandbox' | 'live';
}

interface AccessToken {
  token: string;
  /** Epoch ms when this token becomes useless. */
  expiresAt: number;
}

const SANDBOX_BASE = 'https://api-m.sandbox.paypal.com';
const LIVE_BASE = 'https://api-m.paypal.com';

/**
 * Construct a PayPal adapter, or null when credentials aren't set.
 * Mirrors createResendSender — keeps the boot sequence "feature
 * on/off" check in a single boolean.
 */
export function createPayPalAdapter(opts: {
  clientId: string | null;
  clientSecret: string | null;
  env: 'sandbox' | 'live';
}): PayPalAdapter | null {
  if (!opts.clientId || !opts.clientSecret) return null;

  const baseUrl = opts.env === 'live' ? LIVE_BASE : SANDBOX_BASE;

  // Bearer tokens last ~9 hours. Cache one in-process and refresh 60s
  // before expiry so concurrent requests don't all stampede the
  // /oauth2/token endpoint at the same moment.
  let cached: AccessToken | null = null;
  let inFlight: Promise<AccessToken> | null = null;
  async function getAccessToken(): Promise<string> {
    const now = Date.now();
    if (cached && cached.expiresAt - 60_000 > now) return cached.token;
    if (inFlight) return (await inFlight).token;
    inFlight = (async () => {
      const basic = Buffer.from(`${opts.clientId}:${opts.clientSecret}`).toString('base64');
      const res = await fetch(`${baseUrl}/v1/oauth2/token`, {
        method: 'POST',
        headers: {
          authorization: `Basic ${basic}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`paypal oauth ${res.status}: ${body.slice(0, 200)}`);
      }
      const json = (await res.json()) as { access_token: string; expires_in: number };
      const expiresAt = Date.now() + json.expires_in * 1000;
      const fresh: AccessToken = { token: json.access_token, expiresAt };
      cached = fresh;
      return fresh;
    })();
    try {
      const t = await inFlight;
      return t.token;
    } finally {
      inFlight = null;
    }
  }

  async function authedFetch(path: string, init: { method: string; body?: string }): Promise<Response> {
    const token = await getAccessToken();
    return fetch(`${baseUrl}${path}`, {
      method: init.method,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      ...(init.body !== undefined ? { body: init.body } : {}),
    });
  }

  return {
    env: opts.env,

    async createOrder(input) {
      const dollars = (input.amountCents / 100).toFixed(2);
      const currency = input.currency ?? 'USD';
      const body = {
        intent: 'CAPTURE',
        purchase_units: [
          {
            reference_id: input.referenceId,
            description: input.description.slice(0, 127),
            amount: { currency_code: currency, value: dollars },
          },
        ],
        application_context: {
          brand_name: 'HOLA DAY',
          user_action: 'PAY_NOW',
          return_url: input.returnUrl,
          cancel_url: input.cancelUrl,
          shipping_preference: 'NO_SHIPPING',
        },
      };
      const res = await authedFetch('/v2/checkout/orders', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`paypal createOrder ${res.status}: ${text.slice(0, 300)}`);
      }
      const json = (await res.json()) as {
        id: string;
        links?: Array<{ rel: string; href: string }>;
      };
      const approve = json.links?.find((l) => l.rel === 'approve')?.href;
      if (!approve) {
        throw new Error('paypal createOrder: no approve link in response');
      }
      return { orderId: json.id, approveUrl: approve };
    },

    async captureOrder(orderId) {
      const res = await authedFetch(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
        method: 'POST',
        body: '{}',
      });
      // 422 with issue=ORDER_ALREADY_CAPTURED happens when the user
      // double-clicks Pay or refreshes mid-capture. Re-fetch the order
      // and surface its existing capture so the caller can still mark
      // the upgrade complete (idempotent). Anything else is a real error.
      if (res.status === 422) {
        const errBody = await res.clone().text();
        if (errBody.includes('ORDER_ALREADY_CAPTURED')) {
          const get = await authedFetch(`/v2/checkout/orders/${encodeURIComponent(orderId)}`, {
            method: 'GET',
          });
          if (get.ok) return parseCaptureFromOrder((await get.json()) as Record<string, unknown>);
        }
      }
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`paypal captureOrder ${res.status}: ${text.slice(0, 300)}`);
      }
      const json = (await res.json()) as Record<string, unknown>;
      return parseCaptureFromOrder(json);
    },

    async verifyWebhookSignature({ headers, body, webhookId }) {
      try {
        const payload = {
          auth_algo: pickHeader(headers, 'paypal-auth-algo'),
          cert_url: pickHeader(headers, 'paypal-cert-url'),
          transmission_id: pickHeader(headers, 'paypal-transmission-id'),
          transmission_sig: pickHeader(headers, 'paypal-transmission-sig'),
          transmission_time: pickHeader(headers, 'paypal-transmission-time'),
          webhook_id: webhookId,
          webhook_event: body,
        };
        const res = await authedFetch('/v1/notifications/verify-webhook-signature', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        if (!res.ok) return false;
        const j = (await res.json()) as { verification_status?: string };
        return j.verification_status === 'SUCCESS';
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'paypal: webhook verification threw',
        );
        return false;
      }
    },
  };
}

function pickHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string {
  const v = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(v)) return v[0] ?? '';
  return v ?? '';
}

/**
 * Pull the canonical capture out of either a capture-create or order-get
 * response. PayPal nests the captures inside `purchase_units[0].payments
 * .captures[0]` — we always charge a single unit so element 0 is right.
 */
function parseCaptureFromOrder(json: Record<string, unknown>): {
  captureId: string;
  status: string;
  amountCents: number;
  currency: string;
  payerEmail: string | null;
} {
  const units = (json.purchase_units as unknown as Array<Record<string, unknown>> | undefined) ?? [];
  const unit = units[0] ?? {};
  const payments = (unit.payments as Record<string, unknown> | undefined) ?? {};
  const captures = (payments.captures as Array<Record<string, unknown>> | undefined) ?? [];
  const capture = captures[0];
  if (!capture) {
    throw new Error('paypal capture: no capture present in response');
  }
  const amount = capture.amount as { currency_code?: string; value?: string } | undefined;
  const value = amount?.value ?? '0';
  // Round to nearest cent (PayPal returns 2 dp strings — parse + multiply).
  const amountCents = Math.round(Number(value) * 100);
  const payer = json.payer as { email_address?: string } | undefined;
  return {
    captureId: String(capture.id ?? ''),
    status: String(capture.status ?? ''),
    amountCents: Number.isFinite(amountCents) ? amountCents : 0,
    currency: amount?.currency_code ?? 'USD',
    payerEmail: payer?.email_address ?? null,
  };
}
