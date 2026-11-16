import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { teamProjectsEnabledFor, teamTaskLifecycleEnabledForUser } = vi.hoisted(() => ({
  teamProjectsEnabledFor: vi.fn<(userId: string) => boolean>(),
  teamTaskLifecycleEnabledForUser: vi.fn<(userId: string) => boolean>(),
}));

vi.mock('../../organizations/team-project-access.js', () => ({
  isTeamProjectsEnabledFor: teamProjectsEnabledFor,
}));
vi.mock('../../team-work-items/team-task-access.js', () => ({
  isTeamTaskLifecycleEnabledForUser: teamTaskLifecycleEnabledForUser,
}));
import { authRouter } from './auth.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('auth router — unexpected error masking', () => {
  beforeEach(() => {
    teamProjectsEnabledFor.mockReset();
    teamTaskLifecycleEnabledForUser.mockReset();
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
    teamProjectsEnabledFor.mockImplementation((userId) => userId !== 'usr_phase1_off');
    teamTaskLifecycleEnabledForUser.mockReset();
    teamTaskLifecycleEnabledForUser.mockImplementation((userId) => userId === 'usr_canary');
  });

  it.each([
    ['usr_canary', true, true],
    ['usr_phase2_off', true, false],
    ['usr_phase1_off', false, false],
  ] as const)(
    'publishes the shared team-project gate result for %s',
    async (userId, expectedTeamProjectsEnabled, expectedTeamTaskLifecycleEnabled) => {
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
                  modelDataRegion: null,
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
        modelDataRegion: null,
        modelDataRegionSelection: false,
        videoEnabled: false,
        browserHomeEnabled: false,
        browserHomeProfilesEnabled: false,
        mediaModels: {
          image: expect.any(Array),
          video: expect.any(Array),
          petVideo: expect.any(Array),
        },
        teamProjectsEnabled: expectedTeamProjectsEnabled,
        teamTaskLifecycleEnabled: expectedTeamTaskLifecycleEnabled,
      });
      expect(teamProjectsEnabledFor).toHaveBeenCalledWith(userId);
      expect(teamTaskLifecycleEnabledForUser).toHaveBeenCalledWith(userId);
    },
  );
});

describe('auth.me — BROWSER-HOME-1 browserHomeEnabled', () => {
  it('follows BROWSER_HOME_ENABLED + BROWSER_HOME_ALLOWLIST', async () => {
    const { env: appEnv } = await import('../../config/env.js');
    const previous = [appEnv.BROWSER_HOME_ENABLED, appEnv.BROWSER_HOME_ALLOWLIST] as const;
    const me = (userId: string) =>
      authRouter
        .createCaller({
          db: {
            select: () => ({
              from: () => ({
                where: () => ({
                  limit: async () => [
                    {
                      externalId: userId,
                      plan: 'pro',
                      selectedRoles: [],
                      role: 'user',
                      modelDataRegion: null,
                    },
                  ],
                }),
              }),
            }),
          },
          logger: { error: vi.fn() },
          userId,
          browserPool: null,
        } as never)
        .me();
    try {
      appEnv.BROWSER_HOME_ENABLED = true;
      appEnv.BROWSER_HOME_ALLOWLIST = 'usr_listed';
      expect((await me('usr_listed')).browserHomeEnabled).toBe(true);
      expect((await me('usr_other')).browserHomeEnabled).toBe(false);
      appEnv.BROWSER_HOME_ENABLED = false;
      expect((await me('usr_listed')).browserHomeEnabled).toBe(false);
    } finally {
      [appEnv.BROWSER_HOME_ENABLED, appEnv.BROWSER_HOME_ALLOWLIST] = previous;
    }
  });
});

it('advertises saved-site controls only with an open Home gate and a configured interactive Vault runtime', async () => {
  const { env } = await import('../../config/env.js');
  const { createVaultRuntime, getVaultRuntime, installVaultRuntime } = await import(
    '../../browser-session-vault/runtime.js'
  );
  const { TestKeyProvider } = await import('../../browser-session-vault/crypto.js');
  const { MemoryVaultStore } = await import('../../browser-session-vault/vault.js');
  const previous = {
    BROWSER_HOME_ENABLED: env.BROWSER_HOME_ENABLED,
    BROWSER_HOME_ALLOWLIST: env.BROWSER_HOME_ALLOWLIST,
    BROWSER_HOME_PROFILE_V1: env.BROWSER_HOME_PROFILE_V1,
  };
  const oldRuntime = getVaultRuntime();
  const query = {
    from: () => query,
    where: () => query,
    limit: async () => [
      { externalId: 'usr_home_cap', plan: 'pro', role: 'user', selectedRoles: [] },
    ],
  };
  const caller = authRouter.createCaller({
    userId: 'usr_home_cap',
    db: { select: () => query },
    logger: { error() {} },
    browserPool: {},
  } as never);
  try {
    env.BROWSER_HOME_ENABLED = true;
    env.BROWSER_HOME_ALLOWLIST = '';
    env.BROWSER_HOME_PROFILE_V1 = true;
    installVaultRuntime(undefined);
    expect((await caller.me()).browserHomeProfilesEnabled).toBe(false);
    installVaultRuntime(
      createVaultRuntime({
        importEnabled: false,
        profileEnabled: false,
        cloudHomeEnabled: true,
        keys: new TestKeyProvider(),
        store: new MemoryVaultStore(),
      }),
    );
    expect((await caller.me()).browserHomeProfilesEnabled).toBe(true);
    env.BROWSER_HOME_PROFILE_V1 = false;
    expect((await caller.me()).browserHomeProfilesEnabled).toBe(false);
    env.BROWSER_HOME_PROFILE_V1 = true;
    env.BROWSER_HOME_ENABLED = false;
    expect((await caller.me()).browserHomeProfilesEnabled).toBe(false);
  } finally {
    Object.assign(env, previous);
    installVaultRuntime(oldRuntime);
  }
});
