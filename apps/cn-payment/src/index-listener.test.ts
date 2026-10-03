import type { Server } from 'node:http';
import express from 'express';
import { expect, it, vi } from 'vitest';

// No credentials or external requests: exercise the real application listener.
vi.mock('./config/env.js', () => ({
  loadEnv: () => ({
    NODE_ENV: 'test',
    PORT: 0,
    LOG_LEVEL: 'silent',
    APP_ORIGIN: 'https://app.test',
    ALIPAY_MODE: 'production',
    ALIYUN_SMS_ACCOUNT_CLOSURE_ENABLED: false,
    VULTR_SYNC_TIMEOUT_MS: 3500,
    PUBLIC_ORIGIN: 'https://pay.test',
    INTERNAL_SHARED_SECRET: 'cn-listener-test-secret',
    VULTR_INTERNAL_URL: 'http://127.0.0.1:1',
  }),
}));

it('binds the gateway only to IPv4 loopback so remote clients must use nginx', async () => {
  const listen = vi.spyOn(express.application, 'listen');
  let server: Server | undefined;
  try {
    await import('./index.js');
    await vi.waitFor(() => {
      server = listen.mock.results[0]?.value as Server | undefined;
      expect(server?.listening).toBe(true);
    });
    const address = server?.address();
    expect(address).toMatchObject({ address: '127.0.0.1', family: 'IPv4' });
    if (!address || typeof address === 'string') throw new Error('missing TCP listener');
    // Unknown GET has no provider/bridge side effects; proves loopback remains usable.
    const response = await fetch(`http://127.0.0.1:${address.port}/__listener_test__`, {
      signal: AbortSignal.timeout(2000),
    });
    expect(response.status).toBe(404);
    await response.text();
  } finally {
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server?.close((error) => (error ? reject(error) : resolve())),
      );
    }
    listen.mockRestore();
  }
});
