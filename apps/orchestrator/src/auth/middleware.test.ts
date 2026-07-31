import { beforeAll, describe, expect, it } from 'vitest';

beforeAll(() => {
  process.env.JWT_SECRET ??= 'test-secret-must-be-at-least-32-characters-long-yes';
  process.env.DATABASE_URL ??= 'mysql://test:test@127.0.0.1:3306/test';
  process.env.REDIS_URL ??= 'redis://127.0.0.1:6379/0';
});

function fakeDbFor(row: {
  externalId: string;
  status: string;
  authVersion: number;
}) {
  return {
    select() {
      return {
        from() {
          const query = {
            where() {
              return query;
            },
            limit() {
              return query;
            },
            // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are awaitable.
            then<TResult1 = unknown, TResult2 = never>(
              onfulfilled?:
                | ((value: Array<typeof row>) => TResult1 | PromiseLike<TResult1>)
                | null,
              onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
            ) {
              return Promise.resolve([row]).then(onfulfilled, onrejected);
            },
          };
          return query;
        },
      };
    },
  };
}

describe('authenticateBearerHeader', () => {
  it('accepts an active user whose auth version matches', async () => {
    const { signAccessToken } = await import('./jwt.js');
    const { authenticateBearerHeader } = await import('./middleware.js');
    const token = await signAccessToken({
      sub: 'usr_active',
      plan: 'pro',
      authVersion: 2,
    });

    await expect(
      authenticateBearerHeader(
        fakeDbFor({ externalId: 'usr_active', status: 'active', authVersion: 2 }) as never,
        `Bearer ${token}`,
      ),
    ).resolves.toBe('usr_active');
  });

  it('rejects a suspended user even when the token signature is valid', async () => {
    const { signAccessToken } = await import('./jwt.js');
    const { authenticateBearerHeader } = await import('./middleware.js');
    const token = await signAccessToken({ sub: 'usr_suspended', plan: 'pro' });

    await expect(
      authenticateBearerHeader(
        fakeDbFor({ externalId: 'usr_suspended', status: 'suspended', authVersion: 0 }) as never,
        `Bearer ${token}`,
      ),
    ).resolves.toBeNull();
  });

  it('rejects a token issued before the user auth version changed', async () => {
    const { signAccessToken } = await import('./jwt.js');
    const { authenticateBearerHeader } = await import('./middleware.js');
    const token = await signAccessToken({
      sub: 'usr_reset',
      plan: 'pro',
      authVersion: 4,
    });

    await expect(
      authenticateBearerHeader(
        fakeDbFor({ externalId: 'usr_reset', status: 'active', authVersion: 5 }) as never,
        `Bearer ${token}`,
      ),
    ).resolves.toBeNull();
  });
});

describe('realtime token authentication', () => {
  it('accepts a short-lived stream token without querying the user table', async () => {
    const { signStreamToken } = await import('./jwt.js');
    const { authenticateStreamOrAccessToken } = await import('./middleware.js');
    const { token } = await signStreamToken('usr_stream_active');
    let selectCalls = 0;
    const database = {
      select() {
        selectCalls += 1;
        throw new Error('stream tokens must not query the database');
      },
    };

    await expect(
      authenticateStreamOrAccessToken(database as never, token),
    ).resolves.toBe('usr_stream_active');
    expect(selectCalls).toBe(0);
  });

  it('rejects an inactive user using a valid long-lived access token', async () => {
    const { signAccessToken } = await import('./jwt.js');
    const { authenticateStreamOrAccessToken } = await import('./middleware.js');
    const token = await signAccessToken({
      sub: 'usr_stream_suspended',
      plan: 'pro',
      authVersion: 3,
    });

    await expect(
      authenticateStreamOrAccessToken(
        fakeDbFor({
          externalId: 'usr_stream_suspended',
          status: 'suspended',
          authVersion: 3,
        }) as never,
        token,
      ),
    ).resolves.toBeNull();
  });

  it('rejects a legacy stream fallback token after authVersion changes', async () => {
    const { signAccessToken } = await import('./jwt.js');
    const { authenticateStreamOrAccessToken } = await import('./middleware.js');
    const token = await signAccessToken({
      sub: 'usr_stream_reset',
      plan: 'pro',
      authVersion: 6,
    });

    await expect(
      authenticateStreamOrAccessToken(
        fakeDbFor({
          externalId: 'usr_stream_reset',
          status: 'active',
          authVersion: 7,
        }) as never,
        token,
      ),
    ).resolves.toBeNull();
  });
});
