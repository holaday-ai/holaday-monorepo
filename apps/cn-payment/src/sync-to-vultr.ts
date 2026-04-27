/**
 * Bridge from the Aliyun gateway → Vultr orchestrator. After a
 * verified WX/Alipay notification, we POST the canonical fields to
 * Vultr's /api/internal/payment/confirm with the shared HMAC-style
 * secret in the X-Internal-Secret header.
 *
 * Idempotency: the receiver keys on (provider, transactionId) and
 * skips duplicates. Safe to retry on network blips.
 */

import type { Logger } from 'pino';
import type { Env } from './config/env.js';

export interface VultrConfirmPayload {
  userId: string;
  planId: 'basic' | 'pro';
  cycle: 'monthly' | 'yearly';
  /** 'wechat' | 'alipay' */
  provider: 'wechat' | 'alipay';
  transactionId: string;
  amountCents: number;
  /** 'subscription' | 'addon' — determines whether we extend plan or grant bonus tasks. */
  kind: 'subscription' | 'addon';
  /** present when kind='addon'; one of the AddonPackId values. */
  addonPackId?: string;
}

export class VultrSync {
  constructor(private readonly env: Env, private readonly logger: Logger) {}

  async confirm(payload: VultrConfirmPayload): Promise<{ ok: true } | { ok: false; reason: string }> {
    const url = this.env.VULTR_INTERNAL_URL;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-internal-secret': this.env.INTERNAL_SHARED_SECRET,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.text();
        this.logger.error(
          { status: res.status, body: body.slice(0, 400), payload },
          'sync: Vultr rejected confirm',
        );
        return { ok: false, reason: `vultr ${res.status}: ${body.slice(0, 200)}` };
      }
      this.logger.info({ payload }, 'sync: Vultr confirmed');
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error({ err: message, payload }, 'sync: Vultr POST threw');
      return { ok: false, reason: message };
    }
  }
}
