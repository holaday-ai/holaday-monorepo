import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { teamProjectsEnabledFor } = vi.hoisted(() => ({
  teamProjectsEnabledFor: vi.fn<(userId: string) => boolean>(),
}));

vi.mock('../../organizations/team-project-access.js', () => ({
  isTeamProjectsEnabledFor: teamProjectsEnabledFor,
}));
import { authRouter } from './auth.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('auth router — unexpected error masking', () => {
  beforeEach(() => {
    teamProjectsEnabledFor.mockReset();
  });

  it('does not leak raw database errors from password login', async () => {
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => {
              throw new Error("Unknown column 'role' in 'field list'");
            },
          }),
        }),
      }),
    };
    const logger = { error: vi.fn() };
    const caller = authRouter.createCaller({ db, logger } as never);

    await expect(
      caller.login({ email: 'person@example.com', password: 'secret' }),
    ).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: '登录服务暂时不可用，请稍后重试。',
    });
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        procedure: 'auth.login',
        err: "Unknown column 'role' in 'field list'",
      }),
      'auth: unexpected error',
    );
  });

  it('requires an authenticated account before starting a password change', async () => {
    const caller = authRouter.createCaller({ db: {}, logger: { error: vi.fn() } } as never);

    await expect(caller.sendPasswordChangeCode()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    await expect(
      caller.changePasswordWithCode({ code: '123456', password: 'new-password-42' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('rejects a missing or invalid MFA challenge', async () => {
    const caller = authRouter.createCaller({ db: {}, logger: { error: vi.fn() } } as never);

    await expect(
      caller.verifyMfaChallenge({ mfaToken: 'not-a-token', code: '123456' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('passes the SMS gateway closure-recovery union to the client unchanged', async () => {
    vi.stubEnv('ALIYUN_SMS_URL', 'https://sms-gateway.test');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              user: {
                externalId: 'usr_sms_closure',
                email: null,
                plan: 'free',
                displayName: null,
                avatarUrl: null,
                createdAt: '2026-08-01T00:00:00.000Z',
              },
              closureRecoveryRequired: true,
              recoveryToken: 'sms-recovery-token',
              closureStatus: 'pending_grace',
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      ),
    );
    const caller = authRouter.createCaller({ db: {}, logger: { error: vi.fn() } } as never);

    await expect(caller.smsVerify({ phone: '13800138000', code: '123456' })).resolves.toMatchObject(
      {
        closureRecoveryRequired: true,
        recoveryToken: 'sms-recovery-token',
        closureStatus: 'pending_grace',
      },
    );
  });
});

describe('auth router — profile rollout state', () => {
  beforeEach(() => {
    teamProjectsEnabledFor.mockReset();
    teamProjectsEnabledFor.mockImplementation((userId) => userId === 'usr_canary');
  });

  it.each([
    ['usr_canary', true],
    ['usr_other', false],
  ] as const)(
    'publishes the shared team-project gate result for %s',
    async (userId, expectedTeamProjectsEnabled) => {
      const planExpiresAt = new Date('2026-09-30T00:00:00.000Z');
      const db = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => [
                {
                  externalId: userId,
                  email: 'person@example.com',
                  phone: '13800138000',
                  displayName: 'Person',
                  avatarUrl: 'https://example.com/avatar.png',
                  plan: 'pro',
                  planExpiresAt,
                  selectedRoles: ['researcher'],
                  role: 'user',
                },
              ],
            }),
          }),
        }),
      };
      const caller = authRouter.createCaller({
        db,
        logger: { error: vi.fn() },
        userId,
        browserPool: null,
      } as never);

      await expect(caller.me()).resolves.toEqual({
        userId,
        email: 'person@example.com',
        phone: '13800138000',
        displayName: 'Person',
        avatarUrl: 'https://example.com/avatar.png',
        plan: 'pro',
        planExpiresAt,
        multiUser: false,
        selectedRoles: ['researcher'],
        role: 'user',
        videoEnabled: false,
        teamProjectsEnabled: expectedTeamProjectsEnabled,
      });
    },
  );
});
