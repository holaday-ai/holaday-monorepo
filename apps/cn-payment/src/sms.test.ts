import { describe, expect, it, vi } from 'vitest';
import type { Env } from './config/env.js';
import { SmsAdapter } from './sms.js';

function makeAdapter() {
  const sendSms = vi.fn<
    (request: unknown) => Promise<{ body: { code: string; requestId: string } }>
  >(async () => ({ body: { code: 'OK', requestId: 'request-1' } }));
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const env = {
    NODE_ENV: 'test',
    PORT: 0,
    LOG_LEVEL: 'info',
    PUBLIC_ORIGIN: 'https://pay.test',
    APP_ORIGIN: 'https://app.test',
    VULTR_INTERNAL_URL: 'https://holaday.test',
    INTERNAL_SHARED_SECRET: 'test-secret-value',
    ALIPAY_MODE: 'sandbox',
    VULTR_SYNC_TIMEOUT_MS: 3500,
    ALIYUN_ACCESS_KEY_ID: 'access-key',
    ALIYUN_ACCESS_KEY_SECRET: 'access-secret',
    ALIYUN_SMS_SIGN_NAME: 'HOLA DAY',
    ALIYUN_SMS_TEMPLATE_CODE: 'LOGIN_TEMPLATE',
    ALIYUN_SMS_ACCOUNT_CLOSURE_VERIFY_TEMPLATE_CODE: 'CLOSURE_VERIFY_TEMPLATE',
    ALIYUN_SMS_ACCOUNT_CLOSURE_COMPLETE_TEMPLATE_CODE: 'CLOSURE_COMPLETE_TEMPLATE',
  } as Env;
  const adapter = new SmsAdapter(env, logger as never);
  (adapter as unknown as { client: { sendSms: typeof sendSms } }).client = { sendSms };
  return { adapter, sendSms, logger };
}

describe('SmsAdapter account-closure isolation', () => {
  it('generates public login codes with crypto.randomInt', async () => {
    const { adapter, sendSms } = makeAdapter();
    const mathSpy = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random must not generate verification codes');
    });

    await expect(adapter.sendCode('13800138000')).resolves.toMatchObject({ ok: true });

    expect(mathSpy).not.toHaveBeenCalled();
    const request = sendSms.mock.calls[0]?.[0] as { templateParam?: string };
    expect(JSON.parse(request.templateParam ?? '{}').code).toMatch(/^\d{6}$/);
    mathSpy.mockRestore();
  });

  it('uses the dedicated closure template and never stores a supplied closure code', async () => {
    const { adapter, sendSms, logger } = makeAdapter();

    await expect(
      adapter.sendAccountClosureCode('13800138000', '654321', 'begin'),
    ).resolves.toMatchObject({ ok: true });

    const request = sendSms.mock.calls[0]?.[0] as {
      phoneNumbers?: string;
      templateCode?: string;
      templateParam?: string;
    };
    expect(request).toMatchObject({
      phoneNumbers: '13800138000',
      templateCode: 'CLOSURE_VERIFY_TEMPLATE',
    });
    expect(JSON.parse(request.templateParam ?? '{}').code).toBe('654321');
    expect(adapter.verifyCode('13800138000', '654321')).toEqual({
      ok: false,
      error: 'invalid_code',
    });
    const logged = JSON.stringify([
      ...logger.info.mock.calls,
      ...logger.warn.mock.calls,
      ...logger.error.mock.calls,
    ]);
    expect(logged).not.toContain('13800138000');
    expect(logged).not.toContain('654321');
  });

  it('uses a distinct completion template without falling back to login', async () => {
    const { adapter, sendSms } = makeAdapter();

    await expect(
      adapter.sendAccountClosureComplete('13900139000', 'ACL-RCPT-77'),
    ).resolves.toMatchObject({ ok: true });

    const request = sendSms.mock.calls[0]?.[0] as {
      templateCode?: string;
      templateParam?: string;
    };
    expect(request.templateCode).toBe('CLOSURE_COMPLETE_TEMPLATE');
    expect(JSON.parse(request.templateParam ?? '{}')).toEqual({ receiptNumber: 'ACL-RCPT-77' });
  });
});
