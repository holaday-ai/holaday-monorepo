import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  app,
  routes,
  smsClosureCodeSpy,
  smsClosureCompleteSpy,
  smsSendCodeSpy,
  syncConfirmSpy,
  wechatCreateSpy,
  wechatNotifySpy,
} = vi.hoisted(() => {
  const routes = new Map<string, (req: unknown, res: unknown) => unknown>();
  const app = {
    use: vi.fn(),
    get: vi.fn((path: string, handler: (req: unknown, res: unknown) => unknown) => {
      routes.set(`GET ${path}`, handler);
    }),
    post: vi.fn((path: string, handler: (req: unknown, res: unknown) => unknown) => {
      routes.set(`POST ${path}`, handler);
    }),
    listen: vi.fn((_port: number, callback: () => void) => {
      callback();
      return { close: vi.fn() };
    }),
  };
  return {
    app,
    routes,
    smsClosureCodeSpy: vi.fn(async () => ({ ok: true })),
    smsClosureCompleteSpy: vi.fn(async () => ({ ok: true })),
    smsSendCodeSpy: vi.fn(async () => ({ ok: true, cooldownMs: 60_000 })),
    syncConfirmSpy: vi.fn<() => Promise<{ ok: true } | { ok: false; reason: string }>>(
      async () => ({ ok: true }),
    ),
    wechatCreateSpy: vi.fn(async (input: { outTradeNo: string }) => ({
      outTradeNo: input.outTradeNo,
      codeUrl: 'weixin://wxpay/test',
    })),
    wechatNotifySpy: vi.fn(),
  };
});

vi.mock('express', () => {
  const express = vi.fn(() => app) as unknown as {
    (): typeof app;
    json: ReturnType<typeof vi.fn>;
    text: ReturnType<typeof vi.fn>;
    urlencoded: ReturnType<typeof vi.fn>;
  };
  express.json = vi.fn(() => vi.fn());
  express.text = vi.fn(() => vi.fn());
  express.urlencoded = vi.fn(() => vi.fn());
  return { default: express };
});

vi.mock('pino-http', () => ({
  pinoHttp: vi.fn(() => vi.fn()),
}));

vi.mock('./config/env.js', () => ({
  loadEnv: vi.fn(() => ({
    NODE_ENV: 'test',
    PORT: 0,
    PUBLIC_ORIGIN: 'https://pay.test',
    INTERNAL_SHARED_SECRET: 'cn-test-secret',
    VULTR_INTERNAL_URL: 'https://holaday.test/api/internal/payment/confirm',
  })),
}));

vi.mock('./config/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  },
}));

vi.mock('./wechat-pay.js', () => ({
  WechatPayAdapter: vi.fn(() => ({
    init: vi.fn(async () => {}),
    isReady: vi.fn(() => true),
    why: vi.fn(() => ''),
    createNativeOrder: wechatCreateSpy,
    verifyAndDecryptNotify: wechatNotifySpy,
  })),
}));

vi.mock('./alipay.js', () => ({
  AlipayAdapter: vi.fn(() => ({
    init: vi.fn(),
    isReady: vi.fn(() => true),
    why: vi.fn(() => ''),
    createPagePayUrl: vi.fn(),
    verifyNotify: vi.fn(() => true),
    parseNotifyBody: vi.fn(),
  })),
}));

vi.mock('./sms.js', () => ({
  SmsAdapter: vi.fn(() => ({
    isReady: vi.fn(() => true),
    sendCode: smsSendCodeSpy,
    verifyCode: vi.fn(),
    sendAccountClosureCode: smsClosureCodeSpy,
    sendAccountClosureComplete: smsClosureCompleteSpy,
  })),
}));

vi.mock('./sync-to-vultr.js', () => ({
  VultrSync: vi.fn(() => ({
    confirm: syncConfirmSpy,
    confirmPartner: vi.fn(async () => ({ ok: true })),
    smsLogin: vi.fn(),
  })),
}));

function makeResponse() {
  const state: { status: number; body: unknown } = { status: 200, body: undefined };
  const response = {
    status(code: number) {
      state.status = code;
      return response;
    },
    json(body: unknown) {
      state.body = body;
      return response;
    },
    send(body: unknown) {
      state.body = body;
      return response;
    },
  };
  return { response, state };
}

await import('./index.js');
await vi.waitFor(() => {
  expect(routes.has('POST /payment/create')).toBe(true);
  expect(routes.has('POST /payment/wechat/notify')).toBe(true);
});

