import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger as productionLogger } from '../config/logger.js';
import {
  CODE_LENGTH,
  CODE_TTL_MS,
  EmailCodeError,
  type EmailSender,
  createEmailCodeService,
  privateResendSender,
} from './email-code.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function fakeSender(): {
  sender: EmailSender;
  sent: Array<{ to: string; subject: string; text: string }>;
} {
  const sent: Array<{ to: string; subject: string; text: string }> = [];
  return {
    sender: {
      async send(opts) {
        sent.push(opts);
      },
    },
    sent,
  };
}

describe('createEmailCodeService', () => {
  it('sends a numeric code matching CODE_LENGTH and stores it for verify', async () => {
    const { sender, sent } = fakeSender();
    const svc = createEmailCodeService(sender);
    await svc.sendCode('user+foo@example.com');
    expect(sent).toHaveLength(1);
    const message = sent[0];
    if (!message) throw new Error('expected a verification email');
    const match = /(\d+)/.exec(message.text);
    expect(match?.[1]?.length).toBe(CODE_LENGTH);
    const entry = svc._peek('USER+FOO@EXAMPLE.COM');
    expect(entry?.code.length).toBe(CODE_LENGTH);
  });

  it('accepts the right code and consumes it (single-use)', async () => {
    const { sender } = fakeSender();
    const svc = createEmailCodeService(sender);
    await svc.sendCode('a@b.com');
    const entry = svc._peek('a@b.com');
    if (!entry) throw new Error('expected a stored verification code');
    await svc.verifyCode('a@b.com', entry.code);
    // Consumed: subsequent verify with the same code should now miss.
    await expect(svc.verifyCode('a@b.com', entry.code)).rejects.toThrow(/MISSING|先获取验证码/);
  });

  it('rejects wrong code with a MISMATCH error (without consuming the entry)', async () => {
    const { sender } = fakeSender();
    const svc = createEmailCodeService(sender);
    await svc.sendCode('a@b.com');
    await expect(svc.verifyCode('a@b.com', '000000')).rejects.toBeInstanceOf(EmailCodeError);
    expect(svc._peek('a@b.com')).toBeDefined();
  });

  it('resend inside the cooldown window is rejected with COOLDOWN', async () => {
    const { sender } = fakeSender();
    const svc = createEmailCodeService(sender);
    const fresh = `cooldown-${Date.now()}@test.local`;
    await svc.sendCode(fresh);
    await expect(svc.sendCode(fresh)).rejects.toBeInstanceOf(EmailCodeError);
  });

  it('expired codes are rejected with EXPIRED and cleared', async () => {
    const { sender } = fakeSender();
    const svc = createEmailCodeService(sender);
    await svc.sendCode('c@d.com');
    const entry = svc._peek('c@d.com');
    expect(entry).toBeDefined();
    if (!entry) throw new Error('expected a stored verification code');
    // Back-date the entry to simulate TTL expiry (white-box on purpose).
    entry.createdAt = Date.now() - (CODE_TTL_MS + 1_000);
    await expect(svc.verifyCode('c@d.com', entry.code)).rejects.toBeInstanceOf(EmailCodeError);
    // Expired entry is cleaned up.
    expect(svc._peek('c@d.com')).toBeUndefined();
  });

  it('too many wrong attempts lock the code out (brute-force guard)', async () => {
    const { sender } = fakeSender();
    const svc = createEmailCodeService(sender);
    await svc.sendCode('e@f.com');
    for (let i = 0; i < 5; i += 1) {
      await expect(svc.verifyCode('e@f.com', '123456')).rejects.toBeInstanceOf(EmailCodeError);
    }
    // 6th attempt trips the lockout and clears the entry.
    await expect(svc.verifyCode('e@f.com', '123456')).rejects.toBeInstanceOf(EmailCodeError);
    expect(svc._peek('e@f.com')).toBeUndefined();
  });

  it('keeps password-change codes separate from login codes', async () => {
    const { sender, sent } = fakeSender();
    const svc = createEmailCodeService(sender);
    const email = `purpose-${Date.now()}@test.local`;

    await svc.sendCode(email);
    await svc.sendCode(email, 'password-change');

    const loginCode = svc._peek(email)?.code;
    const passwordChangeCode = svc._peek(email, 'password-change')?.code;
    expect(loginCode).toMatch(/^\d{6}$/);
    expect(passwordChangeCode).toMatch(/^\d{6}$/);
    expect(sent[1]?.subject).toBe('HOLA DAY 修改密码验证码');
    expect(sent[1]?.text).toContain('修改密码');

    await svc.verifyCode(email, loginCode as string);
    await expect(svc.verifyCode(email, passwordChangeCode as string)).rejects.toMatchObject({
      code: 'MISSING',
    });
    expect(svc._peek(email, 'password-change')).toBeDefined();

    await svc.verifyCode(email, passwordChangeCode as string, 'password-change');
    expect(svc._peek(email, 'password-change')).toBeUndefined();
  });
});

describe('private email delivery', () => {
  it('fails closed without logging message content when the provider is unavailable', async () => {
    vi.stubEnv('RESEND_API_KEY', '');
    const capturedLogs: unknown[] = [];
    vi.spyOn(productionLogger, 'info').mockImplementation((...args: unknown[]) => {
      capturedLogs.push(args);
    });
    const message = {
      to: 'closure-owner@example.test',
      subject: 'Closure verification',
      text: 'Private code 482901',
    };

    let failure: unknown;
    try {
      await privateResendSender.send(message);
    } catch (error) {
      failure = error;
    }

    expect.soft(failure).toBeInstanceOf(Error);
    const serializedLogs = JSON.stringify(capturedLogs);
    expect(serializedLogs).not.toContain(message.to);
    expect(serializedLogs).not.toContain('482901');
  });

  it('uses the real private provider when it is available', async () => {
    vi.stubEnv('RESEND_API_KEY', 'private-resend-key');
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 202 }));
    vi.stubGlobal('fetch', fetchImpl);

    await expect(
      privateResendSender.send({
        to: 'closure-owner@example.test',
        subject: 'Closure verification',
        text: 'Private code 482901',
        idempotencyKey: 'ACR-random-notification-id',
      }),
    ).resolves.toBeUndefined();

    expect(privateResendSender.isAvailable()).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        method: 'POST',
        signal: expect.any(AbortSignal),
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer private-resend-key',
          'idempotency-key': 'ACR-random-notification-id',
        },
      }),
    );
  });

  it('combines caller cancellation with the private provider timeout', async () => {
    vi.stubEnv('RESEND_API_KEY', 'private-resend-key');
    let observedSignal: AbortSignal | undefined;
    let started!: () => void;
    const requestStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (_url, init) => {
        observedSignal = init?.signal ?? undefined;
        started();
        return new Promise<Response>((_resolve, reject) => {
          observedSignal?.addEventListener(
            'abort',
            () => reject(new DOMException('lease lost', 'AbortError')),
            { once: true },
          );
        });
      }),
    );
    const controller = new AbortController();
    const delivery = privateResendSender.send({
      to: 'closure-owner@example.test',
      subject: 'Closure complete',
      text: 'Receipt ACR-random',
      signal: controller.signal,
    });
    await requestStarted;
    controller.abort();

    await expect(delivery).rejects.toThrow('Private email delivery failed');
    expect(observedSignal).toBeInstanceOf(AbortSignal);
    expect(observedSignal?.aborted).toBe(true);
  });
});
