import { pathToFileURL } from 'node:url';

const REQUIRED_CAPTURE_EVENT = 'PAYMENT.CAPTURE.COMPLETED';
const DEFAULT_ALLOWED_WEBHOOK_URLS = [
  'https://holaday.ai/api/payment/paypal/webhook',
  'https://hd-app.orangebench.tech/api/payment/paypal/webhook',
];

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function fail(message) {
  throw new Error(`PayPal production preflight failed: ${message}`);
}

function normalizeWebhookUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      return null;
    }
    const pathname = url.pathname.replace(/\/+$/, '') || '/';
    return `${url.origin}${pathname}`;
  } catch {
    return null;
  }
}

function allowedWebhookUrls(env) {
  const configured = env.PAYPAL_ALLOWED_WEBHOOK_URLS;
  const candidates = nonEmpty(configured)
    ? configured
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
    : DEFAULT_ALLOWED_WEBHOOK_URLS;
  const normalized = candidates.map(normalizeWebhookUrl);
  if (normalized.some((value) => value === null) || normalized.length === 0) {
    fail('PAYPAL_ALLOWED_WEBHOOK_URLS must contain valid HTTPS URLs');
  }
  return new Set(normalized);
}

export async function verifyPayPalProduction(env = process.env, fetchImpl = globalThis.fetch) {
  const paypalEnv = (env.PAYPAL_ENV || 'sandbox').trim().toLowerCase();
  if ((env.PAYPAL_ENABLED || '').trim().toLowerCase() !== 'true') {
    return { status: 'disabled', environment: paypalEnv };
  }
  const clientId = env.PAYPAL_CLIENT_ID?.trim() || '';
  const clientSecret = env.PAYPAL_CLIENT_SECRET?.trim() || '';
  const webhookId = env.PAYPAL_WEBHOOK_ID?.trim() || '';
  const configured =
    paypalEnv === 'live' || nonEmpty(clientId) || nonEmpty(clientSecret) || nonEmpty(webhookId);

  if (!configured) {
    return { status: 'disabled', environment: paypalEnv };
  }

  if (paypalEnv !== 'live') {
    fail('PAYPAL_ENV must be live for production deployment');
  }

  const missing = [];
  if (!nonEmpty(clientId)) missing.push('PAYPAL_CLIENT_ID');
  if (!nonEmpty(clientSecret)) missing.push('PAYPAL_CLIENT_SECRET');
  if (!nonEmpty(webhookId)) missing.push('PAYPAL_WEBHOOK_ID');
  if (missing.length > 0) {
    fail(`missing ${missing.join(', ')}`);
  }

  if (typeof fetchImpl !== 'function') {
    fail('Node fetch is unavailable');
  }

  const baseUrl = 'https://api-m.paypal.com';
  const timeoutMs = Number(env.PAYPAL_PREFLIGHT_TIMEOUT_MS || 10_000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const tokenResponse = await fetchImpl(`${baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
      signal: controller.signal,
    });
    if (!tokenResponse.ok) {
      fail(`OAuth returned HTTP ${tokenResponse.status}`);
    }

    const tokenPayload = await tokenResponse.json();
    if (!nonEmpty(tokenPayload?.access_token)) {
      fail('OAuth response did not include an access token');
    }

    const webhookResponse = await fetchImpl(
      `${baseUrl}/v1/notifications/webhooks/${encodeURIComponent(webhookId)}`,
      {
        headers: { Authorization: `Bearer ${tokenPayload.access_token}` },
        signal: controller.signal,
      },
    );
    if (!webhookResponse.ok) {
      fail(`webhook lookup returned HTTP ${webhookResponse.status}`);
    }

    const webhook = await webhookResponse.json();
    const webhookUrl = normalizeWebhookUrl(webhook?.url);
    if (!webhookUrl || !allowedWebhookUrls(env).has(webhookUrl)) {
      fail('webhook URL does not match an approved Holaday production endpoint');
    }
    const eventNames = Array.isArray(webhook?.event_types)
      ? webhook.event_types.map((event) => event?.name).filter(Boolean)
      : [];
    if (!eventNames.includes('*') && !eventNames.includes(REQUIRED_CAPTURE_EVENT)) {
      fail(`webhook is not subscribed to ${REQUIRED_CAPTURE_EVENT}`);
    }

    return { status: 'ready', environment: paypalEnv };
  } catch (error) {
    if (error?.name === 'AbortError') {
      fail(`request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  try {
    const result = await verifyPayPalProduction();
    console.log(`PAYPAL_PREFLIGHT=${result.status} environment=${result.environment}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'PayPal production preflight failed');
    process.exitCode = 1;
  }
}

if (!process.argv[1] || import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
