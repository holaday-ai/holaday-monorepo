import { describe, expect, it } from 'vitest';
import {
  CODE_LENGTH,
  CODE_TTL_MS,
  EmailCodeError,
  type EmailSender,
  createEmailCodeService,
} from './email-code.js';

function fakeSender(): { sender: EmailSender; sent: Array<{ to: string; text: string }> } {
  const sent: Array<{ to: string; text: string }> = [];
  return {
    sender: {
      async send(opts) {
        sent.push({ to: opts.to, text: opts.text });
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
    const match = /(\d+)/.exec(sent[0]!.text);
    expect(match?.[1]?.length).toBe(CODE_LENGTH);
    const entry = svc._peek('USER+FOO@EXAMPLE.COM');
    expect(entry?.code.length).toBe(CODE_LENGTH);
  });

  it('accepts the right code and consumes it (single-use)', async () => {
    const { sender } = fakeSender();
    const svc = createEmailCodeService(sender);
    await svc.sendCode('a@b.com');
    const entry = svc._peek('a@b.com');
    await svc.verifyCode('a@b.com', entry!.code);
    // Consumed: subsequent verify with the same code should now miss.
    await expect(svc.verifyCode('a@b.com', entry!.code)).rejects.toThrow(/MISSING|先获取验证码/);
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
    // Back-date the entry to simulate TTL expiry (white-box on purpose).
    entry!.createdAt = Date.now() - (CODE_TTL_MS + 1_000);
    await expect(svc.verifyCode('c@d.com', entry!.code)).rejects.toBeInstanceOf(EmailCodeError);
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
});
