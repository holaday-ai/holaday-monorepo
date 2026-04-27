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
    const url = await (this.sdk as unknown as {
      pageExecute: (
        method: string,
        params: { method: 'POST' | 'GET'; bizContent: Record<string, unknown>; notifyUrl?: string; returnUrl?: string },
      ) => string;
    }).pageExecute('alipay.trade.page.pay', {
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
    return { payUrl: url, outTradeNo: args.outTradeNo };
  }

  /**
   * Verify Alipay's async notification signature. Alipay POSTs the
   * notification as application/x-www-form-urlencoded; the parsed
   * body is what we pass in.
   */
  verifyNotify(body: Record<string, string>): boolean {
    if (!this.sdk) return false;
    return (this.sdk as unknown as {
      checkNotifySignV2: (body: Record<string, string>) => boolean;
    }).checkNotifySignV2(body);
  }

  /**
   * Map the verified-and-trusted notify body to our normalised shape.
   * Caller is responsible for verifying first via verifyNotify().
   */
  parseNotifyBody(body: Record<string, string>): AlipayNotifyPayload {
    return {
      outTradeNo: body.out_trade_no ?? '',
      transactionId: body.trade_no ?? '',
      tradeStatus: body.trade_status ?? '',
      amountCents: Math.round(Number.parseFloat(body.total_amount ?? '0') * 100),
      passback: body.passback_params ? decodeURIComponent(body.passback_params) : '',
    };
  }
}
