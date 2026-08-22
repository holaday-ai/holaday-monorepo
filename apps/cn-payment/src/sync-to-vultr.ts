/**
 * Bridge from the Aliyun gateway → Vultr orchestrator. After a
 * verified WX/Alipay notification, we POST the canonical fields to
 * either Vultr's legacy /api/internal/payment/confirm endpoint or
 * the partner ledger /api/internal/partner-payment/confirm endpoint
 * with the shared HMAC-style secret in the X-Internal-Secret header.
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
  /**
   * Per-order id we generated at create-time. The SPA polls
   * payment.cnStatus({ outTradeNo }), so the orchestrator needs
   * this stored on the payments row to satisfy that lookup.
   */
  outTradeNo: string;
  transactionId: string;
  amountCents: number;
  /** 'subscription' | 'addon' — determines whether we extend plan or grant bonus tasks. */
  kind: 'subscription' | 'addon';
  /** present when kind='addon'; one of the AddonPackId values. */
  addonPackId?: string;
}

export interface VultrPartnerConfirmPayload {
  provider: 'wechat' | 'alipay';
  orderExternalId: string;
  providerCaptureId: string;
  amountCnyCents: number;
}

/**
 * Phase 12 — payload returned by Vultr's /api/internal/auth/sms-login.
 * Mirrors the AuthService.AuthResult shape (sans server-internal
 * fields) so the gateway can hand it straight back to its caller.
 */
interface VultrSmsLoginUser {
  user: {
    externalId: string;
    email: string | null;
    plan: string;
    displayName: string | null;
    avatarUrl: string | null;
    createdAt: string | Date;
  };
}

export type VultrSmsLoginResult = VultrSmsLoginUser &
  ({ accessToken: string; mfaRequired?: false } | { mfaRequired: true; mfaToken: string });

export class VultrSync {
  constructor(
    private readonly env: Env,
    private readonly logger: Logger,
  ) {}

  async health(): Promise<{ ok: true } | { ok: false; reason: string }> {
    const base = deriveBase(this.env.VULTR_INTERNAL_URL);
    const url = `${base}/api/internal/payment/health`;
    try {
      const res = await fetch(url, {
        headers: { 'x-internal-secret': this.env.INTERNAL_SHARED_SECRET },
        signal: AbortSignal.timeout(this.env.VULTR_SYNC_TIMEOUT_MS),
      });
      if (!res.ok) {
        return { ok: false, reason: `vultr ${res.status}` };
      }
      const body = (await res.json()) as { status?: unknown; paymentBridge?: unknown };
      if (body.status !== 'ok' || body.paymentBridge !== 'ready') {
        return { ok: false, reason: 'unexpected bridge health response' };
      }
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error({ err: message }, 'sync: Vultr health check threw');
      return { ok: false, reason: message };
    }
  }

  async confirm(
    payload: VultrConfirmPayload,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const url = this.env.VULTR_INTERNAL_URL;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-internal-secret': this.env.INTERNAL_SHARED_SECRET,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.env.VULTR_SYNC_TIMEOUT_MS),
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

  async confirmPartner(
    payload: VultrPartnerConfirmPayload,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const base = deriveBase(this.env.VULTR_INTERNAL_URL);
    const url = `${base}/api/internal/partner-payment/confirm`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-internal-secret': this.env.INTERNAL_SHARED_SECRET,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.env.VULTR_SYNC_TIMEOUT_MS),
      });
      if (!res.ok) {
        const body = await res.text();
        this.logger.error(
          { status: res.status, body: body.slice(0, 400), payload },
          'sync: Vultr rejected partner confirm',
        );
        return { ok: false, reason: `vultr ${res.status}: ${body.slice(0, 200)}` };
      }
      this.logger.info({ payload }, 'sync: Vultr confirmed partner payment');
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error({ err: message, payload }, 'sync: Vultr partner POST threw');
      return { ok: false, reason: message };
    }
  }

  /**
   * Phase 12 — hand a verified phone over to Vultr's
   * /api/internal/auth/sms-login. Vultr upserts a user keyed on
   * the phone and signs a JWT; we relay the JWT + user payload
   * back to the SPA caller.
   *
   * The endpoint URL is derived from VULTR_INTERNAL_URL (which
   * currently points at /api/internal/payment/confirm) by swapping
   * the suffix. Keeps the env footprint to a single shared base
   * even though the routes diverge.
   */
  async smsLogin(
    phone: string,
  ): Promise<{ ok: true; result: VultrSmsLoginResult } | { ok: false; reason: string }> {
    const base = deriveBase(this.env.VULTR_INTERNAL_URL);
    const url = `${base}/api/internal/auth/sms-login`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-internal-secret': this.env.INTERNAL_SHARED_SECRET,
        },
        body: JSON.stringify({ phone }),
        signal: AbortSignal.timeout(this.env.VULTR_SYNC_TIMEOUT_MS),
      });
      const body = await res.text();
      if (!res.ok) {
        this.logger.error(
          { status: res.status, body: body.slice(0, 400) },
          'sync: Vultr sms-login rejected',
        );
        return { ok: false, reason: `vultr ${res.status}: ${body.slice(0, 200)}` };
      }
      const parsed = JSON.parse(body) as VultrSmsLoginResult;
      return { ok: true, result: parsed };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error({ err: message }, 'sync: Vultr sms-login POST threw');
      return { ok: false, reason: message };
    }
  }
}

/**
 * Strip the Vultr-confirm path suffix to derive the orchestrator
 * base URL. Lets a future endpoint share the same env without an
 * additional VULTR_*_URL field.
 */
export function deriveBase(fullConfirmUrl: string): string {
  const idx = fullConfirmUrl.indexOf('/api/internal/');
  if (idx >= 0) return fullConfirmUrl.slice(0, idx);
  // Fallback: trust the caller to have set a bare base if they
  // chose to. Log loudly though — divergence here means the smsLogin
  // path will 404.
  return fullConfirmUrl.replace(/\/$/, '');
}
