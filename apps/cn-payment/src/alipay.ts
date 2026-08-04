/**
 * Alipay adapter — 电脑网站支付 (PagePay) flow.
 *
 * The `alipay-sdk` package wraps Alipay's OpenAPI: order creation,
 * notification signature verification, and trade-status queries.
 * PagePay returns either an HTML form snippet (auto-submits to
 * Alipay) or a redirect URL; we expose the URL form so the SPA can
 * `window.open` to a clean payment page.
 *
 * Mobile path: same SDK, different `method` value
 * (`alipay.trade.wap.pay`). Future polish — detect viewport width
 * before picking; for now PagePay degrades acceptably on mobile.
 */

import { AlipaySdk } from 'alipay-sdk';
import type { Logger } from 'pino';
import type { Env } from './config/env.js';

export interface AlipayCreateOrderArgs {
  outTradeNo: string;
  subject: string;
  amountCents: number;
  passback: string;
  notifyUrl: string;
  returnUrl: string;
}

export interface AlipayCreateOrderResult {
  payUrl: string;
  outTradeNo: string;
}

export interface AlipayNotifyPayload {
  outTradeNo: string;
  transactionId: string;
  amountCents: number;
  passback: string;
  tradeStatus: string;
}

const ALIPAY_PRODUCTION_GATEWAY_HOST = 'openapi.alipay.com';
const ALIPAY_CHECKOUT_RESOLVE_TIMEOUT_MS = 10_000;

