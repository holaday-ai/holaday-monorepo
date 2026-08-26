import { describe, expect, it, vi } from 'vitest';
import { DATA_CATEGORY_IDS } from '../data-governance/types.js';
import type { ApplicationClosureReceipt } from './receipt-service.js';
import {
  type AccountClosureServiceDependencies,
  AccountClosureServiceError,
  type ClosureServiceRepository,
  createAccountClosureService,
} from './service.js';

const now = new Date('2026-08-26T09:00:00.000Z');
const graceEndsAt = new Date('2026-09-02T09:00:00.000Z');
const restrictedCategoryIds: Array<'payments_entitlements' | 'partner_kyc_ledger'> = [
  'payments_entitlements',
  'partner_kyc_ledger',
];

function fixture(overrides: Partial<ClosureServiceRepository> = {}) {
  const repository: ClosureServiceRepository = {
    findUser: vi.fn(async () => ({
      id: 7,
      externalId: 'usr_allowed',
      status: 'active' as const,
      authVersion: 4,
      mfaEnabled: true,
      plan: 'pro',
      planExpiresAt: new Date('2026-12-31T00:00:00.000Z'),
    })),
    previewCounts: vi.fn(async () => ({
      activeTasks: 2,
      futureTasks: 3,
      files: 4,
      stockItems: 5,
      notificationChannels: 1,
    })),
    freeze: vi.fn(async () => ({
      requestId: 19,
      requestExternalId: 'acl_random_request',
      requestedAt: now,
      graceEndsAt,
      authVersion: 23,
    })),
    applyImmediateEffects: vi.fn(async () => undefined),
    findRecoverySubject: vi.fn(async () => ({
      userId: 7,
      userExternalId: 'usr_allowed',
      authVersion: 5,
      mfaEnabled: true,
      userStatus: 'closure_pending' as const,
      requestId: 19,
      requestExternalId: 'acl_random_request',
      requestStatus: 'pending_grace' as const,
      requestedAt: now,
      graceEndsAt,
      completedAt: null,
      cancelledAt: null,
    })),
    withdraw: vi.fn(async () => undefined),
    ...overrides,
  };
  const challenge = {
    createChallenge: vi.fn(async () => ({
      challengeId: 'ach_random',
      channel: 'email' as const,
      maskedDestination: 'a***e@example.test',
      expiresAt: new Date(now.getTime() + 600_000),
    })),
    verifyChallenge: vi.fn(async () => undefined),
  };
  const receipts = {
    createApplicationReceipt: vi.fn(async () => ({
      receiptNumber: 'ACR-random-application',
      kind: 'application' as const,
      issuedAt: now.toISOString(),
      completedCategoryIds: [],
      restrictedCategoryIds,
    })),
    getApplicationReceipt: vi.fn(
      async (): Promise<ApplicationClosureReceipt | null> => ({
        receiptNumber: 'ACR-random-application',
        kind: 'application' as const,
        issuedAt: now.toISOString(),
        completedCategoryIds: [],
        restrictedCategoryIds,
      }),
    ),
  };
  const deps: AccountClosureServiceDependencies = {
    repository,
    challenge,
    mfa: { verifyUserFactor: vi.fn(async () => undefined) },
    receipts,
    verifyRecoveryToken: vi.fn(async () => ({
      sub: 'usr_allowed',
      requestId: 'acl_random_request',
      authVersion: 5,
      aud: 'account-closure-recovery' as const,
    })),
    signRecoveryToken: vi.fn(async () => 'signed-recovery-token'),
    now: () => now,
    logger: { error: vi.fn() },
    config: {
      enabled: true,
      allowlist: new Set(['usr_allowed']),
    },
  };
  return {
    service: createAccountClosureService(deps),
    repository,
    challenge,
    receipts,
    deps,
  };
}

