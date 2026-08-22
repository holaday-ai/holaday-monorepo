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
    if (!('accessToken' in result)) throw new Error('expected authenticated result');
    await expect(verifyAccessToken(result.accessToken)).resolves.toMatchObject({
      sub: row.externalId,
      authVersion: 5,
    });
  });

  it('changes the password for the authenticated external user and rotates authVersion', async () => {
    const row = {
      id: 9,
      externalId: 'usr_change_password',
      email: 'change@example.com',
      passwordHash: 'hash:old',
      plan: 'free',
      role: 'user',
      planExpiresAt: null,
      status: 'active',
      authVersion: 2,
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
    const db = {
      select() {
        return {
          from() {
            return {
              where() {
                return {
                  limit: async () => [{ ...row }],
                };
              },
            };
          },
        };
      },
      update() {
        return {
          set(values: Record<string, unknown>) {
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
    const result = await new AuthService(db as never).changePasswordForUser(
      row.externalId,
      'new-password-42',
    );

    expect(row.passwordHash).toBe('hash:new-password-42');
    await expect(verifyAccessToken(result.accessToken)).resolves.toMatchObject({
      sub: row.externalId,
      authVersion: 3,
    });
  });

  it('returns a short-lived MFA challenge instead of an access token after the first factor', async () => {
    const row = {
      id: 13,
      externalId: 'usr_mfa_login',
      email: 'mfa@example.com',
      passwordHash: 'hash:password',
      plan: 'pro',
      authVersion: 6,
      mfaEnabled: true,
      displayName: 'MFA member',
      avatarUrl: null,
      createdAt: new Date(),
    };
    const db = {
      select() {
        return {
          from() {
            return {
              where() {
                return {
                  limit: async () => [row],
                };
              },
            };
          },
        };
      },
    };

    const { AuthService } = await import('./service.js');
    const { verifyMfaChallengeToken } = await import('./jwt.js');
    const result = await new AuthService(db as never).login({
      email: row.email,
      password: 'password',
    });

    expect(result).not.toHaveProperty('accessToken');
    expect(result).toMatchObject({ mfaRequired: true, user: { externalId: row.externalId } });
    if (!('mfaToken' in result)) throw new Error('expected MFA challenge');
    await expect(verifyMfaChallengeToken(result.mfaToken)).resolves.toEqual({
      sub: row.externalId,
      authVersion: 6,
    });
  });

  it('applies the MFA challenge to password, email-code, Google, and SMS login lanes', async () => {
    const row = {
      id: 17,
      externalId: 'usr_all_mfa_lanes',
      email: 'all-lanes@example.com',
      passwordHash: 'hash:password',
      plan: 'free',
      authVersion: 2,
      mfaEnabled: true,
      displayName: 'All lanes',
      avatarUrl: null,
      createdAt: new Date(),
      googleId: 'google-all-lanes',
      emailVerified: true,
      phone: '13800138000',
      phoneVerified: true,
    };
    const db = {
      select() {
        return {
          from() {
            return {
              where() {
                return { limit: async () => [row] };
              },
            };
          },
        };
      },
    };
    const { AuthService } = await import('./service.js');
    const service = new AuthService(db as never);
    const results = await Promise.all([
      service.login({ email: row.email, password: 'password' }),
      service.loginOrRegisterByEmail(row.email),
      service.loginOrRegisterByGoogle({
        email: row.email,
        googleId: row.googleId,
        name: row.displayName,
      }),
      service.loginOrRegisterByPhone(row.phone),
    ]);
    expect(results.every((result) => result.mfaRequired === true)).toBe(true);
    expect(results.every((result) => !('accessToken' in result))).toBe(true);
  });
});
