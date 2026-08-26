import { type Server, createServer } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { googleLogin, phoneLogin } = vi.hoisted(() => {
  const authResult = {
    current: {
      user: {
        externalId: 'usr_closure_http',
        email: 'private@example.com',
        plan: 'pro',
        displayName: null,
        avatarUrl: null,
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
      },
      closureRecoveryRequired: true as const,
      recoveryToken: 'recovery-secret-token',
      closureStatus: 'pending_grace' as const,
    },
  };
  return {
    googleLogin: vi.fn(async () => authResult.current),
    phoneLogin: vi.fn(async () => authResult.current),
  };
});

vi.mock('./auth/service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./auth/service.js')>();
  return {
    ...actual,
    AuthService: vi.fn(() => ({
      loginOrRegisterByGoogle: googleLogin,
      loginOrRegisterByPhone: phoneLogin,
    })),
  };
});

import { logger } from './config/logger.js';
import { createHttpApp } from './http.js';

let server: Server | null = null;
const realFetch = globalThis.fetch;

async function startServer(): Promise<string> {
  const app = createHttpApp({ planner: {} as never });
  const activeServer = createServer(app);
  server = activeServer;
  await new Promise<void>((resolve) => activeServer.listen(0, '127.0.0.1', resolve));
  const address = activeServer.address();
  if (!address || typeof address === 'string') throw new Error('server has no TCP address');
  return `http://127.0.0.1:${address.port}`;
}

describe('account-closure authentication HTTP handoffs', () => {
  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = 'google-client-test';
    process.env.GOOGLE_CLIENT_SECRET = 'google-secret-test';
    process.env.INTERNAL_SHARED_SECRET = 'internal-secret-test';
    vi.spyOn(logger, 'info').mockImplementation(() => logger);
    vi.spyOn(logger, 'error').mockImplementation(() => logger);
    vi.spyOn(logger, 'warn').mockImplementation(() => logger);
    googleLogin.mockClear();
    phoneLogin.mockClear();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(process.env, 'GOOGLE_CLIENT_ID');
    Reflect.deleteProperty(process.env, 'GOOGLE_CLIENT_SECRET');
    Reflect.deleteProperty(process.env, 'INTERNAL_SHARED_SECRET');
    await new Promise<void>((resolve, reject) => {
      if (!server) return resolve();
      if (!server.listening) return resolve();
      server.close((error) => (error ? reject(error) : resolve()));
    });
    server = null;
  });

  it('hands Google recovery back in an isolated closure fragment without logging identity data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url === 'https://oauth2.googleapis.com/token') {
          return new Response(JSON.stringify({ access_token: 'google-access-secret' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        if (url === 'https://openidconnect.googleapis.com/v1/userinfo') {
          return new Response(
            JSON.stringify({
              sub: 'google-private-subject',
              email: 'private@example.com',
              email_verified: true,
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        throw new Error(`unexpected mocked fetch URL: ${url}`);
      }),
    );
    const base = await startServer();

    const response = await realFetch(`${base}/auth/google/callback?code=code&state=state-123`, {
      redirect: 'manual',
      headers: { cookie: 'holaday_oauth_state=state-123' },
    });

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/login#closure=recovery-secret-token');
    expect(googleLogin).toHaveBeenCalledTimes(1);
    const logs = JSON.stringify(vi.mocked(logger.info).mock.calls);
    expect(logs).not.toContain('private@example.com');
    expect(logs).not.toContain('google-private-subject');
    expect(logs).not.toContain('recovery-secret-token');
    expect(logs).not.toContain('acl_req');
  });

  it('relays SMS recovery unchanged without logging phone or credential identifiers', async () => {
    const base = await startServer();

    const response = await realFetch(`${base}/internal/auth/sms-login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-secret': 'internal-secret-test',
      },
      body: JSON.stringify({ phone: '13800138000' }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      closureRecoveryRequired: true,
      recoveryToken: 'recovery-secret-token',
      closureStatus: 'pending_grace',
    });
    expect(phoneLogin).toHaveBeenCalledWith('13800138000');
    const logs = JSON.stringify(vi.mocked(logger.info).mock.calls);
    expect(logs).not.toContain('13800138000');
    expect(logs).not.toContain('recovery-secret-token');
    expect(logs).not.toContain('acl_req');
  });
});