function isOfficialAlipayHost(hostname: string): boolean {
  return hostname === 'alipay.com' || hostname.endsWith('.alipay.com');
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

/**
 * Resolve the API gateway URL server-side to the browser-facing Alipay
 * checkout. Some client DNS resolvers cannot reach openapi.alipay.com even
 * though Alipay's cashier hosts are available; following Alipay's first
 * signed redirect on the mainland gateway keeps checkout on official hosts
 * without proxying payment HTML or credentials through HOLA DAY.
 */
export async function resolveAlipayCheckoutUrl(
  signedGatewayUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const gatewayUrl = new URL(signedGatewayUrl);
  if (
    gatewayUrl.protocol !== 'https:' ||
    gatewayUrl.hostname !== ALIPAY_PRODUCTION_GATEWAY_HOST ||
    gatewayUrl.pathname !== '/gateway.do' ||
    gatewayUrl.username !== '' ||
    gatewayUrl.password !== '' ||
    gatewayUrl.port !== ''
  ) {
    throw new Error('alipay: invalid signed gateway URL');
  }

  const response = await fetchImpl(gatewayUrl, {
    redirect: 'manual',
    signal: AbortSignal.timeout(ALIPAY_CHECKOUT_RESOLVE_TIMEOUT_MS),
  });
  if (!isRedirectStatus(response.status)) {
    throw new Error('alipay: checkout redirect unavailable');
  }
  const location = response.headers.get('location');
  if (!location) {
    throw new Error('alipay: checkout redirect unavailable');
  }

  const checkoutUrl = new URL(location, gatewayUrl);
  if (
    checkoutUrl.protocol !== 'https:' ||
    !isOfficialAlipayHost(checkoutUrl.hostname) ||
    checkoutUrl.hostname === ALIPAY_PRODUCTION_GATEWAY_HOST ||
    checkoutUrl.username !== '' ||
    checkoutUrl.password !== '' ||
    checkoutUrl.port !== ''
  ) {
    throw new Error('alipay: invalid checkout redirect');
  }
  return checkoutUrl.toString();
}

export class AlipayAdapter {
  private sdk: AlipaySdk | null = null;
  private constructorErr: string | null = null;
  readonly env: Env;
  private readonly logger: Logger;

  constructor(env: Env, logger: Logger) {
    this.env = env;
    this.logger = logger;
  }

  init(): void {
    const { ALIPAY_APPID, ALIPAY_PRIVATE_KEY, ALIPAY_PUBLIC_KEY, ALIPAY_MODE } = this.env;
    if (!ALIPAY_APPID || !ALIPAY_PRIVATE_KEY || !ALIPAY_PUBLIC_KEY) {
      this.constructorErr = 'alipay: missing one or more credentials';
      this.logger.warn(this.constructorErr);
      return;
    }
    try {
      this.sdk = new AlipaySdk({
        appId: ALIPAY_APPID,
        privateKey: ALIPAY_PRIVATE_KEY,
        alipayPublicKey: ALIPAY_PUBLIC_KEY,
        gateway:
          ALIPAY_MODE === 'sandbox'
            ? 'https://openapi.alipaydev.com/gateway.do'
            : 'https://openapi.alipay.com/gateway.do',
        timeout: 10_000,
      });
      this.logger.info({ appid: ALIPAY_APPID, mode: ALIPAY_MODE }, 'alipay: adapter initialised');
    } catch (err) {
      this.constructorErr = `alipay: sdk init failed — ${err instanceof Error ? err.message : String(err)}`;
      this.logger.error(this.constructorErr);
    }
  }

  isReady(): boolean {
    return this.sdk != null;
  }

  why(): string | null {
    return this.constructorErr;
  }

  /**
   * Create a PagePay order. The SDK returns the gateway URL with
   * encoded parameters; the SPA opens this in a new window/tab.
   * Alipay POSTs to `notify_url` after the user pays; the user
   * lands at `return_url` regardless of payment outcome.
   *
   * Amount is in YUAN as a 2-decimal string per Alipay docs (NOT
   * cents like WeChat). `total_amount` "10.00" is ten yuan.
   */
  async createPagePayUrl(args: AlipayCreateOrderArgs): Promise<AlipayCreateOrderResult> {
    if (!this.sdk) throw new Error('alipay adapter not ready');
    const yuan = (args.amountCents / 100).toFixed(2);
    // alipay-sdk 4.x exposes pageExecute returning a URL string for
    // page-style methods. Cast at the boundary since the lib's
    // dynamic method dispatch defeats inference.
    const url = await (
      this.sdk as unknown as {
        pageExecute: (
          method: string,
          params: {
            method: 'POST' | 'GET';
            bizContent: Record<string, unknown>;
            notifyUrl?: string;
            returnUrl?: string;
          },
        ) => string;
      }
    ).pageExecute('alipay.trade.page.pay', {
      method: 'GET',
      notifyUrl: args.notifyUrl,
      returnUrl: args.returnUrl,
      bizContent: {
        out_trade_no: args.outTradeNo,
        total_amount: yuan,
        subject: args.subject,
        product_code: 'FAST_INSTANT_TRADE_PAY',
        passback_params: encodeURIComponent(args.passback),
      },
    });
    const payUrl =
      this.env.ALIPAY_MODE === 'production' ? await resolveAlipayCheckoutUrl(url) : url;
    return { payUrl, outTradeNo: args.outTradeNo };
  }

  /**
   * Verify Alipay's async notification signature. Alipay POSTs the
   * notification as application/x-www-form-urlencoded; the parsed
   * body is what we pass in.
   */
  verifyNotify(body: Record<string, string>): boolean {
    if (!this.sdk) return false;
    return (
      this.sdk as unknown as {
        checkNotifySignV2: (body: Record<string, string>) => boolean;
      }
    ).checkNotifySignV2(body);
  }

  /**
   * Map the verified-and-trusted notify body to our normalised shape.
   * Caller is responsible for verifying first via verifyNotify().
   */
  parseNotifyBody(body: Record<string, string>): AlipayNotifyPayload {
    if (!this.env.ALIPAY_APPID || body.app_id !== this.env.ALIPAY_APPID) {
      throw new Error('alipay notify: app_id mismatch');
    }
    if (this.env.ALIPAY_SELLER_ID && body.seller_id !== this.env.ALIPAY_SELLER_ID) {
      throw new Error('alipay notify: seller_id mismatch');
    }
    const amountText = body.total_amount ?? '';
    const amountCents = /^\d+(?:\.\d{1,2})?$/.test(amountText)
      ? Math.round(Number(amountText) * 100)
      : Number.NaN;
    if (
      !body.out_trade_no ||
      !body.trade_no ||
      !Number.isSafeInteger(amountCents) ||
      amountCents <= 0
    ) {
      throw new Error('alipay notify: invalid transaction payload');
    }
    return {
      outTradeNo: body.out_trade_no ?? '',
      transactionId: body.trade_no ?? '',
      tradeStatus: body.trade_status ?? '',
      amountCents,
      passback: body.passback_params ? decodeURIComponent(body.passback_params) : '',
    };
  }
}
