import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetAllBucketsForTesting } from '../../quota/rate-limiter.js';
import {
  type AccountClosureApi,
  beginClosureSchema,
  cancelClosureSchema,
  createAccountClosureRouter,
  recoveryTokenSchema,
} from './account-closure.js';

function serviceFixture(): AccountClosureApi {
  const retainedCategoryIds: Array<'payments_entitlements' | 'partner_kyc_ledger'> = [
    'payments_entitlements',
    'partner_kyc_ledger',
  ];
  return {
    preview: vi.fn(async () => ({
      graceEndsAt: '2026-09-02T09:00:00.000Z',
      plan: { name: 'pro', expiresAt: null },
      counts: {
        activeTasks: 1,
        futureTasks: 2,
        files: 3,
        stockItems: 4,
        notificationChannels: 5,
      },
      retainedCategoryIds,
      automaticRefund: false as const,
    })),
    requestVerification: vi.fn(async () => ({
      challengeId: 'ach_random',
      channel: 'email' as const,
      maskedDestination: 'a***e@example.test',
      expiresAt: '2026-08-26T09:10:00.000Z',
    })),
    begin: vi.fn(async () => ({
      recoveryToken: 'recovery-token',
      requestStatus: 'pending_grace' as const,
      graceEndsAt: '2026-09-02T09:00:00.000Z',
      receipt: { receiptNumber: 'ACR-random' },
    })),
    status: vi.fn(async () => ({
      requestStatus: 'pending_grace' as const,
      requestedAt: '2026-08-26T09:00:00.000Z',
      graceEndsAt: '2026-09-02T09:00:00.000Z',
      completedAt: null,
      cancelledAt: null,
      canCancel: true,
      plan: { name: 'pro', expiresAt: '2026-12-31T00:00:00.000Z' },
      mfaRequired: true,
    })),
    requestCancellationVerification: vi.fn(async () => ({
      challengeId: 'ach_cancel',
      channel: 'email' as const,
      maskedDestination: 'a***e@example.test',
      expiresAt: '2026-08-26T09:10:00.000Z',
    })),
    cancel: vi.fn(async () => ({ cancelled: true as const })),
    applicationReceipt: vi.fn(async () => ({
      receiptNumber: 'ACR-random',
      kind: 'application' as const,
      issuedAt: '2026-08-26T09:00:00.000Z',
      completedCategoryIds: [],
      restrictedCategoryIds: retainedCategoryIds,
    })),
  };
}

function caller(service = serviceFixture(), rateLimit = () => true, userId = 'usr_allowed') {
  const router = createAccountClosureRouter({ createService: () => service, rateLimit });
  return {
    caller: router.createCaller({ userId, db: {}, logger: { error: vi.fn() } } as never),
    service,
  };
}

const beginInput = {
  challengeId: 'ach_random',
  code: '482901',
  mfaCode: '123456',
  reasonCode: 'privacy' as const,
  acknowledgements: {
    immediateSignOut: true as const,
    runningWorkStops: true as const,
    noAutomaticRefund: true as const,
  },
};

describe('account closure router contract', () => {
  beforeEach(() => _resetAllBucketsForTesting());

  it('exposes all seven procedures with protected identity for application routes', async () => {
    const { caller: api, service } = caller();
    await expect(api.preview()).resolves.toMatchObject({ automaticRefund: false });
    await expect(api.requestVerification()).resolves.toMatchObject({ channel: 'email' });
    await expect(api.begin(beginInput)).resolves.toMatchObject({ requestStatus: 'pending_grace' });
    await expect(api.status({ recoveryToken: 'token-only' })).resolves.toMatchObject({
      requestStatus: 'pending_grace',
      plan: { name: 'pro', expiresAt: '2026-12-31T00:00:00.000Z' },
      mfaRequired: true,
    });
    await expect(
      api.requestCancellationVerification({ recoveryToken: 'token-only' }),
    ).resolves.toMatchObject({ challengeId: 'ach_cancel' });
    await expect(
      api.cancel({
        recoveryToken: 'token-only',
        challengeId: 'ach_cancel',
        code: '193842',
        mfaCode: '654321',
      }),
    ).resolves.toEqual({ cancelled: true });
    await expect(api.applicationReceipt({ recoveryToken: 'token-only' })).resolves.toMatchObject({
      kind: 'application',
    });
    expect(service.preview).toHaveBeenCalledWith('usr_allowed');
    expect(service.status).toHaveBeenCalledWith('token-only');
  });

  it('never accepts userId or destination in protected or recovery inputs', async () => {
    expect(beginClosureSchema.safeParse({ ...beginInput, userId: 7 }).success).toBe(false);
    expect(
      beginClosureSchema.safeParse({ ...beginInput, destination: 'private@example.test' }).success,
    ).toBe(false);
    expect(recoveryTokenSchema.safeParse({ recoveryToken: 'token', userId: 7 }).success).toBe(
      false,
    );
    expect(
      cancelClosureSchema.safeParse({
        recoveryToken: 'token',
        challengeId: 'ach',
        code: '123456',
        destination: '13800138000',
      }).success,
    ).toBe(false);
    const { caller: api, service } = caller();
    await expect(
      (api.preview as unknown as (input: unknown) => Promise<unknown>)({ userId: 7 }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      (api.requestVerification as unknown as (input: unknown) => Promise<unknown>)({
        destination: 'private@example.test',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(service.preview).not.toHaveBeenCalled();
    expect(service.requestVerification).not.toHaveBeenCalled();
  });

  it('requires the three exact acknowledgements and a six-digit one-time code', async () => {
    const { caller: api, service } = caller();
    await expect(
      api.begin({
        ...beginInput,
        acknowledgements: { ...beginInput.acknowledgements, noAutomaticRefund: false },
      } as never),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(api.begin({ ...beginInput, code: '12345' } as never)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(service.begin).not.toHaveBeenCalled();
  });

  it('maps challenge replay, MFA, allowlist, and feature failures to one generic response', async () => {
    for (const failure of [
      'challenge replay',
      'mfa missing',
      'not allowlisted',
      'feature disabled',
    ]) {
      const service = serviceFixture();
      vi.mocked(service.begin).mockRejectedValueOnce(new Error(failure));
      const { caller: api } = caller(service);
      await expect(api.begin(beginInput)).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: '无法完成账号关闭操作',
      });
    }
  });

  it('enforces mutation rate limits before invoking the service', async () => {
    const { caller: api, service } = caller(serviceFixture(), () => false);
    await expect(api.requestVerification()).rejects.toMatchObject({
      code: 'TOO_MANY_REQUESTS',
    });
    expect(service.requestVerification).not.toHaveBeenCalled();
  });

  it('requires authentication only for preview, requestVerification, and begin', async () => {
    const service = serviceFixture();
    const router = createAccountClosureRouter({ createService: () => service });
    const anonymous = router.createCaller({ userId: undefined, db: {}, logger: {} } as never);
    await expect(anonymous.preview()).rejects.toBeInstanceOf(TRPCError);
    await expect(anonymous.requestVerification()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(anonymous.begin(beginInput)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(anonymous.status({ recoveryToken: 'token-only' })).resolves.toMatchObject({
      requestStatus: 'pending_grace',
    });
  });
});
