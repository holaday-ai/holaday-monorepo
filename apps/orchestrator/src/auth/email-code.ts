/**
 * Email verification-code store + Resend delivery.
 *
 * Storage: in-memory Map, keyed by email. Fine for a single-instance
 * deploy; a multi-instance future would need Redis here. Codes expire
 * 5 minutes after generation; resends are throttled server-side to
 * once per 60 s (the frontend enforces the same window, but never
 * trust the frontend for rate-limit).
 *
 * Delivery: when RESEND_API_KEY is set, calls Resend's /emails
 * endpoint. In dev / unconfigured prod, the code is logged so the
 * operator can still test the flow.
 */
import { randomInt } from 'node:crypto';
import { logger } from '../config/logger.js';

export const CODE_LENGTH = 6;
export const CODE_TTL_MS = 5 * 60 * 1000;
export const RESEND_COOLDOWN_MS = 60 * 1000;

interface Entry {
  code: string;
  createdAt: number;
  attempts: number;
}

const store = new Map<string, Entry>();

export type EmailCodePurpose = 'login' | 'password-change';

function storeKey(email: string, purpose: EmailCodePurpose): string {
  return `${purpose}:${email.trim().toLowerCase()}`;
}

function emailCopy(purpose: EmailCodePurpose, code: string): { subject: string; text: string } {
  if (purpose === 'password-change') {
    return {
      subject: 'HOLA DAY 修改密码验证码',
      text: `你的修改密码验证码是：${code}\n\n5 分钟内有效。如果这不是你本人操作，请立即忽略此邮件。`,
    };
  }
  return {
    subject: 'HOLA DAY 登录验证码',
    text: `你的验证码是：${code}\n\n5 分钟内有效。如果这不是你本人操作，请忽略此邮件。`,
  };
}

function genCode(): string {
  // crypto.randomInt is the only stdlib RNG with cryptographic
  // guarantees on Node. Math.random() is a deterministic PRNG seeded
  // off process start state — predictable enough that an attacker
  // who can observe a few codes could narrow the next one. Email
  // verification codes don't need bank-grade entropy, but neither do
  // they need to be guessable.
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) out += randomInt(0, 10).toString();
  return out;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailSender {
  send(opts: EmailMessage): Promise<void>;
}

export interface PrivateEmailSender extends EmailSender {
  readonly privateDelivery: true;
  isAvailable(): boolean;
}

/**
 * Real Resend sender. Exported so the router can DI a fake in tests.
 * Uses the Resend HTTP API directly — no SDK dep.
 */
export const resendSender: EmailSender = {
  async send({ to, subject, text }) {
    const key = process.env.RESEND_API_KEY;
    if (!key) {
      logger.info({ to, subject, text }, 'email-code: RESEND_API_KEY unset, logging only');
      return;
    }
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL ?? 'HOLA DAY <noreply@holaday.ai>',
        to: [to],
        subject,
        text,
      }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Resend failed: ${resp.status} ${body.slice(0, 200)}`);
    }
  },
};

/**
 * Private-delivery Resend adapter for messages that must never enter the
 * ordinary development fallback. Absence or rejection of the real provider
 * fails closed with a content-free error and produces no local message log.
 */
export const privateResendSender: PrivateEmailSender = {
  privateDelivery: true,

  isAvailable() {
    return Boolean(process.env.RESEND_API_KEY);
  },

  async send({ to, subject, text }) {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error('Private email delivery unavailable');
    let response: Response;
    try {
      response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          from: process.env.RESEND_FROM_EMAIL ?? 'HOLA DAY <noreply@holaday.ai>',
          to: [to],
          subject,
          text,
        }),
      });
    } catch {
      throw new Error('Private email delivery failed');
    }
    if (!response.ok) throw new Error('Private email delivery failed');
  },
};

export class EmailCodeError extends Error {
  constructor(
    message: string,
    public readonly code: 'COOLDOWN' | 'EXPIRED' | 'MISMATCH' | 'MISSING',
  ) {
    super(message);
  }
}

export interface EmailCodeService {
  sendCode(email: string, purpose?: EmailCodePurpose): Promise<{ cooldownMs: number }>;
  verifyCode(email: string, code: string, purpose?: EmailCodePurpose): Promise<void>;
  /** Test helper — never ship to prod routes. */
  _peek(email: string, purpose?: EmailCodePurpose): Entry | undefined;
}

export function createEmailCodeService(sender: EmailSender = resendSender): EmailCodeService {
  return {
    async sendCode(email, purpose = 'login') {
      const normalized = email.trim().toLowerCase();
      const key = storeKey(normalized, purpose);
      const existing = store.get(key);
      if (existing && Date.now() - existing.createdAt < RESEND_COOLDOWN_MS) {
        throw new EmailCodeError('请稍候再重新发送验证码', 'COOLDOWN');
      }
      const code = genCode();
      store.set(key, { code, createdAt: Date.now(), attempts: 0 });
      const copy = emailCopy(purpose, code);
      try {
        await sender.send({
          to: normalized,
          subject: copy.subject,
          text: copy.text,
        });
      } catch (err) {
        // Leave the code in the store so a retry doesn't regenerate
        // (the user may still have received the previous mail); log
        // the delivery failure.
        logger.error(
          { email: normalized, err: err instanceof Error ? err.message : String(err) },
          'email-code: delivery failed',
        );
        throw err;
      }
      return { cooldownMs: RESEND_COOLDOWN_MS };
    },

    async verifyCode(email, code, purpose = 'login') {
      const normalized = email.trim().toLowerCase();
      const key = storeKey(normalized, purpose);
      const entry = store.get(key);
      if (!entry) throw new EmailCodeError('请先获取验证码', 'MISSING');
      if (Date.now() - entry.createdAt > CODE_TTL_MS) {
        store.delete(key);
        throw new EmailCodeError('验证码已过期', 'EXPIRED');
      }
      entry.attempts += 1;
      if (entry.attempts > 5) {
        store.delete(key);
        throw new EmailCodeError('尝试次数过多，请重新发送验证码', 'EXPIRED');
      }
      if (entry.code !== code.trim()) {
        throw new EmailCodeError('验证码不正确', 'MISMATCH');
      }
      // Single-use: consume on success.
      store.delete(key);
    },

    _peek(email, purpose = 'login') {
      return store.get(storeKey(email, purpose));
    },
  };
}
