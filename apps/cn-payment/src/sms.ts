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

import type { Logger } from 'pino';
// SDK ships as CJS with `exports.default = Client`. Under tsx + ESM
// resolution the default-import sometimes hands back the namespace
// object instead of the class, so reach into `.default` explicitly
// when present.
import * as DysmsapiNs from '@alicloud/dysmsapi20170525';
import { SendSmsRequest } from '@alicloud/dysmsapi20170525/dist/models/SendSmsRequest.js';
import * as OpenApi from '@alicloud/openapi-client';
import type { Env } from './config/env.js';

type DysmsapiCtor = new (config: InstanceType<typeof OpenApi.Config>) => {
  sendSms(req: InstanceType<typeof SendSmsRequest>): Promise<unknown>;
};
const Dysmsapi: DysmsapiCtor =
  (DysmsapiNs as unknown as { default?: DysmsapiCtor }).default ??
  (DysmsapiNs as unknown as DysmsapiCtor);

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
  | { ok: false; error: 'sms_not_configured' | 'invalid_phone' | 'too_frequent' | 'aliyun_error'; message?: string };

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
      env.ALIYUN_ACCESS_KEY_ID &&
      env.ALIYUN_ACCESS_KEY_SECRET &&
      env.ALIYUN_SMS_SIGN_NAME &&
      env.ALIYUN_SMS_TEMPLATE_CODE;
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
      { kind: 'sms', signName: env.ALIYUN_SMS_SIGN_NAME, templateCode: env.ALIYUN_SMS_TEMPLATE_CODE },
      'sms: adapter initialised',
    );
  }

  isReady(): boolean {
    return this.client !== null;
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
    if (!this.client) {
      return { ok: false, error: 'sms_not_configured' };
    }
    this.gc();
    const existing = this.codes.get(phone);
    if (existing && Date.now() - existing.sentAt < COOLDOWN_MS) {
      return { ok: false, error: 'too_frequent' };
    }
    const code = String(Math.floor(100000 + Math.random() * 900000));
    try {
      await this.client.sendSms(
        new SendSmsRequest({
          phoneNumbers: phone,
          signName: this.env.ALIYUN_SMS_SIGN_NAME,
          templateCode: this.env.ALIYUN_SMS_TEMPLATE_CODE,
          templateParam: JSON.stringify({ code }),
        }),
      );
    } catch (err) {
      this.logger.error(
        { kind: 'sms', err: err instanceof Error ? err.message : String(err), phone: maskPhone(phone) },
        'sms: aliyun sendSms threw',
      );
      return {
        ok: false,
        error: 'aliyun_error',
        message: err instanceof Error ? err.message : String(err),
      };
    }
    const now = Date.now();
    this.codes.set(phone, { code, sentAt: now, expiresAt: now + TTL_MS });
    this.logger.info(
      { kind: 'sms', phone: maskPhone(phone) },
      'sms: code dispatched',
    );
    return { ok: true, cooldownMs: COOLDOWN_MS };
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
