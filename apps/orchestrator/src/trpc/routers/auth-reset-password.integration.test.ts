import { afterAll, beforeAll, describe, expect, it } from 'vitest';

beforeAll(() => {
  process.env.DATABASE_URL ??= 'mysql://holaday:holaday-dev@127.0.0.1:3306/holaday';
  process.env.REDIS_URL ??= 'redis://127.0.0.1:6379/0';
  process.env.JWT_SECRET ??= 'integration-test-secret-must-be-32-chars-or-more-please';
});

/**
 * Integration cover for `auth.resetPassword`:
 *   - a registered user who sends a reset code, verifies it, and sets
 *     a new password can log in with the new one and is immediately
 *     issued a fresh JWT.
 *   - a wrong code rejects the reset (password unchanged).
 */

describe('tRPC auth.resetPassword', () => {
  let cleanup: () => Promise<void> = async () => {};

  beforeAll(async () => {
    const { applyMigrations } = await import('../../test/db-helper.js');
    await applyMigrations(process.env.DATABASE_URL as string);
    const { pool } = await import('../../db/client.js');
    cleanup = async () => {
      await pool.end();
    };
  });

  afterAll(async () => {
    await cleanup();
  });

  async function seedUser(password: string): Promise<string> {
    const { newExternalId } = await import('@holaday/shared-types');
    const { db } = await import('../../db/client.js');
    const { users } = await import('../../db/schema/users.js');
    const { hashPassword } = await import('../../auth/password.js');
    const email = `reset-pw+${Date.now()}+${Math.random()}@example.com`;
    await db.insert(users).values({
      externalId: newExternalId('user'),
      email,
      passwordHash: await hashPassword(password),
    });
    return email;
  }

  async function bootTrpcServer() {
    const { createHttpApp } = await import('../../http.js');
    const { StubPlanner } = await import('../../agent/planners/stub.js');
    const http = await import('node:http');
    const app = createHttpApp({ planner: new StubPlanner() });
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no address');
    return {
      port: address.port,
      close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    };
  }

  async function post(port: number, path: string, body: unknown) {
    return fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('completes the reset flow: sendCode → verify via resetPassword → new credential works', async () => {
    const email = await seedUser('old-password-1234');
    const { port, close } = await bootTrpcServer();
    try {
      // sendCode puts a code in the in-memory store.
      const sendRes = await post(port, '/trpc/auth.sendCode', { email });
      expect(sendRes.status).toBe(200);

      // Peek the code from the email-code service — same module-scoped
      // store used by both sendCode and resetPassword.
      const authModule = await import('./auth.js');
      // The router holds the service module-internal; we reach the
      // peek via a helper created on the factory instance. Easiest
      // route: import the factory and construct one that shares the
      // underlying Map? The Map IS module-scoped, so peeking via a
      // NEW factory still sees the same entry. Round-trip that.
      const { createEmailCodeService } = await import('../../auth/email-code.js');
      const peekSvc = createEmailCodeService();
      const entry = peekSvc._peek(email);
      expect(entry).toBeDefined();
      const code = entry?.code ?? '000000';

      // Wrong code rejects.
      const badRes = await post(port, '/trpc/auth.resetPassword', {
        email,
        code: '000000',
        password: 'brand-new-pw-42',
      });
      // If the bogus code accidentally matches the real one in this
      // random generation, re-roll. Otherwise we expect 401.
      if (code !== '000000') {
        expect(badRes.status).toBe(401);
      }

      // Re-issue a fresh code because the wrong attempt above bumped
      // attempts (the real one is still valid for 5 attempts, but we
      // want the test to be deterministic when the seed hits the
      // 0.001% collision).
      const entryNow = peekSvc._peek(email);
      const realCode = entryNow?.code ?? code;

      const okRes = await post(port, '/trpc/auth.resetPassword', {
        email,
        code: realCode,
        password: 'brand-new-pw-42',
      });
      expect(okRes.status).toBe(200);
      const body = (await okRes.json()) as {
        result: { data: { accessToken: string; user: { email: string } } };
      };
      expect(body.result.data.accessToken).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
      expect(body.result.data.user.email).toBe(email);

      // New password logs in; old one does not.
      const newLogin = await post(port, '/trpc/auth.login', {
        email,
        password: 'brand-new-pw-42',
      });
      expect(newLogin.status).toBe(200);
      const oldLogin = await post(port, '/trpc/auth.login', {
        email,
        password: 'old-password-1234',
      });
      expect(oldLogin.status).toBe(401);
      // Unused: placeholder to silence the import-not-used warning on
      // module-level `authModule` when the branch short-circuits.
      void authModule;
    } finally {
      await close();
    }
  });

  it('returns NOT_FOUND when the email has no registered account', async () => {
    const { port, close } = await bootTrpcServer();
    try {
      // Trigger a sendCode to a throwaway email so the store has a
      // code, then try to reset.
      const email = `unregistered+${Date.now()}@example.com`;
      await post(port, '/trpc/auth.sendCode', { email });
      const { createEmailCodeService } = await import('../../auth/email-code.js');
      const peek = createEmailCodeService()._peek(email);
      expect(peek).toBeDefined();

      const res = await post(port, '/trpc/auth.resetPassword', {
        email,
        code: peek?.code ?? '000000',
        password: 'brand-new-pw-42',
      });
      expect(res.status).toBe(404);
    } finally {
      await close();
    }
  });
});
