import type { AddressInfo } from 'node:net';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DB } from '../db/client.js';
import { users } from '../db/schema/users.js';
import { authRouter } from '../trpc/routers/auth.js';
import { signAccessToken, signStreamToken, verifyAccessToken } from './jwt.js';
import {
  authenticateAccessTokenSession,
  authenticateStreamOrAccessSession,
  revalidateAuthenticatedSession,
} from './middleware.js';
import { SESSION_CACHE_TTL_MS, issueSessionAccessToken } from './sessions.js';

afterEach(() => vi.useRealTimers());
function fixture() {
  const rows: { sid: string; userExternalId: string; expiresAt: Date; revokedAt?: Date }[] = [];
  const user = { externalId: 'usr_test', authVersion: 0, status: 'active', plan: 'free' };
  const makeDb = () =>
    ({
      insert: () => ({
        values: async (row: (typeof rows)[number]) => {
          rows.push(row);
        },
      }),
      select: () => ({
        from: (table: unknown) => ({
          where: (query: Parameters<MySqlDialect['sqlToQuery']>[0]) => ({
            limit: async () => {
              if (table === users) return [user];
              const { params } = new MySqlDialect().sqlToQuery(query);
              return rows.filter(
                (row) => params.includes(row.sid) && params.includes(row.userExternalId),
              );
            },
          }),
        }),
      }),
      update: (table: unknown) => ({
        set: (patch: { revokedAt?: Date }) => ({
          where: async (query: Parameters<MySqlDialect['sqlToQuery']>[0]) => {
            if (table === users) {
              user.authVersion++;
              return;
            }
            const { params } = new MySqlDialect().sqlToQuery(query);
            for (const row of rows)
              if (params.includes(row.sid) && params.includes(row.userExternalId))
                Object.assign(row, patch);
          },
        }),
      }),
    }) as unknown as DB;
  const db = makeDb();
  const issue = () =>
    issueSessionAccessToken(db, {
      sub: user.externalId,
      authVersion: user.authVersion,
      plan: 'free',
    });
  const caller = (token: string) =>
    authRouter.createCaller({
      db,
      userId: user.externalId,
      req: { header: () => `Bearer ${token}` },
    } as never);
  return { db, makeDb, issue, caller, rows, user };
}
describe('D10 current-device sessions', () => {
  it('logout revokes only the current bearer and its stream while another device and legacy token survive', async () => {
    const f = fixture();
    const first = await f.issue();
    const second = await f.issue();
    const legacy = await signAccessToken({ sub: f.user.externalId, plan: 'free', authVersion: 0 });
    const claims = await verifyAccessToken(first);
    expect(claims?.sid).toBeTruthy();
    expect((await verifyAccessToken(second))?.sid).not.toBe(claims?.sid);
    const session = await authenticateAccessTokenSession(f.db, first);
    expect(session).not.toBeNull();
    if (!session) throw new Error('expected a live session');
    const stream = await signStreamToken(f.user.externalId, 0, claims?.sid);
    expect(await authenticateStreamOrAccessSession(f.db, stream.token)).not.toBeNull();
    await f.caller(first).logout();
    expect(await authenticateAccessTokenSession(f.db, first)).toBeNull();
    expect(await authenticateStreamOrAccessSession(f.db, stream.token)).toBeNull();
    expect(await revalidateAuthenticatedSession(f.db, session)).toBe(false);
    const auth = await authenticateAccessTokenSession(f.db, first);
    const unauth = authRouter.createCaller({ db: f.db, userId: auth?.userId } as never);
    await expect(unauth.me()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(await authenticateAccessTokenSession(f.db, second)).not.toBeNull();
    expect(await authenticateAccessTokenSession(f.db, legacy)).not.toBeNull();
    expect(await f.caller(legacy).logout()).toMatchObject({ legacyToken: true });
    expect(await authenticateAccessTokenSession(f.db, second)).not.toBeNull();
  });
  it('other-process positive cache stops accepting a revoked session within 30 seconds', async () => {
    vi.useFakeTimers();
    const f = fixture();
    const token = await f.issue();
    const otherProcess = f.makeDb();
    expect(await authenticateAccessTokenSession(otherProcess, token)).not.toBeNull();
    await f.caller(token).logout();
    vi.advanceTimersByTime(SESSION_CACHE_TTL_MS + 1);
    expect(await authenticateAccessTokenSession(otherProcess, token)).toBeNull();
  });
  it('logoutAll bumps authVersion including legacy tokens', async () => {
    const f = fixture();
    const token = await f.issue();
    const second = await f.issue();
    const legacy = await signAccessToken({ sub: f.user.externalId, plan: 'free', authVersion: 0 });
    await f.caller(token).logoutAll();
    for (const value of [token, second, legacy])
      expect(await authenticateAccessTokenSession(f.db, value)).toBeNull();
  });
  it('returns HTTP 401 from auth.me for the same bearer after logout', async () => {
    const f = fixture();
    const token = await f.issue();
    await f.caller(token).logout();
    const app = express();
    app.use(
      '/auth',
      createExpressMiddleware({
        router: authRouter,
        createContext: async ({ req }) => {
          const header = req.header('authorization');
          const session = header
            ? await authenticateAccessTokenSession(f.db, header.slice(7))
            : null;
          return { db: f.db, req, userId: session?.userId } as never;
        },
      }),
    );
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    try {
      const response = await fetch(
        `http://127.0.0.1:${(server.address() as AddressInfo).port}/auth/me`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      expect(response.status).toBe(401);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
  it('refuses issuance when session persistence fails', async () => {
    const db = {
      insert: () => ({
        values: async () => {
          throw new Error('synthetic storage failure');
        },
      }),
    } as unknown as DB;
    await expect(
      issueSessionAccessToken(db, { sub: 'usr_test', plan: 'free', authVersion: 0 }),
    ).rejects.toThrow('synthetic storage failure');
  });
});
