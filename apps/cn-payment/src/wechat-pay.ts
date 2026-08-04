/**
 * WeChat Pay v3 adapter — Native (扫码) flow.
 *
 * The `wechatpay-node-v3` package wraps the v3 REST API: payment
 * creation, signature verification, and AES-GCM resource decryption.
 * We use Native here (rather than JSAPI/H5) because the workbench
 * is mostly desktop, and a QR popup keeps the user inside our
 * main page until the wallet round-trips.
 *
 * Mobile path (future): switch to H5 when navigator.userAgent suggests
 * mobile + non-WeChat browser; JSAPI when inside WeChat itself.
 */

import { X509Certificate, createVerify } from 'node:crypto';
import { promises as fs } from 'node:fs';
import type { Logger } from 'pino';
import WxPay from 'wechatpay-node-v3';
import type { Env } from './config/env.js';

export interface WechatCreateOrderArgs {
  outTradeNo: string;
  description: string;
  amountCents: number;
  attach: string;
  notifyUrl: string;
}

export interface WechatCreateOrderResult {
  codeUrl: string;
  outTradeNo: string;
}

export interface WechatNotifyPayload {
  outTradeNo: string;
  transactionId: string;
  amountCents: number;
  attach: string;
  tradeState: string;
}

export type WechatCallbackVerificationMode = 'platform_certificate' | 'public_key' | 'unavailable';

/**
 * Construct lazily so a missing-cert deploy doesn't blow up at boot.
 * Returns null when configuration is incomplete; callers inspect
 * `isReady` and surface `provider_not_configured` upstream.
 */
export class WechatPayAdapter {
  private wx: WxPay | null = null;
  private constructorErr: string | null = null;
  private readonly callbackVerifyKeys = new Map<string, Buffer>();
  private callbackMode: WechatCallbackVerificationMode = 'unavailable';
  readonly env: Env;
  private readonly logger: Logger;

  constructor(env: Env, logger: Logger) {
    this.env = env;
    this.logger = logger;
  }

  async init(): Promise<void> {
    this.wx = null;
    this.constructorErr = null;
    this.callbackVerifyKeys.clear();
    this.callbackMode = 'unavailable';
    const {
      WX_APPID,
      WX_MCHID,
      WX_API_V3_KEY,
      WX_CERT_PATH,
      WX_KEY_PATH,
      WX_PLATFORM_CERT_PATH,
      WX_PUBLIC_KEY_ID,
      WX_PUBLIC_KEY_PATH,
    } = this.env;
    if (!WX_APPID || !WX_MCHID || !WX_API_V3_KEY || !WX_CERT_PATH || !WX_KEY_PATH) {
      this.constructorErr = 'wechat: missing one or more credentials/cert paths';
      this.logger.warn(this.constructorErr);
      return;
    }
    try {
      if (Boolean(WX_PUBLIC_KEY_ID) !== Boolean(WX_PUBLIC_KEY_PATH)) {
        throw new Error('WX_PUBLIC_KEY_ID and WX_PUBLIC_KEY_PATH must be configured together');
      }
      const [publicKey, privateKey] = await Promise.all([
        fs.readFile(WX_CERT_PATH),
        fs.readFile(WX_KEY_PATH),
      ]);
      let platformCert: Buffer | null = null;
      if (WX_PLATFORM_CERT_PATH) {
        try {
          platformCert = await fs.readFile(WX_PLATFORM_CERT_PATH);
        } catch (err) {
          this.logger.warn(
            { err: err instanceof Error ? err.message : String(err) },
            'wechat: local platform certificate unavailable; SDK certificate refresh will be used',
          );
        }
      }
      const wechatPublicKey = WX_PUBLIC_KEY_PATH ? await fs.readFile(WX_PUBLIC_KEY_PATH) : null;
      this.wx = new WxPay({
        appid: WX_APPID,
        mchid: WX_MCHID,
        publicKey,
        privateKey,
        key: WX_API_V3_KEY,
      });
      if (platformCert) {
        const serial = normalizeWechatSerial(new X509Certificate(platformCert).serialNumber);
        this.callbackVerifyKeys.set(serial, platformCert);
        this.callbackMode = 'platform_certificate';
      }
      if (WX_PUBLIC_KEY_ID && wechatPublicKey) {
        this.callbackVerifyKeys.set(normalizeWechatSerial(WX_PUBLIC_KEY_ID), wechatPublicKey);
        this.callbackMode = 'public_key';
      }
      if (this.callbackVerifyKeys.size === 0) {
        this.wx = null;
        this.constructorErr =
          'wechat: callback verification key unavailable; configure a platform certificate or public key';
        this.logger.error(this.constructorErr);
        return;
      }
      this.logger.info(
        { appid: WX_APPID, mchid: WX_MCHID, callbackVerification: this.callbackMode },
        'wechat: adapter initialised',
      );
    } catch (err) {
      this.constructorErr = `wechat: cert load failed — ${err instanceof Error ? err.message : String(err)}`;
      this.logger.error(this.constructorErr);
    }
  }

  isReady(): boolean {
    return this.wx != null && this.callbackMode !== 'unavailable';
  }

