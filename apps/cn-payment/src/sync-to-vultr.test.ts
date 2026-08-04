import type { Logger } from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from './config/env.js';
import { VultrSync, deriveBase } from './sync-to-vultr.js';

function makeEnv(url: string): Env {
  return {
    NODE_ENV: 'test',
    PORT: 4010,
    LOG_LEVEL: 'silent',
    PUBLIC_ORIGIN: 'https://hd-pay.orangebench.tech',
    APP_ORIGIN: 'https://holaday.ai',
    VULTR_INTERNAL_URL: url,
    INTERNAL_SHARED_SECRET: '0123456789abcdef',
    ALIPAY_MODE: 'sandbox',
    VULTR_SYNC_TIMEOUT_MS: 3_500,
  };
}

function makeLogger(): Logger {
  return {
    error: vi.fn(),
    info: vi.fn(),
  } as unknown as Logger;
}

describe('VultrSync partner bridge', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('derives the Vultr base from the legacy confirm URL', () => {
    expect(deriveBase('https://holaday.ai/api/internal/payment/confirm')).toBe(
      'https://holaday.ai',
    );
    expect(deriveBase('https://holaday.ai/api/internal/payment/confirm?ignored=1')).toBe(
      'https://holaday.ai',
    );
    expect(deriveBase('https://holaday.ai')).toBe('https://holaday.ai');
    expect(deriveBase('https://holaday.ai/')).toBe('https://holaday.ai');
  });

  it('checks the authenticated Vultr payment bridge health endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 'ok', paymentBridge: 'ready' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const sync = new VultrSync(
      makeEnv('https://holaday.ai/api/internal/payment/confirm'),
      makeLogger(),
    );

    await expect(sync.health()).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://holaday.ai/api/internal/payment/health',
      expect.objectContaining({
        headers: { 'x-internal-secret': '0123456789abcdef' },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('fails bridge health when Vultr does not return the ready contract', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ status: 'ok' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const sync = new VultrSync(
      makeEnv('https://holaday.ai/api/internal/payment/confirm'),
      makeLogger(),
    );

    await expect(sync.health()).resolves.toEqual({
      ok: false,
      reason: 'unexpected bridge health response',
    });
  });

  it('posts partner confirmations to the partner ledger endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const sync = new VultrSync(
      makeEnv('https://holaday.ai/api/internal/payment/confirm'),
      makeLogger(),
    );

    await expect(
      sync.confirmPartner({
        provider: 'wechat',
        orderExternalId: 'pr_ord_123',
        providerCaptureId: 'wx_cap_123',
        amountCnyCents: 99900,
      }),
    ).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://holaday.ai/api/internal/partner-payment/confirm',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-internal-secret': '0123456789abcdef',
        },
        body: JSON.stringify({
          provider: 'wechat',
          orderExternalId: 'pr_ord_123',
          providerCaptureId: 'wx_cap_123',
          amountCnyCents: 99900,
        }),
      }),
    );
  });
});
