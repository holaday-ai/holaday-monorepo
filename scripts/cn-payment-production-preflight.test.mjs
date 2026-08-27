import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyCnPaymentProduction } from './cn-payment-production-preflight.mjs';

const completeEnv = {
  CN_PAYMENT_URL: 'https://hd-pay.orangebench.tech',
  INTERNAL_SHARED_SECRET: 'internal-secret',
  CN_PAYMENT_PREFLIGHT_HEALTH_ATTEMPTS: '1',
  CN_PAYMENT_PREFLIGHT_HEALTH_RETRY_MS: '1',
};

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

test('rejects missing production gateway configuration before making a request', async () => {
  let requested = false;

  await assert.rejects(
    verifyCnPaymentProduction({}, async () => {
      requested = true;
      return response(200, {});
    }),
    /missing CN_PAYMENT_URL, INTERNAL_SHARED_SECRET/,
  );

  assert.equal(requested, false);
});

test('rejects a non-HTTPS payment gateway', async () => {
  await assert.rejects(
    verifyCnPaymentProduction(
      { ...completeEnv, CN_PAYMENT_URL: 'http://hd-pay.orangebench.tech' },
      async () => response(200, {}),
    ),
    /CN_PAYMENT_URL must use HTTPS/,
  );
});

test('fails closed when either provider is not ready', async () => {
  await assert.rejects(
    verifyCnPaymentProduction(completeEnv, async () =>
      response(200, {
        status: 'ok',
        providers: { wechat: 'ready', alipay: 'unconfigured: missing credentials' },
      }),
    ),
    /Alipay provider is not ready/,
  );
});

test('fails closed when the Vultr settlement bridge is not ready', async () => {
  await assert.rejects(
    verifyCnPaymentProduction(completeEnv, async () =>
      response(200, {
        status: 'ok',
        providers: { wechat: 'ready', alipay: 'ready' },
        callbackVerification: { wechat: 'public_key' },
        bridge: 'unavailable: upstream rejected health check',
      }),
    ),
    /Vultr settlement bridge is not ready/,
  );
});

test('fails closed when WeChat callback verification is not confirmed', async () => {
  await assert.rejects(
    verifyCnPaymentProduction(completeEnv, async () =>
      response(200, {
        status: 'ok',
        providers: { wechat: 'ready', alipay: 'ready' },
        bridge: 'ready',
      }),
    ),
    /WeChat callback verification is not ready/,
  );
});

test('retries a transient health GET without repeating either payment order', async () => {
  let healthAttempts = 0;
  const orderProviders = [];

  const result = await verifyCnPaymentProduction(
    {
      ...completeEnv,
      CN_PAYMENT_PREFLIGHT_HEALTH_ATTEMPTS: '2',
    },
    async (url, options = {}) => {
      if (url.endsWith('/healthz')) {
        healthAttempts += 1;
        if (healthAttempts === 1) {
          throw new TypeError('temporary network failure');
        }
        return response(200, {
          status: 'ok',
          providers: { wechat: 'ready', alipay: 'ready' },
          callbackVerification: { wechat: 'public_key' },
          bridge: 'ready',
        });
      }

      const provider = JSON.parse(options.body).provider;
      orderProviders.push(provider);
      if (provider === 'wechat') {
        return response(200, {
          provider: 'wechat',
          outTradeNo: 'pay_wechat',
          codeUrl: 'weixin://wxpay/bizpayurl?pr=secret-token',
          amountCents: 2900,
        });
      }
      return response(200, {
        provider: 'alipay',
        outTradeNo: 'pay_alipay',
        payUrl: 'https://unitradeprod.alipay.com/pay/checkout.htm?token=secret-token',
        amountCents: 2900,
      });
    },
  );

  assert.equal(result.status, 'ready');
  assert.equal(healthAttempts, 2);
  assert.deepEqual(orderProviders, ['wechat', 'alipay']);
});