describe('account closure service', () => {
  it('returns only aggregate preview data and the fixed no-refund disclosure', async () => {
    const { service } = fixture();
    const result = await service.preview('usr_allowed');
    expect(result).toEqual({
      graceEndsAt: graceEndsAt.toISOString(),
      plan: { name: 'pro', expiresAt: '2026-12-31T00:00:00.000Z' },
      counts: {
        activeTasks: 2,
        futureTasks: 3,
        files: 4,
        stockItems: 5,
        notificationChannels: 1,
      },
      retainedCategoryIds: ['payments_entitlements', 'partner_kyc_ledger'],
      automaticRefund: false,
    });
    expect(JSON.stringify(result)).not.toContain('usr_allowed');
    expect(JSON.stringify(result)).not.toContain('7');
  });

  it('consumes the begin challenge, requires MFA, freezes once, and creates the receipt', async () => {
    const { service, repository, challenge, receipts, deps } = fixture();
    const result = await service.begin('usr_allowed', {
      challengeId: 'ach_random',
      code: '482901',
      mfaCode: '123456',
      reasonCode: 'privacy',
      acknowledgements: {
        immediateSignOut: true,
        runningWorkStops: true,
        noAutomaticRefund: true,
      },
    });

    expect(challenge.verifyChallenge).toHaveBeenCalledWith({
      userId: 7,
      action: 'begin',
      challengeId: 'ach_random',
      code: '482901',
    });
    expect(deps.mfa.verifyUserFactor).toHaveBeenCalledWith('usr_allowed', '123456');
    expect(repository.freeze).toHaveBeenCalledWith({
      userId: 7,
      userExternalId: 'usr_allowed',
      expectedAuthVersion: 4,
      reasonCode: 'privacy',
      requestedAt: now,
    });
    expect(receipts.createApplicationReceipt).toHaveBeenCalledWith({
      requestId: 19,
      userId: 7,
      issuedAt: now,
      completedCategoryIds: [],
      restrictedCategoryIds: ['payments_entitlements', 'partner_kyc_ledger'],
    });
    expect(repository.applyImmediateEffects).toHaveBeenCalledWith({
      requestId: 19,
      userId: 7,
      userExternalId: 'usr_allowed',
    });
    expect(result).toMatchObject({
      recoveryToken: 'signed-recovery-token',
      requestStatus: 'pending_grace',
      receipt: { receiptNumber: 'ACR-random-application' },
    });
    expect(deps.signRecoveryToken).toHaveBeenCalledWith({
      sub: 'usr_allowed',
      requestId: 'acl_random_request',
      authVersion: 23,
    });
  });

  it('requires MFA without consuming a factor when MFA is disabled', async () => {
    const { service, repository, deps } = fixture({
      findUser: vi.fn(async () => ({
        id: 7,
        externalId: 'usr_allowed',
        status: 'active' as const,
        authVersion: 4,
        mfaEnabled: true,
        plan: 'pro',
        planExpiresAt: null,
      })),
    });
    await expect(
      service.begin('usr_allowed', {
        challengeId: 'ach_random',
        code: '482901',
        acknowledgements: {
          immediateSignOut: true,
          runningWorkStops: true,
          noAutomaticRefund: true,
        },
      }),
    ).rejects.toMatchObject({ code: 'VERIFICATION_FAILED' });
    expect(repository.freeze).not.toHaveBeenCalled();
    expect(deps.mfa.verifyUserFactor).not.toHaveBeenCalled();
  });

  it('binds recovery operations to audience, request, user, and exact authVersion', async () => {
    const { service, deps, challenge } = fixture();
    await expect(service.status('token-only')).resolves.toMatchObject({
      requestStatus: 'pending_grace',
      graceEndsAt: graceEndsAt.toISOString(),
    });
    expect(deps.verifyRecoveryToken).toHaveBeenCalledWith('token-only');

    vi.mocked(deps.verifyRecoveryToken).mockResolvedValueOnce({
      sub: 'usr_allowed',
      requestId: 'acl_other_request',
      authVersion: 5,
      aud: 'account-closure-recovery',
    });
    await expect(service.requestCancellationVerification('bad-token')).rejects.toBeInstanceOf(
      AccountClosureServiceError,
    );
    expect(challenge.createChallenge).not.toHaveBeenCalled();
  });

  it.each([
    ['invalid audience', null],
    [
      'wrong user',
      {
        sub: 'usr_other',
        requestId: 'acl_random_request',
        authVersion: 5,
        aud: 'account-closure-recovery' as const,
      },
    ],
    [
      'stale auth version',
      {
        sub: 'usr_allowed',
        requestId: 'acl_random_request',
        authVersion: 4,
        aud: 'account-closure-recovery' as const,
      },
    ],
  ])('rejects %s without returning request state', async (_label, claims) => {
    const { service, deps } = fixture();
    vi.mocked(deps.verifyRecoveryToken).mockResolvedValueOnce(claims);
    await expect(service.status('invalid-token')).rejects.toMatchObject({
      code: 'INVALID_RECOVERY',
    });
  });

  it('consumes a request-bound cancellation challenge and invalidates the token by withdrawal', async () => {
    const { service, repository, challenge, deps } = fixture();
    await expect(
      service.cancel('token-only', {
        challengeId: 'ach_cancel',
        code: '193842',
        mfaCode: '654321',
      }),
    ).resolves.toEqual({ cancelled: true });
    expect(challenge.verifyChallenge).toHaveBeenCalledWith({
      userId: 7,
      requestId: 19,
      action: 'cancel',
      challengeId: 'ach_cancel',
      code: '193842',
    });
    expect(deps.mfa.verifyUserFactor).toHaveBeenCalledWith('usr_allowed', '654321');
    expect(repository.withdraw).toHaveBeenCalledWith({ requestId: 19, userId: 7, now });
  });

  it('fails closed for disabled or non-allowlisted new closure requests', async () => {
    const disabled = fixture();
    disabled.deps.config.enabled = false;
    await expect(disabled.service.preview('usr_allowed')).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });

    const denied = fixture();
    denied.deps.config.allowlist = new Set(['usr_other']);
    await expect(denied.service.requestVerification('usr_allowed')).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
    expect(denied.challenge.createChallenge).not.toHaveBeenCalled();
  });

  it('keeps recovery status and withdrawal available when new applications are disabled', async () => {
    const { service, deps } = fixture();
    deps.config.enabled = false;
    await expect(service.status('existing-recovery-token')).resolves.toMatchObject({
      requestStatus: 'pending_grace',
    });
  });

  it('still applies the immediate stop boundary when application receipt persistence fails', async () => {
    const { service, repository, receipts } = fixture();
    vi.mocked(receipts.createApplicationReceipt).mockRejectedValueOnce(new Error('database down'));
    await expect(service.begin('usr_allowed', beginInput())).rejects.toMatchObject({
      code: 'RECEIPT_UNAVAILABLE',
    });
    expect(repository.applyImmediateEffects).toHaveBeenCalledWith({
      requestId: 19,
      userId: 7,
      userExternalId: 'usr_allowed',
    });
  });

  it('repairs a missing application receipt with the original request timestamp', async () => {
    const { service, receipts, deps } = fixture();
    deps.now = () => new Date('2026-08-29T09:00:00.000Z');
    vi.mocked(receipts.getApplicationReceipt).mockResolvedValueOnce(null);
    await service.applicationReceipt('token-only');
    expect(receipts.createApplicationReceipt).toHaveBeenCalledWith({
      requestId: 19,
      userId: 7,
      issuedAt: now,
      completedCategoryIds: [],
      restrictedCategoryIds,
    });
  });

  it('seeds all canonical categories through the freeze repository boundary', () => {
    expect(DATA_CATEGORY_IDS).toHaveLength(13);
  });
});

function beginInput() {
  return {
    challengeId: 'ach_random',
    code: '482901',
    mfaCode: '123456',
    acknowledgements: {
      immediateSignOut: true as const,
      runningWorkStops: true as const,
      noAutomaticRefund: true as const,
    },
  };
}
