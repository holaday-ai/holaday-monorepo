import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('./password.js', () => ({
  hashPassword: vi.fn(async (value: string) => `hash:${value}`),
  verifyPassword: vi.fn(async () => true),
}));

beforeAll(() => {
  process.env.JWT_SECRET ??= 'test-secret-must-be-at-least-32-characters-long-yes';
  process.env.DATABASE_URL ??= 'mysql://test:test@127.0.0.1:3306/test';
  process.env.REDIS_URL ??= 'redis://127.0.0.1:6379/0';
});

describe('AuthService password reset invalidation', () => {
  it('increments authVersion and issues a token at the new version', async () => {
    const row = {
      id: 7,
      externalId: 'usr_reset_version',
      email: 'reset@example.com',
      passwordHash: 'hash:old',
      plan: 'pro',
      role: 'user',
      planExpiresAt: null,
      status: 'active',
      authVersion: 4,
      displayName: null,
      googleId: null,
      avatarUrl: null,
      emailVerified: true,
      phone: null,
      phoneVerified: false,
      qwenVoiceId: null,
      baseVideoFileId: null,
      videoSelfUseAuthorizedAt: null,
      selectedRoles: null,
      selectedSkills: null,
      roleChangesThisMonth: 0,
      roleChangesPeriodStart: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const updates: Array<Record<string, unknown>> = [];
    const db = {
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
                return Promise.resolve([{ ...row }]).then(onfulfilled, onrejected);
              },
            };
            return query;
          },
        };
      },
      update() {
        return {
          set(values: Record<string, unknown>) {
            updates.push(values);
            return {
              where() {
                row.passwordHash = String(values.passwordHash);
                row.authVersion += 1;
                return Promise.resolve([{ affectedRows: 1 }, null]);
              },
            };
          },
        };
      },
    };

    const { AuthService } = await import('./service.js');
    const { verifyAccessToken } = await import('./jwt.js');
    const result = await new AuthService(db as never).resetPasswordByEmail(
      row.email,
      'new-password',
    );

    expect(updates).toHaveLength(1);
    expect(updates[0]?.authVersion).toBeDefined();
    await expect(verifyAccessToken(result.accessToken)).resolves.toMatchObject({
      sub: row.externalId,
      authVersion: 5,
    });
  });
});