test('rejects a provider order with the wrong amount', async () => {
  const replies = [
    response(200, {
      status: 'ok',
      providers: { wechat: 'ready', alipay: 'ready' },
      callbackVerification: { wechat: 'public_key' },
      bridge: 'ready',
    }),
    response(200, {
      provider: 'wechat',
      outTradeNo: 'pay_wechat',
      codeUrl: 'weixin://wxpay/bizpayurl?pr=secret-token',
      amountCents: 1,
    }),
  ];

  await assert.rejects(
    verifyCnPaymentProduction(completeEnv, async () => replies.shift()),
    /WeChat order amount mismatch/,
  );
});

test('creates real unpaid orders for both providers without exposing payment tokens', async () => {
  const requests = [];
  const replies = [
    response(200, {
      status: 'ok',
      providers: { wechat: 'ready', alipay: 'ready' },
      callbackVerification: { wechat: 'platform_certificate' },
      bridge: 'ready',
    }),
    response(200, {
      provider: 'wechat',
      outTradeNo: 'pay_wechat',
      codeUrl: 'weixin://wxpay/bizpayurl?pr=secret-token',
      amountCents: 2900,
    }),
    response(200, {
      provider: 'alipay',
      outTradeNo: 'pay_alipay',
      payUrl: 'https://unitradeprod.alipay.com/pay/checkout.htm?token=secret-token',
      amountCents: 2900,
    }),
  ];

  const result = await verifyCnPaymentProduction(completeEnv, async (url, options) => {
    requests.push({ url, options });
    return replies.shift();
  });

  assert.deepEqual(result, {
    status: 'ready',
    wechat: 'ready',
    alipay: 'ready',
    amountCents: 2900,
  });
  assert.equal(requests.length, 3);
  assert.equal(requests[0].url, 'https://hd-pay.orangebench.tech/healthz');
  for (const request of requests.slice(1)) {
    assert.equal(request.url, 'https://hd-pay.orangebench.tech/payment/create');
    assert.equal(request.options.headers['X-Internal-Secret'], 'internal-secret');
    const body = JSON.parse(request.options.body);
    assert.deepEqual(body.purchase, {
      kind: 'subscription',
      planId: 'basic',
      cycle: 'monthly',
      isFirstMonth: false,
    });
  }
  assert.doesNotMatch(JSON.stringify(result), /secret-token|secret-signature|internal-secret/);
});

test('rejects an Alipay order that still exposes the API gateway to the browser', async () => {
  const replies = [
    response(200, {
      status: 'ok',
      providers: { wechat: 'ready', alipay: 'ready' },
      callbackVerification: { wechat: 'public_key' },
      bridge: 'ready',
    }),
    response(200, {
      provider: 'wechat',
      outTradeNo: 'pay_wechat',
      codeUrl: 'weixin://wxpay/bizpayurl?pr=secret-token',
      amountCents: 2900,
    }),
    response(200, {
      provider: 'alipay',
      outTradeNo: 'pay_alipay',
      payUrl: 'https://openapi.alipay.com/gateway.do?sign=secret-signature',
      amountCents: 2900,
    }),
  ];

  await assert.rejects(
    verifyCnPaymentProduction(completeEnv, async () => replies.shift()),
    /browser-facing checkout URL/,
  );
});

test('rejects an Alipay checkout URL with credentials or a non-default port', async () => {
  for (const payUrl of [
    'https://user:secret@unitradeprod.alipay.com/pay/checkout.htm',
    'https://unitradeprod.alipay.com:4443/pay/checkout.htm',
  ]) {
    const replies = [
      response(200, {
        status: 'ok',
        providers: { wechat: 'ready', alipay: 'ready' },
        callbackVerification: { wechat: 'public_key' },
        bridge: 'ready',
      }),
      response(200, {
        provider: 'wechat',
        outTradeNo: 'pay_wechat',
        codeUrl: 'weixin://wxpay/bizpayurl?pr=secret-token',
        amountCents: 2900,
      }),
      response(200, {
        provider: 'alipay',
        outTradeNo: 'pay_alipay',
        payUrl,
        amountCents: 2900,
      }),
    ];

    await assert.rejects(
      verifyCnPaymentProduction(completeEnv, async () => replies.shift()),
      /browser-facing checkout URL/,
    );
  }
});
