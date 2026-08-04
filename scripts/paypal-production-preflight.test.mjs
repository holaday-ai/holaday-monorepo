import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyPayPalProduction } from './paypal-production-preflight.mjs';

const completeEnv = {
  PAYPAL_ENABLED: 'true',
  PAYPAL_ENV: 'live',
  PAYPAL_CLIENT_ID: 'client-id',
  PAYPAL_CLIENT_SECRET: 'client-secret',
  PAYPAL_WEBHOOK_ID: 'WH-123',
};

const productionWebhook = 'https://hd-app.orangebench.tech/api/payment/paypal/webhook';

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

test('passes when PayPal is completely disabled', async () => {
  let requested = false;
  const result = await verifyPayPalProduction({ PAYPAL_ENV: 'sandbox' }, async () => {
    requested = true;
    return response(500, {});
  });

  assert.deepEqual(result, { status: 'disabled', environment: 'sandbox' });
  assert.equal(requested, false);
});

test('honours an explicit disable switch even when legacy live credentials remain', async () => {
  let requested = false;
  const result = await verifyPayPalProduction(
    {
      ...completeEnv,
      PAYPAL_ENABLED: 'false',
    },
    async () => {
      requested = true;
      return response(500, {});
    },
  );

  assert.deepEqual(result, { status: 'disabled', environment: 'live' });
  assert.equal(requested, false);
});

test('rejects partial live configuration before making a request', async () => {
  await assert.rejects(
    verifyPayPalProduction(
      {
        PAYPAL_ENABLED: 'true',
        PAYPAL_ENV: 'live',
        PAYPAL_CLIENT_ID: 'client-id',
        PAYPAL_CLIENT_SECRET: 'client-secret',
      },
      async () => response(200, {}),
    ),
    /missing PAYPAL_WEBHOOK_ID/,
  );
});

test('rejects a configured sandbox account for a production deployment', async () => {
  let requested = false;

  await assert.rejects(
    verifyPayPalProduction(
      {
        ...completeEnv,
        PAYPAL_ENV: 'sandbox',
      },
      async () => {
        requested = true;
        return response(200, {});
      },
    ),
    /PAYPAL_ENV must be live for production deployment/,
  );

  assert.equal(requested, false);
});

test('rejects invalid OAuth credentials without exposing them', async () => {
  await assert.rejects(
    verifyPayPalProduction(completeEnv, async () => response(401, {})),
    (error) => {
      assert.match(error.message, /OAuth returned HTTP 401/);
      assert.doesNotMatch(error.message, /client-secret/);
      return true;
    },
  );
});

test('rejects a webhook without capture completion events', async () => {
  const replies = [
    response(200, { access_token: 'access-token' }),
    response(200, {
      url: productionWebhook,
      event_types: [{ name: 'CHECKOUT.ORDER.APPROVED' }],
    }),
  ];

  await assert.rejects(
    verifyPayPalProduction(completeEnv, async () => replies.shift()),
    /webhook is not subscribed to PAYMENT\.CAPTURE\.COMPLETED/,
  );
});

test('rejects a webhook registered to an unapproved URL', async () => {
  const replies = [
    response(200, { access_token: 'access-token' }),
    response(200, {
      url: 'https://example.com/paypal/webhook',
      event_types: [{ name: 'PAYMENT.CAPTURE.COMPLETED' }],
    }),
  ];

  await assert.rejects(
    verifyPayPalProduction(completeEnv, async () => replies.shift()),
    /webhook URL does not match an approved Holaday production endpoint/,
  );
});

test('passes valid credentials and capture webhook configuration', async () => {
  const requests = [];
  const replies = [
    response(200, { access_token: 'access-token' }),
    response(200, {
      url: productionWebhook,
      event_types: [{ name: 'PAYMENT.CAPTURE.COMPLETED' }],
    }),
  ];
  const result = await verifyPayPalProduction(completeEnv, async (url, options) => {
    requests.push({ url, options });
    return replies.shift();
  });

  assert.deepEqual(result, { status: 'ready', environment: 'live' });
  assert.equal(requests.length, 2);
  assert.match(requests[0].url, /api-m\.paypal\.com\/v1\/oauth2\/token$/);
  assert.match(requests[1].url, /v1\/notifications\/webhooks\/WH-123$/);
});
