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

export interface EmailSender {
  send(opts: { to: string; subject: string; text: string }): Promise<void>;
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

export class EmailCodeError extends Error {
  constructor(
    message: string,
    public readonly code: 'COOLDOWN' | 'EXPIRED' | 'MISMATCH' | 'MISSING',
  ) {
    super(message);
  }
}

export interface EmailCodeService {
  sendCode(email: string): Promise<{ cooldownMs: number }>;
  verifyCode(email: string, code: string): Promise<void>;
  /** Test helper — never ship to prod routes. */
  _peek(email: string): Entry | undefined;
}

export function createEmailCodeService(sender: EmailSender = resendSender): EmailCodeService {
  return {
    async sendCode(email) {
      const normalized = email.trim().toLowerCase();
      const existing = store.get(normalized);
      if (existing && Date.now() - existing.createdAt < RESEND_COOLDOWN_MS) {
        throw new EmailCodeError('请稍候再重新发送验证码', 'COOLDOWN');
      }
      const code = genCode();
      store.set(normalized, { code, createdAt: Date.now(), attempts: 0 });
      try {
        await sender.send({
          to: normalized,
          subject: 'HOLA DAY 登录验证码',
          text: `你的验证码是：${code}\n\n5 分钟内有效。如果这不是你本人操作，请忽略此邮件。`,
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

    async verifyCode(email, code) {
      const normalized = email.trim().toLowerCase();
      const entry = store.get(normalized);
      if (!entry) throw new EmailCodeError('请先获取验证码', 'MISSING');
      if (Date.now() - entry.createdAt > CODE_TTL_MS) {
        store.delete(normalized);
        throw new EmailCodeError('验证码已过期', 'EXPIRED');
      }
      entry.attempts += 1;
      if (entry.attempts > 5) {
        store.delete(normalized);
        throw new EmailCodeError('尝试次数过多，请重新发送验证码', 'EXPIRED');
      }
      if (entry.code !== code.trim()) {
        throw new EmailCodeError('验证码不正确', 'MISMATCH');
      }
      // Single-use: consume on success.
      store.delete(normalized);
    },

    _peek(email) {
      return store.get(email.trim().toLowerCase());
    },
  };
}
