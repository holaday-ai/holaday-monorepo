import { pathToFileURL } from 'node:url';

const DEFAULT_EXPECTED_AMOUNT_CENTS = 2900;
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_HEALTH_ATTEMPTS = 3;
const DEFAULT_HEALTH_RETRY_MS = 1000;

function fail(message) {
  throw new Error(`CN payment production preflight failed: ${message}`);
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function requiredConfig(env) {
  const required = ['CN_PAYMENT_URL', 'INTERNAL_SHARED_SECRET'];
  const missing = required.filter((name) => !nonEmpty(env[name]));
  if (missing.length > 0) {
    fail(`missing ${missing.join(', ')}`);
  }

  let gatewayUrl;
  try {
    gatewayUrl = new URL(env.CN_PAYMENT_URL);
  } catch {
    fail('CN_PAYMENT_URL is not a valid URL');
  }
  if (gatewayUrl.protocol !== 'https:') {
    fail('CN_PAYMENT_URL must use HTTPS');
  }

  return {
    gatewayUrl: gatewayUrl.toString().replace(/\/$/, ''),
    secret: env.INTERNAL_SHARED_SECRET,
  };
}

function positiveInteger(value, fallback, label) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    fail(`${label} must be a positive integer`);
  }
  return parsed;
}

function nonNegativeInteger(value, fallback, label) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    fail(`${label} must be a non-negative integer`);
  }
  return parsed;
}

async function requestJson(fetchImpl, url, options, label) {
  let response;
  try {
    response = await fetchImpl(url, options);
  } catch (error) {
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
      fail(`${label} timed out`);
    }
    fail(`${label} could not be reached`);
  }

  if (!response?.ok) {
    fail(`${label} returned HTTP ${response?.status ?? 'unknown'}`);
  }

  try {
    return await response.json();
  } catch {
    fail(`${label} returned invalid JSON`);
  }
}

function validateGatewayHealth(health) {
  if (health?.status !== 'ok') {
    fail('gateway health check is not ok');
  }
  if (health?.providers?.wechat !== 'ready') {
    fail('WeChat provider is not ready');
  }
  if (health?.providers?.alipay !== 'ready') {
    fail('Alipay provider is not ready');
  }
  if (!['platform_certificate', 'public_key'].includes(health?.callbackVerification?.wechat)) {
    fail('WeChat callback verification is not ready');
  }
  if (health?.bridge !== 'ready') {
    fail('Vultr settlement bridge is not ready');
  }
}

async function requestHealthyGateway(fetchImpl, url, timeoutMs, attempts, retryMs) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const health = await requestJson(
        fetchImpl,
        url,
        { signal: AbortSignal.timeout(timeoutMs) },
        'gateway health check',
      );
      validateGatewayHealth(health);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < attempts && retryMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, retryMs));
      }
    }
  }
  throw lastError;
}

function validateWechatOrder(order, expectedAmountCents) {
  if (order?.provider !== 'wechat' || !nonEmpty(order?.outTradeNo)) {
    fail('WeChat order response is invalid');
  }
  if (order.amountCents !== expectedAmountCents) {
    fail('WeChat order amount mismatch');
  }
  if (!nonEmpty(order.codeUrl) || !order.codeUrl.startsWith('weixin://wxpay/')) {
    fail('WeChat order did not return a valid Native payment URL');
  }
}

function validateAlipayOrder(order, expectedAmountCents) {
  if (order?.provider !== 'alipay' || !nonEmpty(order?.outTradeNo)) {
    fail('Alipay order response is invalid');
  }
  if (order.amountCents !== expectedAmountCents) {
    fail('Alipay order amount mismatch');
  }

  let payUrl;
  try {
    payUrl = new URL(order.payUrl);
  } catch {
    fail('Alipay order did not return a valid payment URL');
  }
  const isOfficialCheckoutHost =
    payUrl.hostname === 'alipay.com' || payUrl.hostname.endsWith('.alipay.com');
  if (
    payUrl.protocol !== 'https:' ||
    !isOfficialCheckoutHost ||
    payUrl.hostname === 'openapi.alipay.com' ||
    payUrl.username !== '' ||
    payUrl.password !== '' ||
    payUrl.port !== ''
  ) {
    fail('Alipay order did not return a browser-facing checkout URL');
  }
}

export async function verifyCnPaymentProduction(env = process.env, fetchImpl = fetch) {
  const { gatewayUrl, secret } = requiredConfig(env);
  const expectedAmountCents = positiveInteger(
    env.CN_PAYMENT_PREFLIGHT_EXPECTED_AMOUNT_CENTS,
    DEFAULT_EXPECTED_AMOUNT_CENTS,
    'CN_PAYMENT_PREFLIGHT_EXPECTED_AMOUNT_CENTS',
  );
  const timeoutMs = positiveInteger(
    env.CN_PAYMENT_PREFLIGHT_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS,
    'CN_PAYMENT_PREFLIGHT_TIMEOUT_MS',
  );
  const healthAttempts = positiveInteger(
    env.CN_PAYMENT_PREFLIGHT_HEALTH_ATTEMPTS,
    DEFAULT_HEALTH_ATTEMPTS,
    'CN_PAYMENT_PREFLIGHT_HEALTH_ATTEMPTS',
  );
  const healthRetryMs = nonNegativeInteger(
    env.CN_PAYMENT_PREFLIGHT_HEALTH_RETRY_MS,
    DEFAULT_HEALTH_RETRY_MS,
    'CN_PAYMENT_PREFLIGHT_HEALTH_RETRY_MS',
  );

  await requestHealthyGateway(
    fetchImpl,
    `${gatewayUrl}/healthz`,
    timeoutMs,
    healthAttempts,
    healthRetryMs,
  );

  const orderBody = {
    userId: 'production-payment-preflight',
    purchase: {
      kind: 'subscription',
      planId: 'basic',
      cycle: 'monthly',
      isFirstMonth: false,
    },
  };
  const createOrder = (provider) =>
    requestJson(
      fetchImpl,
      `${gatewayUrl}/payment/create`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Secret': secret,
        },
        body: JSON.stringify({ ...orderBody, provider }),
        signal: AbortSignal.timeout(timeoutMs),
      },
      `${provider} order creation`,
    );

  const wechatOrder = await createOrder('wechat');
  validateWechatOrder(wechatOrder, expectedAmountCents);
  const alipayOrder = await createOrder('alipay');
  validateAlipayOrder(alipayOrder, expectedAmountCents);

  return {
    status: 'ready',
    wechat: 'ready',
    alipay: 'ready',
    amountCents: expectedAmountCents,
  };
}

async function main() {
  try {
    const result = await verifyCnPaymentProduction();
    console.log(
      `CN_PAYMENT_PREFLIGHT=${result.status} wechat=${result.wechat} alipay=${result.alipay} amountCents=${result.amountCents}`,
    );
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : 'CN payment production preflight failed',
    );
    process.exitCode = 1;
  }
}

if (!process.argv[1] || import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
