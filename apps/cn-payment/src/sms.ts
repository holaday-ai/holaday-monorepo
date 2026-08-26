/**
 * Phase 12 — Aliyun SMS adapter + in-memory code store.
 *
 * Two pieces under one module so the routes (in index.ts) can
 * compose them without a second file. Single-process, single-host
 * gateway → memory is fine; the cap is "send code → user pastes →
 * verify within 5 min", and at the worst-case throughput the in-mem
 * Map stays well under a thousand entries.
 *
 * If the gateway grows to multiple instances, swap the Map for
 * Redis with the same surface — both methods are pure function-of-
 * (phone) operations, no shared mutable state besides the map.
 */

import { randomInt } from 'node:crypto';
import { createRequire } from 'node:module';
import type { Logger } from 'pino';
// SDK ships as CJS with `module.exports = { default: Client, ... }`.
// Under tsx + ESM resolution the `import * as` form sometimes hands
// back the wrapped namespace and `import default` hands back the
// namespace too — both shapes mean `new Dysmsapi()` throws "is not
// a constructor". createRequire bypasses ESM interop entirely and
// hands back the raw CJS exports object, where `.default` is the
// class regardless of node loader version.
const require = createRequire(import.meta.url);
import { SendSmsRequest } from '@alicloud/dysmsapi20170525/dist/models/SendSmsRequest.js';
import * as OpenApi from '@alicloud/openapi-client';
import type { Env } from './config/env.js';

type DysmsapiCtor = new (
  config: InstanceType<typeof OpenApi.Config>,
) => {
  sendSms(req: InstanceType<typeof SendSmsRequest>): Promise<unknown>;
};
const dysmsapiModule: unknown = require('@alicloud/dysmsapi20170525');
const Dysmsapi: DysmsapiCtor =
  typeof dysmsapiModule === 'function'
    ? (dysmsapiModule as DysmsapiCtor)
    : (dysmsapiModule as { default: DysmsapiCtor }).default;

interface CodeEntry {
  code: string;
  expiresAt: number;
  /** Last send time for the per-phone 60s throttle. */
  sentAt: number;
}

const TTL_MS = 5 * 60 * 1000;
const COOLDOWN_MS = 60 * 1000;

export type SmsSendResult =
  | { ok: true; cooldownMs: number }
  | {
      ok: false;
      error: 'sms_not_configured' | 'invalid_phone' | 'too_frequent' | 'aliyun_error';
      message?: string;
    };

export type SmsDeliveryResult =
  | { ok: true }
  | {
      ok: false;
      error: 'sms_not_configured' | 'invalid_phone' | 'invalid_payload' | 'aliyun_error';
    };

export type SmsVerifyResult =
  | { ok: true; phone: string }
  | { ok: false; error: 'invalid_code' | 'expired' };

export class SmsAdapter {
  private readonly client: InstanceType<DysmsapiCtor> | null;
  private readonly codes = new Map<string, CodeEntry>();

  constructor(
    private readonly env: Env,
    private readonly logger: Logger,
  ) {
    const ready =
      env.ALIYUN_ACCESS_KEY_ID && env.ALIYUN_ACCESS_KEY_SECRET && env.ALIYUN_SMS_SIGN_NAME;
    if (!ready) {
      this.client = null;
      this.logger.warn(
        { kind: 'sms' },
        'sms: missing one or more credentials — adapter in read-only mode',
      );
      return;
    }
    // SDK Config + endpoint. The endpoint stays public-facing
    // (dysmsapi.aliyuncs.com); the alias domains for region-specific
    // routing aren't worth the extra cred indirection here.
    const config = new OpenApi.Config({
      accessKeyId: env.ALIYUN_ACCESS_KEY_ID,
      accessKeySecret: env.ALIYUN_ACCESS_KEY_SECRET,
      endpoint: 'dysmsapi.aliyuncs.com',
    });
    this.client = new Dysmsapi(config);
    this.logger.info(
      {
        kind: 'sms',
        signName: env.ALIYUN_SMS_SIGN_NAME,
        templateCode: env.ALIYUN_SMS_TEMPLATE_CODE,
      },
      'sms: adapter initialised',
    );
  }

