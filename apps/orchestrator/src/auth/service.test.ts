import { inspect } from 'node:util';
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
    if (!('accessToken' in result)) throw new Error('expected authenticated result');
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
    expect(results.every((result) => 'mfaRequired' in result && result.mfaRequired === true)).toBe(
      true,
    );
    expect(results.every((result) => !('accessToken' in result))).toBe(true);
  });
});

type AuthLane = 'password' | 'email' | 'google' | 'phone';

function closureAuthDb(input: {
  status: 'active' | 'suspended' | 'closure_pending' | 'closure_processing' | 'closed';
  requestStatus?: 'pending_grace' | 'processing' | 'needs_attention';
}) {
  const user = {
    id: 51,
    externalId: 'usr_closure_auth',
    email: 'closure@example.com',
    passwordHash: 'hash:password',
    plan: 'pro',
    role: 'user',
    planExpiresAt: null,
    status: input.status,
    authVersion: 8,
    mfaEnabled: false,
    mfaSecretEncrypted: null,
    mfaSetupCreatedAt: null,
    mfaLastUsedStep: null,
    mfaFailedAttempts: 0,
    mfaLockedUntil: null,
    displayName: 'Closure member',
    googleId: null,
    avatarUrl: null,
    emailVerified: false,
    phone: '13800138000',
    phoneVerified: false,
    qwenVoiceId: null,
    baseVideoFileId: null,
    videoSelfUseAuthorizedAt: null,
    selectedRoles: null,
    selectedSkills: null,
    roleChangesThisMonth: 0,
    roleChangesPeriodStart: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-26T00:00:00.000Z'),
  };
  const request = input.requestStatus
    ? {
        id: 91,
        externalId: 'acr_closure_auth',
        userId: user.id,
        activeUserId: user.id,
        status: input.requestStatus,
      }
    : null;
  const state = { users: [user], inserts: 0, updates: [] as Array<Record<string, unknown>> };
  const tableName = (table: unknown): string =>
    (table as Record<symbol, string>)[Symbol.for('drizzle:Name')] ?? '';
  const query = (rows: unknown[]) => {
    const value = {
      where() {
        return value;
      },
      limit() {
        return value;
      },
      // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are awaitable.
      then<TResult1 = unknown, TResult2 = never>(
        onfulfilled?: ((result: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) {
        return Promise.resolve(rows).then(onfulfilled, onrejected);
      },
    };
    return value;
  };
  const db = {
    select() {
      return {
        from(table: unknown) {
          return query(
            tableName(table) === 'users'
              ? state.users.map((row) => ({ ...row }))
              : tableName(table) === 'account_closure_requests' && request
                ? [{ ...request }]
                : [],
          );
        },
      };
    },
    insert() {
      return {
        values() {
          state.inserts += 1;
          return Promise.resolve([{ affectedRows: 1 }, null]);
        },
      };
    },
    update() {
      return {
        set(values: Record<string, unknown>) {
          state.updates.push(values);
          return {
            where() {
              for (const [key, value] of Object.entries(values)) {
                if (key === 'authVersion') user.authVersion += 1;
                else Object.assign(user, { [key]: value });
              }
              return Promise.resolve([{ affectedRows: 1 }, null]);
            },
          };
        },
      };
    },
  };
  return { db, state };
}

async function authenticateLane(service: import('./service.js').AuthService, lane: AuthLane) {
  if (lane === 'password') {
    return service.login({ email: 'closure@example.com', password: 'password' });
  }
  if (lane === 'email') return service.loginOrRegisterByEmail('closure@example.com');
  if (lane === 'google') {
    return service.loginOrRegisterByGoogle({
      email: 'closure@example.com',
      googleId: 'google-closure-subject',
      name: 'New Google Name',
      avatarUrl: 'https://images.example/avatar.png',
    });
  }
  return service.loginOrRegisterByPhone('13800138000');
}

describe('AuthService account status admission', () => {
  it.each<AuthLane>(['password', 'email', 'google', 'phone'])(
    'issues ordinary access to active accounts through the %s lane',
    async (lane) => {
      const { db } = closureAuthDb({ status: 'active' });
      const { AuthService } = await import('./service.js');

      const result = await authenticateLane(new AuthService(db as never), lane);

      expect(result).toHaveProperty('accessToken');
      expect(result).not.toHaveProperty('recoveryToken');
    },
  );

  it.each<AuthLane>(['password', 'email', 'google', 'phone'])(
    'returns only closure recovery credentials through the %s lane during grace',
    async (lane) => {
      const { db } = closureAuthDb({
        status: 'closure_pending',
        requestStatus: 'pending_grace',
      });
      const { AuthService, isClosureRecoveryResult } = await import('./service.js');
      const { verifyAccountClosureRecoveryToken } = await import('./jwt.js');

      const result = await authenticateLane(new AuthService(db as never), lane);

      expect(result).toMatchObject({
        closureRecoveryRequired: true,
        closureStatus: 'pending_grace',
        user: { externalId: 'usr_closure_auth' },
      });
      expect(result).not.toHaveProperty('accessToken');
      expect(result).not.toHaveProperty('mfaToken');
      expect(isClosureRecoveryResult(result)).toBe(true);
      if (!isClosureRecoveryResult(result)) throw new Error('expected recovery result');
      await expect(verifyAccountClosureRecoveryToken(result.recoveryToken)).resolves.toMatchObject({
        sub: 'usr_closure_auth',
        requestId: 'acr_closure_auth',
        authVersion: 8,
      });
    },
  );

  it.each(
    (['password', 'email', 'google', 'phone'] as const).flatMap(
      (lane) =>
        [
          [lane, 'processing', 'processing'],
          [lane, 'needs_attention', 'needs_attention'],
        ] as const,
    ),
  )(
    'returns status-only recovery credentials through %s while the request is %s',
    async (lane, requestStatus, closureStatus) => {
      const { db } = closureAuthDb({ status: 'closure_processing', requestStatus });
      const { AuthService } = await import('./service.js');

      const result = await authenticateLane(new AuthService(db as never), lane);

      expect(result).toMatchObject({ closureRecoveryRequired: true, closureStatus });
      expect(result).not.toHaveProperty('accessToken');
      expect(result).not.toHaveProperty('mfaToken');
    },
  );

  it.each(
    (['password', 'email', 'google', 'phone'] as const).flatMap(
      (lane) =>
        [
          [lane, 'suspended'],
          [lane, 'closed'],
        ] as const,
    ),
  )('uses the generic absent-account failure through %s for %s accounts', async (lane, status) => {
    const { db } = closureAuthDb({ status });
    const { AuthService } = await import('./service.js');

    await expect(authenticateLane(new AuthService(db as never), lane)).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
      message: 'email or password incorrect',
    });
  });

  it.each<AuthLane>(['email', 'google', 'phone'])(
    'does not create a second identity through the %s lane during the grace window',
    async (lane) => {
      const { db, state } = closureAuthDb({
        status: 'closure_pending',
        requestStatus: 'pending_grace',
      });
      const { AuthService } = await import('./service.js');

      await authenticateLane(new AuthService(db as never), lane);

      expect(state.users).toHaveLength(1);
      expect(state.inserts).toBe(0);
    },
  );

  it('does not create a second password identity during the grace window', async () => {
    const { db, state } = closureAuthDb({
      status: 'closure_pending',
      requestStatus: 'pending_grace',
    });
    const { AuthService } = await import('./service.js');

    await expect(
      new AuthService(db as never).register({
        email: 'closure@example.com',
        password: 'password-42',
      }),
    ).rejects.toMatchObject({ code: 'EMAIL_TAKEN' });
    expect(state.users).toHaveLength(1);
    expect(state.inserts).toBe(0);
  });

  it.each(
    (['google', 'phone', 'reset'] as const).flatMap(
      (lane) =>
        [
          [lane, 'closure_pending', 'pending_grace'],
          [lane, 'closure_processing', 'processing'],
          [lane, 'closure_processing', 'needs_attention'],
          [lane, 'suspended', undefined],
          [lane, 'closed', undefined],
        ] as const,
    ),
  )(
    'does not update identity or credentials through %s when the user is %s/%s',
    async (lane, status, requestStatus) => {
      const { db, state } = closureAuthDb({ status, requestStatus });
      const { AuthService } = await import('./service.js');
      const service = new AuthService(db as never);
      const before = {
        googleId: state.users[0]?.googleId,
        emailVerified: state.users[0]?.emailVerified,
        avatarUrl: state.users[0]?.avatarUrl,
        displayName: state.users[0]?.displayName,
        phoneVerified: state.users[0]?.phoneVerified,
        passwordHash: state.users[0]?.passwordHash,
        authVersion: state.users[0]?.authVersion,
      };

      const attempt =
        lane === 'google'
          ? service.loginOrRegisterByGoogle({
              email: 'closure@example.com',
              googleId: 'new-google-subject',
              name: 'New Google Name',
              avatarUrl: 'https://images.example/new-avatar.png',
            })
          : lane === 'phone'
            ? service.loginOrRegisterByPhone('13800138000')
            : service.resetPasswordByEmail('closure@example.com', 'new-password-42');

      if (status === 'closure_pending' || status === 'closure_processing') {
        await expect(attempt).resolves.toMatchObject({ closureRecoveryRequired: true });
      } else {
        await expect(attempt).rejects.toMatchObject({
          code: 'INVALID_CREDENTIALS',
          message: 'email or password incorrect',
        });
      }
      expect(state.updates).toHaveLength(0);
      expect(state.users[0]).toMatchObject(before);
    },
  );

  it.each(['google', 'phone', 'reset'] as const)(
    'does not let %s identity writes cross an active-to-frozen CAS boundary',
    async (lane) => {
      const row = {
        id: 77,
        externalId: 'usr_auth_write_race',
        email: 'race@example.com',
        passwordHash: 'hash:old-password',
        plan: 'pro',
        role: 'user',
        planExpiresAt: null,
        status: 'active',
        authVersion: 12,
        mfaEnabled: false,
        mfaSecretEncrypted: null,
        mfaSetupCreatedAt: null,
        mfaLastUsedStep: null,
        mfaFailedAttempts: 0,
        mfaLockedUntil: null,
        displayName: null,
        googleId: null as string | null,
        avatarUrl: null,
        emailVerified: false,
        phone: '13800138000',
        phoneVerified: false,
        qwenVoiceId: null,
        baseVideoFileId: null,
        videoSelfUseAuthorizedAt: null,
        selectedRoles: null,
        selectedSkills: null,
        roleChangesThisMonth: 0,
        roleChangesPeriodStart: null,
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        updatedAt: new Date('2026-08-26T00:00:00.000Z'),
      };
      const request = {
        externalId: 'acr_auth_write_race',
        status: 'pending_grace',
      };
      let updateAttempted = false;
      const tableName = (table: unknown): string =>
        (table as Record<symbol, string>)[Symbol.for('drizzle:Name')] ?? '';
      const query = (rows: unknown[]) => {
        const value = {
          where() {
            return value;
          },
          limit() {
            return value;
          },
          // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are awaitable.
          then<TResult1 = unknown, TResult2 = never>(
            onfulfilled?: ((result: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
            onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
          ) {
            return Promise.resolve(rows).then(onfulfilled, onrejected);
          },
        };
        return value;
      };
      const db = {
        select() {
          return {
            from(table: unknown) {
              return query(
                tableName(table) === 'users'
                  ? [{ ...row }]
                  : tableName(table) === 'account_closure_requests'
                    ? [request]
                    : [],
              );
            },
          };
        },
        update() {
          return {
            set(values: Record<string, unknown>) {
              return {
                where(predicate: unknown) {
                  updateAttempted = true;
                  row.status = 'closure_pending';
                  row.authVersion += 1;
                  const condition = inspect(predicate, { depth: 12 });
                  const guarded = (condition.match(/value: \[ ' and ' \]/g) ?? []).length >= 2;
                  if (!guarded) {
                    for (const [key, value] of Object.entries(values)) {
                      if (key === 'authVersion') row.authVersion += 1;
                      else Object.assign(row, { [key]: value });
                    }
                    return Promise.resolve([{ affectedRows: 1 }, null]);
                  }
                  return Promise.resolve([{ affectedRows: 0 }, null]);
                },
              };
            },
          };
        },
      };
      const { AuthService } = await import('./service.js');
      const service = new AuthService(db as never);

      const result =
        lane === 'google'
          ? await service.loginOrRegisterByGoogle({
              email: row.email,
              googleId: 'new-google-subject',
              name: 'New Google Name',
            })
          : lane === 'phone'
            ? await service.loginOrRegisterByPhone(row.phone)
            : await service.resetPasswordByEmail(row.email, 'new-password-42');

      expect(updateAttempted).toBe(true);
      expect(result).toMatchObject({
        closureRecoveryRequired: true,
        closureStatus: 'pending_grace',
      });
      expect(result).not.toHaveProperty('accessToken');
      expect(row).toMatchObject({
        googleId: null,
        emailVerified: false,
        displayName: null,
        phoneVerified: false,
        passwordHash: 'hash:old-password',
        authVersion: 13,
      });
    },
  );

  it.each(['google', 'phone', 'reset', 'change'] as const)(
    'rejects %s issuance when authVersion advances again after a successful CAS',
    async (lane) => {
      const row = {
        id: 88,
        externalId: 'usr_post_cas_drift',
        email: 'post-cas@example.com',
        passwordHash: 'hash:old-password',
        plan: 'pro',
        role: 'user',
        planExpiresAt: null,
        status: 'active',
        authVersion: 10,
        mfaEnabled: false,
        mfaSecretEncrypted: null,
        mfaSetupCreatedAt: null,
        mfaLastUsedStep: null,
        mfaFailedAttempts: 0,
        mfaLockedUntil: null,
        displayName: null,
        googleId: null as string | null,
        avatarUrl: null,
        emailVerified: false,
        phone: '13600136000',
        phoneVerified: false,
        qwenVoiceId: null,
        baseVideoFileId: null,
        videoSelfUseAuthorizedAt: null,
        selectedRoles: null,
        selectedSkills: null,
        roleChangesThisMonth: 0,
        roleChangesPeriodStart: null,
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        updatedAt: new Date('2026-08-26T00:00:00.000Z'),
      };
      let updateCompleted = false;
      let laterVersionApplied = false;
      const query = () => {
        const value = {
          where() {
            return value;
          },
          limit() {
            return value;
          },
          // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are awaitable.
          then<TResult1 = unknown, TResult2 = never>(
            onfulfilled?: ((result: Array<typeof row>) => TResult1 | PromiseLike<TResult1>) | null,
            onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
          ) {
            if (updateCompleted && !laterVersionApplied) {
              laterVersionApplied = true;
              row.authVersion += 1;
            }
            return Promise.resolve([{ ...row }]).then(onfulfilled, onrejected);
          },
        };
        return value;
      };
      const db = {
        select() {
          return { from: query };
        },
        update() {
          return {
            set(values: Record<string, unknown>) {
              return {
                where() {
                  if ('passwordHash' in values) row.passwordHash = String(values.passwordHash);
                  if ('authVersion' in values) row.authVersion += 1;
                  if ('googleId' in values) row.googleId = String(values.googleId);
                  if ('emailVerified' in values) row.emailVerified = Boolean(values.emailVerified);
                  if ('phoneVerified' in values) row.phoneVerified = Boolean(values.phoneVerified);
                  updateCompleted = true;
                  return Promise.resolve([{ affectedRows: 1 }, null]);
                },
              };
            },
          };
        },
      };
      const { AuthService } = await import('./service.js');
      const service = new AuthService(db as never);
      const attempt =
        lane === 'google'
          ? service.loginOrRegisterByGoogle({
              email: row.email,
              googleId: 'google-post-cas',
            })
          : lane === 'phone'
            ? service.loginOrRegisterByPhone(row.phone)
            : lane === 'reset'
              ? service.resetPasswordByEmail(row.email, 'new-password-42')
              : service.changePasswordForUser(row.externalId, 'new-password-42');

      await expect(attempt).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
      expect(laterVersionApplied).toBe(true);
    },
  );

  it.each(['google', 'phone'] as const)(
    'rejects %s no-write issuance when reread authVersion differs from the first read',
    async (lane) => {
      const row = {
        id: 89,
        externalId: 'usr_no_write_drift',
        email: 'no-write@example.com',
        passwordHash: 'hash:password',
        plan: 'free',
        status: 'active',
        authVersion: 14,
        mfaEnabled: false,
        displayName: 'Existing Name',
        googleId: 'google-existing',
        avatarUrl: null,
        emailVerified: true,
        phone: '13500135000',
        phoneVerified: true,
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
      };
      let reads = 0;
      const query = {
        where() {
          return query;
        },
        limit() {
          return query;
        },
        // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are awaitable.
        then<TResult1 = unknown, TResult2 = never>(
          onfulfilled?: ((result: Array<typeof row>) => TResult1 | PromiseLike<TResult1>) | null,
          onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
        ) {
          reads += 1;
          if (reads === 2) row.authVersion += 1;
          return Promise.resolve([{ ...row }]).then(onfulfilled, onrejected);
        },
      };
      const db = {
        select() {
          return { from: () => query };
        },
      };
      const { AuthService } = await import('./service.js');
      const service = new AuthService(db as never);
      const attempt =
        lane === 'google'
          ? service.loginOrRegisterByGoogle({
              email: row.email,
              googleId: row.googleId,
              name: row.displayName,
            })
          : service.loginOrRegisterByPhone(row.phone);

      await expect(attempt).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
      expect(reads).toBe(2);
    },
  );
});