  callbackVerificationMode(): WechatCallbackVerificationMode {
    return this.callbackMode;
  }

  why(): string | null {
    return this.constructorErr;
  }

  /**
   * Create a Native QR-code payment. Returns the `code_url` that the
   * SPA renders into a QR image. WeChat polls the user's wallet
   * after the scan; the result lands at `notifyUrl` as a v3 webhook.
   */
  async createNativeOrder(args: WechatCreateOrderArgs): Promise<WechatCreateOrderResult> {
    if (!this.wx) throw new Error('wechat adapter not ready');
    const params = {
      description: args.description,
      out_trade_no: args.outTradeNo,
      notify_url: args.notifyUrl,
      amount: { total: args.amountCents, currency: 'CNY' as const },
      attach: args.attach,
    };
    // wechatpay-node-v3's typings on `transactions_native` are loose;
    // use the documented runtime shape and cast at the boundary.
    const resp = await (
      this.wx as unknown as {
        transactions_native: (
          p: typeof params,
        ) => Promise<{ code_url?: string; data?: { code_url?: string } }>;
      }
    ).transactions_native(params);
    const codeUrl = resp.code_url ?? resp.data?.code_url;
    if (!codeUrl) {
      throw new Error('wechat: transactions_native returned no code_url');
    }
    return { codeUrl, outTradeNo: args.outTradeNo };
  }

  /**
   * Verify a callback's signature + decrypt the resource block.
   * Returns the parsed payload when valid, throws otherwise.
   *
   * The headers we pass through:
   *   wechatpay-timestamp / wechatpay-nonce / wechatpay-signature
   *   wechatpay-serial (used to pick the right WX platform cert)
   *
   * The body is the raw JSON WX posts; do NOT mutate it before
   * verification — the signature is over the literal bytes.
   */
  async verifyAndDecryptNotify(
    headers: Record<string, string | string[] | undefined>,
    rawBody: string,
  ): Promise<WechatNotifyPayload> {
    if (!this.wx) throw new Error('wechat adapter not ready');
    const sig = pickHeader(headers, 'wechatpay-signature');
    const ts = pickHeader(headers, 'wechatpay-timestamp');
    const nonce = pickHeader(headers, 'wechatpay-nonce');
    const serial = pickHeader(headers, 'wechatpay-serial');
    if (!sig || !ts || !nonce || !serial) {
      throw new Error('wechat notify: missing required signature headers');
    }
    const normalizedSerial = normalizeWechatSerial(serial);
    const localKey = this.callbackVerifyKeys.get(normalizedSerial);
    const ok = localKey
      ? verifyWechatPaySignature(localKey, ts, nonce, rawBody, sig)
      : normalizedSerial.startsWith('PUB_KEY_ID_')
        ? false
        : await (
            this.wx as unknown as {
              verifySign: (args: {
                timestamp: string;
                nonce: string;
                body: string;
                serial: string;
                signature: string;
              }) => Promise<boolean>;
            }
          ).verifySign({ timestamp: ts, nonce, body: rawBody, serial, signature: sig });
    if (!ok) throw new Error('wechat notify: signature verification failed');
    const parsed = JSON.parse(rawBody) as {
      resource: { ciphertext: string; associated_data: string; nonce: string };
    };
    const decrypted = (
      this.wx as unknown as {
        decipher_gcm: (
          ciphertext: string,
          associated: string,
          nonce: string,
          key: string,
        ) => unknown;
      }
    ).decipher_gcm(
      parsed.resource.ciphertext,
      parsed.resource.associated_data,
      parsed.resource.nonce,
      this.env.WX_API_V3_KEY ?? '',
    );
    const dec = (typeof decrypted === 'string' ? JSON.parse(decrypted) : decrypted) as {
      appid?: string;
      mchid?: string;
      out_trade_no: string;
      transaction_id: string;
      trade_state: string;
      amount: { total: number; currency?: string };
      attach?: string;
    };
    if (
      dec.appid !== this.env.WX_APPID ||
      dec.mchid !== this.env.WX_MCHID ||
      dec.amount?.currency !== 'CNY'
    ) {
      throw new Error('wechat notify: callback does not match configured merchant');
    }
    if (
      !dec.out_trade_no ||
      !dec.transaction_id ||
      !dec.trade_state ||
      !Number.isSafeInteger(dec.amount.total) ||
      dec.amount.total <= 0
    ) {
      throw new Error('wechat notify: invalid transaction payload');
    }
    return {
      outTradeNo: dec.out_trade_no,
      transactionId: dec.transaction_id,
      tradeState: dec.trade_state,
      amountCents: dec.amount.total,
      attach: dec.attach ?? '',
    };
  }
}

export function verifyWechatPaySignature(
  publicKey: Buffer | string,
  timestamp: string,
  nonce: string,
  rawBody: string,
  signature: string,
): boolean {
  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${timestamp}\n${nonce}\n${rawBody}\n`);
  return verifier.verify(publicKey, signature, 'base64');
}

function normalizeWechatSerial(value: string): string {
  return value.replace(/:/g, '').trim().toUpperCase();
}

function pickHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | null {
  const v = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}
