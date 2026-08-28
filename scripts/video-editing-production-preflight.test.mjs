import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyVideoEditingProduction } from './video-editing-production-preflight.mjs';

const completeEnv = {
  VIDEO_EDITING_ENABLED: 'true',
  VIDEO_EDITING_PROVIDER: 'cesdk',
  VIDEO_EDITING_ALLOWLIST: 'synthetic-canary',
  CESDK_LICENSE: 'commercial-license-material',
  CESDK_LICENSED_HOSTNAMES: 'holaday.ai,hd-app.orangebench.tech,staging.holaday.internal',
  VIDEO_EDITING_STAGING_HOSTNAME: 'staging.holaday.internal',
};

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

test('reports the safe disabled state without probing production', async () => {
  let requested = false;
  let schemaChecked = false;
  const result = await verifyVideoEditingProduction(
    { VIDEO_EDITING_ENABLED: 'false' },
    {
      fetchImpl: async () => {
        requested = true;
        return response(500, {});
      },
      verifySchema: async () => {
        schemaChecked = true;
        return false;
      },
    },
  );

  assert.deepEqual(result, { status: 'production_disabled_pending_commercial_license' });
  assert.equal(requested, false);
  assert.equal(schemaChecked, false);
});

test('fails enablement for missing license, canary, hostname, or provider contract', async () => {
  for (const [field, value] of [
    ['CESDK_LICENSE', ''],
    ['VIDEO_EDITING_ALLOWLIST', ''],
    ['VIDEO_EDITING_STAGING_HOSTNAME', ''],
    ['VIDEO_EDITING_PROVIDER', 'other'],
  ]) {
    await assert.rejects(
      verifyVideoEditingProduction(
        { ...completeEnv, [field]: value },
        { fetchImpl: async () => response(200, { status: 'ok' }), verifySchema: async () => true },
      ),
      /production enablement blocked/,
    );
  }
});

test('requires production, app, and staging hostnames in the written license scope', async () => {
  await assert.rejects(
    verifyVideoEditingProduction(
      { ...completeEnv, CESDK_LICENSED_HOSTNAMES: 'holaday.ai,hd-app.orangebench.tech' },
      { fetchImpl: async () => response(200, { status: 'ok' }), verifySchema: async () => true },
    ),
    /licensed hostname scope is incomplete/,
  );
});

test('requires both editing migrations and green production health', async () => {
  await assert.rejects(
    verifyVideoEditingProduction(completeEnv, {
      fetchImpl: async () => response(200, { status: 'ok' }),
      verifySchema: async () => false,
    }),
    /schema 0053\/0054 is not verified/,
  );

  await assert.rejects(
    verifyVideoEditingProduction(completeEnv, {
      fetchImpl: async (url) => response(url.includes('orangebench') ? 503 : 200, { status: 'ok' }),
      verifySchema: async () => true,
    }),
    /health check failed/,
  );
});

test('passes only with the complete canary contract and never returns secrets', async () => {
  const requests = [];
  const result = await verifyVideoEditingProduction(completeEnv, {
    fetchImpl: async (url) => {
      requests.push(url);
      return response(200, { status: 'ok' });
    },
    verifySchema: async () => true,
  });

  assert.deepEqual(result, {
    status: 'ready_for_allowlisted_canary',
    provider: 'cesdk',
    licenseConfigured: true,
    licenseLength: completeEnv.CESDK_LICENSE.length,
    schema: '0053+0054',
    health: 'ok',
  });
  assert.deepEqual(requests, [
    'https://holaday.ai/api/healthz',
    'https://hd-app.orangebench.tech/api/healthz',
  ]);
  assert.doesNotMatch(
    JSON.stringify(result),
    /commercial-license-material|synthetic-canary|staging\.holaday\.internal/,
  );
});
