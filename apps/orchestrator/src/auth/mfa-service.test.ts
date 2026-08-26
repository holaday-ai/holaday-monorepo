import { beforeAll, describe, expect, it } from 'vitest';

beforeAll(() => {
  process.env.JWT_SECRET ??= 'test-secret-must-be-at-least-32-characters-long-yes';
  process.env.DATABASE_URL ??= 'mysql://test:test@127.0.0.1:3306/test';
  process.env.REDIS_URL ??= 'redis://127.0.0.1:6379/0';
});

function closureMfaDb(input: {
  userStatus: 'closure_pending' | 'closure_processing' | 'closed';
  requestStatus?: 'pending_grace' | 'processing' | 'needs_attention';
  authVersion: number;
}) {
  const user = {
    id: 109,
    externalId: 'usr_mfa_version_gate',
    email: 'mfa-version@example.com',
    plan: 'pro',
    status: input.userStatus,
    authVersion: input.authVersion,
    mfaEnabled: false,
    mfaSecretEncrypted: null,
    displayName: null,
    avatarUrl: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
  };
  const request = input.requestStatus
    ? { externalId: 'acr_mfa_version_gate', status: input.requestStatus }
    : null;
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
  return {
    select() {
      return {
        from(table: unknown) {
          return query(
            tableName(table) === 'users'
              ? [user]
              : tableName(table) === 'account_closure_requests' && request
                ? [request]
                : [],
          );
        },
      };
    },
  };
}

describe('MfaService closure challenge version admission', () => {
  it.each([
    ['closure_pending', 'pending_grace'],
    ['closure_processing', 'processing'],
    ['closure_processing', 'needs_attention'],
  ] as const)(
    'allows the direct pre-freeze challenge for %s/%s recovery',
    async (userStatus, requestStatus) => {
      const { signMfaChallengeToken } = await import('./jwt.js');
      const { MfaService } = await import('./mfa-service.js');
      const db = closureMfaDb({ userStatus, requestStatus, authVersion: 31 });

      const result = await new MfaService(db as never).verifyChallenge(
        await signMfaChallengeToken({ sub: 'usr_mfa_version_gate', authVersion: 30 }),
        'factor-not-consumed-in-recovery',
      );

      expect(result).toMatchObject({ closureRecoveryRequired: true, closureStatus: requestStatus });
      expect(result).not.toHaveProperty('accessToken');
    },
  );

  it.each([
    ['same-version challenge', 'closure_pending', 'pending_grace', 40, 40],
    ['old challenge', 'closure_pending', 'pending_grace', 43, 40],
    ['password change before closure', 'closure_processing', 'processing', 42, 40],
    ['MFA change before closure', 'closure_processing', 'needs_attention', 52, 50],
  ] as const)(
    'rejects %s for %s/%s instead of returning recovery',
    async (_caseName, userStatus, requestStatus, currentVersion, challengeVersion) => {
      const { signMfaChallengeToken } = await import('./jwt.js');
      const { MfaService } = await import('./mfa-service.js');
      const db = closureMfaDb({ userStatus, requestStatus, authVersion: currentVersion });

      await expect(
        new MfaService(db as never).verifyChallenge(
          await signMfaChallengeToken({
            sub: 'usr_mfa_version_gate',
            authVersion: challengeVersion,
          }),
          'factor-must-not-bypass-version-gate',
        ),
      ).rejects.toMatchObject({ code: 'INVALID', message: '验证已过期，请重新登录' });
    },
  );

  it('keeps closed accounts on the generic invalid-challenge path', async () => {
    const { signMfaChallengeToken } = await import('./jwt.js');
    const { MfaService } = await import('./mfa-service.js');
    const db = closureMfaDb({ userStatus: 'closed', authVersion: 61 });

    await expect(
      new MfaService(db as never).verifyChallenge(
        await signMfaChallengeToken({ sub: 'usr_mfa_version_gate', authVersion: 60 }),
        'factor-never-accepted',
      ),
    ).rejects.toMatchObject({ code: 'INVALID' });
  });
});