describe('CN first-month qualification propagation', () => {
  beforeEach(() => {
    syncConfirmSpy.mockClear();
    wechatCreateSpy.mockClear();
    wechatNotifySpy.mockReset();
  });

  it('places isFirstMonth in the provider-signed subscription attach', async () => {
    const handler = routes.get('POST /payment/create');
    if (!handler) throw new Error('create route was not registered');
    const { response, state } = makeResponse();

    await handler(
      {
        headers: { 'x-internal-secret': 'cn-test-secret' },
        body: {
          provider: 'wechat',
          userId: 'usr_cn_test',
          purchase: {
            kind: 'subscription',
            planId: 'pro',
            cycle: 'monthly',
            isFirstMonth: true,
          },
        },
      },
      response,
    );

    expect(state.status).toBe(200);
    const providerInput = wechatCreateSpy.mock.calls[0]?.[0] as { attach?: string };
    expect(JSON.parse(providerInput.attach ?? '{}')).toMatchObject({
      kind: 'subscription',
      userId: 'usr_cn_test',
      planId: 'pro',
      cycle: 'monthly',
      isFirstMonth: true,
    });
  });

  it('forwards isFirstMonth from a verified provider notification to Vultr', async () => {
    wechatNotifySpy.mockResolvedValueOnce({
      outTradeNo: 'pay_cn_first',
      transactionId: 'wx_txn_first',
      amountCents: 4900,
      tradeState: 'SUCCESS',
      attach: JSON.stringify({
        kind: 'subscription',
        userId: 'usr_cn_test',
        planId: 'pro',
        cycle: 'monthly',
        isFirstMonth: true,
      }),
    });
    const handler = routes.get('POST /payment/wechat/notify');
    if (!handler) throw new Error('wechat notify route was not registered');
    const { response, state } = makeResponse();

    await handler({ headers: {}, body: '{"signed":"payload"}' }, response);

    expect(state.status).toBe(200);
    expect(syncConfirmSpy).toHaveBeenCalledWith({
      provider: 'wechat',
      userId: 'usr_cn_test',
      planId: 'pro',
      cycle: 'monthly',
      outTradeNo: 'pay_cn_first',
      transactionId: 'wx_txn_first',
      amountCents: 4900,
      kind: 'subscription',
      isFirstMonth: true,
    });
  });

  it('asks WeChat to retry when Vultr did not persist the settlement', async () => {
    syncConfirmSpy.mockResolvedValueOnce({
      ok: false,
      reason: 'vultr 500: internal_error',
    });
    wechatNotifySpy.mockResolvedValueOnce({
      outTradeNo: 'pay_cn_retry',
      transactionId: 'wx_txn_retry',
      amountCents: 4900,
      tradeState: 'SUCCESS',
      attach: JSON.stringify({
        kind: 'subscription',
        userId: 'usr_cn_test',
        planId: 'pro',
        cycle: 'monthly',
        isFirstMonth: true,
      }),
    });
    const handler = routes.get('POST /payment/wechat/notify');
    if (!handler) throw new Error('wechat notify route was not registered');
    const { response, state } = makeResponse();

    await handler({ headers: {}, body: '{"signed":"payload"}' }, response);

    expect(state.status).toBe(401);
    expect(state.body).toEqual({
      code: 'FAIL',
      message: 'verification failed',
    });
  });
});

describe('account-closure SMS routes', () => {
  beforeEach(() => {
    smsClosureCodeSpy.mockClear();
    smsClosureCompleteSpy.mockClear();
    smsSendCodeSpy.mockClear();
  });

  it.each([undefined, 'wrong-secret'])(
    'rejects closure-code delivery with secret %s',
    async (secret) => {
      const handler = routes.get('POST /api/internal/account-closure/code');
      if (!handler) throw new Error('closure code route was not registered');
      const { response, state } = makeResponse();

      await handler(
        {
          headers: secret === undefined ? {} : { 'x-internal-secret': secret },
          body: { phone: '13800138000', code: '482901', action: 'begin' },
        },
        response,
      );

      expect(state).toEqual({ status: 401, body: { error: 'unauthorized' } });
      expect(smsClosureCodeSpy).not.toHaveBeenCalled();
    },
  );

  it('authenticates before parsing a rejected closure payload', async () => {
    const handler = routes.get('POST /api/internal/account-closure/code');
    if (!handler) throw new Error('closure code route was not registered');
    const { response, state } = makeResponse();

    await handler({ headers: {}, body: { rejected: 'private payload' } }, response);

    expect(state).toEqual({ status: 401, body: { error: 'unauthorized' } });
    expect(smsClosureCodeSpy).not.toHaveBeenCalled();
  });

  it('accepts an authenticated, strictly-shaped closure-code delivery request', async () => {
    const handler = routes.get('POST /api/internal/account-closure/code');
    if (!handler) throw new Error('closure code route was not registered');
    const { response, state } = makeResponse();

    await handler(
      {
        headers: { 'x-internal-secret': 'cn-test-secret' },
        body: { phone: '13800138000', code: '482901', action: 'cancel' },
      },
      response,
    );

    expect(state).toEqual({ status: 202, body: { ok: true } });
    expect(smsClosureCodeSpy).toHaveBeenCalledWith('13800138000', '482901', 'cancel');
  });

  it('protects completion-receipt delivery with the same internal secret', async () => {
    const handler = routes.get('POST /api/internal/account-closure/complete');
    if (!handler) throw new Error('closure completion route was not registered');
    const unauthorized = makeResponse();
    await handler(
      { headers: {}, body: { phone: '13800138000', receiptNumber: 'ACL-RCPT-1' } },
      unauthorized.response,
    );
    expect(unauthorized.state.status).toBe(401);

    const accepted = makeResponse();
    await handler(
      {
        headers: { 'x-internal-secret': 'cn-test-secret' },
        body: { phone: '13800138000', receiptNumber: 'ACL-RCPT-1' },
      },
      accepted.response,
    );
    expect(accepted.state).toEqual({ status: 202, body: { ok: true } });
    expect(smsClosureCompleteSpy).toHaveBeenCalledWith('13800138000', 'ACL-RCPT-1');
  });

  it('rejects attempts to choose a closure action or code through the public send route', async () => {
    const handler = routes.get('POST /api/sms/send');
    if (!handler) throw new Error('public SMS send route was not registered');
    const { response, state } = makeResponse();

    await handler(
      {
        headers: {},
        body: { phone: '13800138000', code: '482901', action: 'begin' },
      },
      response,
    );

    expect(state).toEqual({ status: 400, body: { error: 'invalid_phone' } });
    expect(smsSendCodeSpy).not.toHaveBeenCalled();
    expect([...routes.keys()]).not.toContain('POST /api/sms/account-closure/verify');
  });
});