  isReady(): boolean {
    return this.client !== null && Boolean(this.env.ALIYUN_SMS_TEMPLATE_CODE);
  }

  isAccountClosureReady(): boolean {
    return (
      this.client !== null &&
      Boolean(this.env.ALIYUN_SMS_ACCOUNT_CLOSURE_VERIFY_TEMPLATE_CODE) &&
      Boolean(this.env.ALIYUN_SMS_ACCOUNT_CLOSURE_COMPLETE_TEMPLATE_CODE)
    );
  }

  /**
   * Send a 6-digit verification code. Stamps the per-phone
   * sent-at-millis so a follow-up call within COOLDOWN_MS hits the
   * 'too_frequent' branch even if the prior code is still valid.
   */
  async sendCode(rawPhone: string): Promise<SmsSendResult> {
    const phone = rawPhone.trim();
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      return { ok: false, error: 'invalid_phone' };
    }
    if (!this.client || !this.env.ALIYUN_SMS_TEMPLATE_CODE) {
      return { ok: false, error: 'sms_not_configured' };
    }
    this.gc();
    const existing = this.codes.get(phone);
    if (existing && Date.now() - existing.sentAt < COOLDOWN_MS) {
      return { ok: false, error: 'too_frequent' };
    }
    const code = randomInt(100_000, 1_000_000).toString();
    try {
      // sendSms returns { body: SendSmsResponseBody } where the SDK
      // normalises Aliyun's raw `Code`/`Message`/`BizId`/`RequestId`
      // fields to camelCase. A 200 HTTP response is NOT delivery
      // success — `body.code === 'OK'` is. Common rejections:
      //   isv.SMS_SIGNATURE_ILLEGAL              — sign string wrong
      //   isv.SMS_TEMPLATE_ILLEGAL               — template code wrong
      //   isv.SMS_SIGN_NAME_NOT_MATCH_TEMPLATE   — sign + template not bound
      //   isv.MOBILE_NUMBER_ILLEGAL              — phone format wrong
      //   isv.AMOUNT_NOT_ENOUGH                  — account balance zero
      //   isv.DAY_LIMIT_CONTROL                  — daily send cap hit
      const resp = (await this.client.sendSms(
        new SendSmsRequest({
          phoneNumbers: phone,
          signName: this.env.ALIYUN_SMS_SIGN_NAME,
          templateCode: this.env.ALIYUN_SMS_TEMPLATE_CODE,
          templateParam: JSON.stringify({ code }),
        }),
      )) as { body?: { code?: string; message?: string; bizId?: string; requestId?: string } };
      const body = resp.body ?? {};
      if (body.code !== 'OK') {
        this.logger.error(
          {
            kind: 'sms',
            phone: maskPhone(phone),
            apiCode: body.code,
            requestId: body.requestId,
            signName: this.env.ALIYUN_SMS_SIGN_NAME,
            templateCode: this.env.ALIYUN_SMS_TEMPLATE_CODE,
          },
          'sms: aliyun rejected (200 with non-OK Code)',
        );
        return {
          ok: false,
          error: 'aliyun_error',
        };
      }
      this.logger.info(
        { kind: 'sms', phone: maskPhone(phone), bizId: body.bizId, requestId: body.requestId },
        'sms: aliyun accepted (code=OK)',
      );
    } catch {
      this.logger.error({ kind: 'sms', phone: maskPhone(phone) }, 'sms: aliyun sendSms threw');
      return {
        ok: false,
        error: 'aliyun_error',
      };
    }
    const now = Date.now();
    this.codes.set(phone, { code, sentAt: now, expiresAt: now + TTL_MS });
    this.logger.info({ kind: 'sms', phone: maskPhone(phone) }, 'sms: code dispatched');
    return { ok: true, cooldownMs: COOLDOWN_MS };
  }

  async sendAccountClosureCode(
    rawPhone: string,
    code: string,
    action: 'begin' | 'cancel',
  ): Promise<SmsDeliveryResult> {
    const phone = rawPhone.trim();
    if (!/^1[3-9]\d{9}$/.test(phone)) return { ok: false, error: 'invalid_phone' };
    if (!/^\d{6}$/.test(code)) return { ok: false, error: 'invalid_payload' };
    const templateCode = this.env.ALIYUN_SMS_ACCOUNT_CLOSURE_VERIFY_TEMPLATE_CODE;
    if (!this.client || !templateCode) return { ok: false, error: 'sms_not_configured' };
    return this.sendDelivery(phone, templateCode, {
      code,
      action: action === 'begin' ? '关闭账号' : '撤回账号关闭',
    });
  }

  async sendAccountClosureComplete(
    rawPhone: string,
    receiptNumber: string,
  ): Promise<SmsDeliveryResult> {
    const phone = rawPhone.trim();
    if (!/^1[3-9]\d{9}$/.test(phone)) return { ok: false, error: 'invalid_phone' };
    if (receiptNumber.length < 1 || receiptNumber.length > 32) {
      return { ok: false, error: 'invalid_payload' };
    }
    const templateCode = this.env.ALIYUN_SMS_ACCOUNT_CLOSURE_COMPLETE_TEMPLATE_CODE;
    if (!this.client || !templateCode) return { ok: false, error: 'sms_not_configured' };
    return this.sendDelivery(phone, templateCode, { receiptNumber });
  }

  /**
   * Validate the code. Single-use: a successful match deletes the
   * entry so a second verify with the same code returns
   * 'invalid_code'.
   */
  verifyCode(rawPhone: string, code: string): SmsVerifyResult {
    const phone = rawPhone.trim();
    this.gc();
    const entry = this.codes.get(phone);
    if (!entry) return { ok: false, error: 'invalid_code' };
    if (Date.now() > entry.expiresAt) {
      this.codes.delete(phone);
      return { ok: false, error: 'expired' };
    }
    if (entry.code !== code.trim()) {
      return { ok: false, error: 'invalid_code' };
    }
    this.codes.delete(phone);
    return { ok: true, phone };
  }

  private async sendDelivery(
    phone: string,
    templateCode: string,
    templateParams: Record<string, string>,
  ): Promise<SmsDeliveryResult> {
    if (!this.client) return { ok: false, error: 'sms_not_configured' };
    try {
      const response = (await this.client.sendSms(
        new SendSmsRequest({
          phoneNumbers: phone,
          signName: this.env.ALIYUN_SMS_SIGN_NAME,
          templateCode,
          templateParam: JSON.stringify(templateParams),
        }),
      )) as { body?: { code?: string; requestId?: string } };
      if (response.body?.code !== 'OK') {
        this.logger.error(
          {
            kind: 'account_closure_sms',
            phone: maskPhone(phone),
            apiCode: response.body?.code,
            requestId: response.body?.requestId,
            templateCode,
          },
          'sms: account closure delivery rejected',
        );
        return { ok: false, error: 'aliyun_error' };
      }
      this.logger.info(
        { kind: 'account_closure_sms', phone: maskPhone(phone), templateCode },
        'sms: account closure delivery accepted',
      );
      return { ok: true };
    } catch {
      this.logger.error(
        { kind: 'account_closure_sms', phone: maskPhone(phone), templateCode },
        'sms: account closure delivery failed',
      );
      return { ok: false, error: 'aliyun_error' };
    }
  }

  /** Drop expired entries to keep the map bounded. */
  private gc(): void {
    const now = Date.now();
    for (const [k, v] of this.codes.entries()) {
      if (now > v.expiresAt) this.codes.delete(k);
    }
  }
}

function maskPhone(p: string): string {
  return p.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2');
}
