import { PARTNER_MEMBERSHIP_PRICE_CNY_CENTS } from '@holaday/shared-types';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { users } from '../../db/schema/users.js';

const {
  createPendingOrderMock,
  getKycStatusMock,
  recordInviteMock,
  requestWithdrawalMock,
} = vi.hoisted(() => ({
  createPendingOrderMock: vi.fn(),
  getKycStatusMock: vi.fn(),
  recordInviteMock: vi.fn(),
  requestWithdrawalMock: vi.fn(),
}));

vi.mock('../../partner/recharge-service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../partner/recharge-service.js')>();
  return {
    ...actual,
    RechargeService: vi.fn(() => ({
      createPendingOrder: createPendingOrderMock,
    })),
  };
});

vi.mock('../../partner/kyc-service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../partner/kyc-service.js')>();
  return {
    ...actual,
    KycService: vi.fn(() => ({
      getStatus: getKycStatusMock,
    })),
  };
});

vi.mock('../../partner/withdrawal-service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../partner/withdrawal-service.js')>();
  return {
    ...actual,
    WithdrawalService: vi.fn(() => ({
      requestWithdrawal: requestWithdrawalMock,
    })),
  };
});

vi.mock('../../partner/referral-service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../partner/referral-service.js')>();
  return {
    ...actual,
    ReferralService: vi.fn(() => ({
      recordInvite: recordInviteMock,
    })),
  };
});

import {
  RechargeGateError,
  RechargeOrderIdempotencyConflictError,
} from '../../partner/recharge-service.js';
import { PartnerReferralConflictError } from '../../partner/referral-service.js';
import {
  WithdrawalGateError,
  WithdrawalRequestIdempotencyConflictError,
  WithdrawalValidationError,
} from '../../partner/withdrawal-service.js';
import { partnerRouter } from './partner.js';

class FakeUserLookupDb {
  readonly users: Array<{ id: number; externalId: string }>;
  readonly selectTables: string[] = [];

  constructor(usersInput: Array<{ id: number; externalId: string }> = [
    { id: 123, externalId: 'usr_partner' },
    { id: 456, externalId: 'usr_inviter' },
  ]) {
    this.users = usersInput;
  }

  select(_selection?: unknown) {
    return {
      from: (table: unknown) => {
        this.selectTables.push(tableName(table));
        return {
          where: (predicate: unknown) => ({
            limit: async () => {
              if (table !== users) return [];
              const predicateStrings = extractPredicateStrings(predicate);
              return this.users
                .filter((user) => predicateStrings.includes(user.externalId))
                .slice(0, 1);
            },
          }),
        };
      },
    };
  }
}

function tableName(table: unknown): string {
  return (table as Record<symbol, string> | null)?.[Symbol.for('drizzle:Name')] ?? 'unknown';
}

function extractPredicateStrings(value: unknown): string[] {
  const strings: string[] = [];
  const seen = new WeakSet<object>();

  function visit(current: unknown, depth: number): void {
    if (depth > 8 || current == null) return;
    if (typeof current === 'string') {
      strings.push(current);
      return;
    }
    if (typeof current !== 'object') return;
    if (seen.has(current)) return;
    seen.add(current);

    if (Array.isArray(current)) {
      for (const item of current) visit(item, depth + 1);
      return;
    }

    for (const item of Object.values(current as Record<string, unknown>)) {
      visit(item, depth + 1);
    }
  }

  visit(value, 0);
  return strings;
}

function makeContext(db = new FakeUserLookupDb()) {
  return {
    db,
    userId: 'usr_partner',
    logger: {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      debug: () => undefined,
      child: () => undefined,
    },
  } as unknown as Parameters<typeof partnerRouter.createCaller>[0];
}

describe('partnerRouter mutations', () => {
  const originalFlag = process.env.PARTNER_LEDGER_ENABLED;

  beforeEach(() => {
    process.env.PARTNER_LEDGER_ENABLED = 'true';
    createPendingOrderMock.mockReset();
    getKycStatusMock.mockReset();
    recordInviteMock.mockReset();
    requestWithdrawalMock.mockReset();
  });

  afterEach(() => {
    if (originalFlag === undefined) {
      delete process.env.PARTNER_LEDGER_ENABLED;
    } else {
      process.env.PARTNER_LEDGER_ENABLED = originalFlag;
    }
  });

  it('blocks new mutations when the partner ledger flag is disabled', async () => {
    delete process.env.PARTNER_LEDGER_ENABLED;
    const fakeDb = new FakeUserLookupDb();
    const caller = partnerRouter.createCaller(makeContext(fakeDb));

    await expect(
      caller.createMembershipOrder({ idempotencyKey: 'membership-disabled' }),
    ).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'partner ledger is disabled',
    });
    await expect(
      caller.createRechargeOrder({
        amountCnyCents: 10_000_00,
        idempotencyKey: 'recharge-disabled',
      }),
    ).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'partner ledger is disabled',
    });
    await expect(
      caller.requestWithdrawal({
        amountCreditCents: 500_00,
        bankAccountFingerprint: 'bank-fp-disabled',
        idempotencyKey: 'withdrawal-disabled',
      }),
    ).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'partner ledger is disabled',
    });
    await expect(
      caller.recordInvite({
        inviterExternalId: 'usr_inviter',
      }),
    ).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'partner ledger is disabled',
    });
    expect(fakeDb.selectTables).toEqual([]);
    expect(createPendingOrderMock).not.toHaveBeenCalled();
    expect(getKycStatusMock).not.toHaveBeenCalled();
    expect(recordInviteMock).not.toHaveBeenCalled();
    expect(requestWithdrawalMock).not.toHaveBeenCalled();
  });

  it('creates a membership order with the fixed price and returns a pending summary', async () => {
    createPendingOrderMock.mockResolvedValueOnce({
      externalId: 'payment_membership_1',
      provider: 'manual',
      orderKind: 'membership',
      amountCnyCents: PARTNER_MEMBERSHIP_PRICE_CNY_CENTS,
      status: 'pending',
    });

    await expect(
      partnerRouter.createCaller(makeContext()).createMembershipOrder({
        idempotencyKey: 'membership-idem-1',
      }),
    ).resolves.toEqual({
      orderExternalId: 'payment_membership_1',
      provider: 'manual',
      orderKind: 'membership',
      amountCnyCents: PARTNER_MEMBERSHIP_PRICE_CNY_CENTS,
      status: 'pending',
    });
    expect(createPendingOrderMock).toHaveBeenCalledWith({
      userId: 123,
      provider: 'manual',
      orderKind: 'membership',
      amountCnyCents: PARTNER_MEMBERSHIP_PRICE_CNY_CENTS,
      idempotencyKey: 'membership-idem-1',
    });
  });

  it('trims idempotency keys before creating membership orders', async () => {
    createPendingOrderMock.mockResolvedValueOnce({
      externalId: 'payment_membership_1',
      provider: 'manual',
      orderKind: 'membership',
      amountCnyCents: PARTNER_MEMBERSHIP_PRICE_CNY_CENTS,
      status: 'pending',
    });

    await partnerRouter.createCaller(makeContext()).createMembershipOrder({
      idempotencyKey: '  membership-idem-trimmed  ',
    });

    expect(createPendingOrderMock).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: 'membership-idem-trimmed',
      }),
    );
  });

  it('maps recharge membership and KYC gate failures to precondition errors', async () => {
    const caller = partnerRouter.createCaller(makeContext());
    createPendingOrderMock.mockRejectedValueOnce(new RechargeGateError('membership_required'));
    createPendingOrderMock.mockRejectedValueOnce(new RechargeGateError('kyc_required'));

    await expect(
      caller.createRechargeOrder({
        amountCnyCents: 10_000_00,
        idempotencyKey: 'recharge-membership-gate',
      }),
    ).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'partner membership required',
    });
    await expect(
      caller.createRechargeOrder({
        amountCnyCents: 10_000_00,
        idempotencyKey: 'recharge-kyc-gate',
      }),
    ).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'partner KYC must be passed before recharge',
    });
  });

  it('returns a recharge pending summary when the service succeeds', async () => {
    createPendingOrderMock.mockResolvedValueOnce({
      externalId: 'payment_recharge_1',
      provider: 'alipay',
      orderKind: 'recharge',
      amountCnyCents: 10_000_00,
      status: 'pending',
    });

    await expect(
      partnerRouter.createCaller(makeContext()).createRechargeOrder({
        amountCnyCents: 10_000_00,
        provider: 'alipay',
        idempotencyKey: 'recharge-idem-1',
      }),
    ).resolves.toEqual({
      orderExternalId: 'payment_recharge_1',
      provider: 'alipay',
      orderKind: 'recharge',
      amountCnyCents: 10_000_00,
      status: 'pending',
    });
    expect(createPendingOrderMock).toHaveBeenCalledWith({
      userId: 123,
      provider: 'alipay',
      orderKind: 'recharge',
      amountCnyCents: 10_000_00,
      idempotencyKey: 'recharge-idem-1',
    });
  });

  it('rejects non-integer recharge amounts before calling the service', async () => {
    await expect(
      partnerRouter.createCaller(makeContext()).createRechargeOrder({
        amountCnyCents: 10_000_00.5,
        idempotencyKey: 'recharge-fractional',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(createPendingOrderMock).not.toHaveBeenCalled();
  });

  it('maps recharge validation and idempotency errors', async () => {
    const caller = partnerRouter.createCaller(makeContext());
    createPendingOrderMock.mockRejectedValueOnce(new RangeError('below_minimum'));
    createPendingOrderMock.mockRejectedValueOnce(new RechargeOrderIdempotencyConflictError());

    await expect(
      caller.createRechargeOrder({
        amountCnyCents: 9_999_00,
        idempotencyKey: 'recharge-range-error',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'below_minimum' });
    await expect(
      caller.createRechargeOrder({
        amountCnyCents: 10_000_00,
        idempotencyKey: 'recharge-conflict',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('sanitizes unknown recharge service errors', async () => {
    createPendingOrderMock.mockRejectedValueOnce(new Error('database stack details'));

    await expect(
      partnerRouter.createCaller(makeContext()).createRechargeOrder({
        amountCnyCents: 10_000_00,
        idempotencyKey: 'recharge-unknown-error',
      }),
    ).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'failed to create partner recharge order',
    });
  });

  it('records an invite for the current user from an inviter external id', async () => {
    recordInviteMock.mockResolvedValueOnce({
      externalId: 'payment_referral_1',
      inviterUserId: 456,
      inviteeUserId: 123,
      status: 'pending',
      assisted: 1,
    });

    await expect(
      partnerRouter.createCaller(makeContext()).recordInvite({
        inviterExternalId: '  usr_inviter  ',
        assisted: true,
      }),
    ).resolves.toEqual({
      referralExternalId: 'payment_referral_1',
      inviterExternalId: 'usr_inviter',
      inviteeExternalId: 'usr_partner',
      status: 'pending',
      assisted: true,
    });
    expect(recordInviteMock).toHaveBeenCalledWith({
      inviterUserId: 456,
      inviteeUserId: 123,
      assisted: true,
    });
  });

  it('maps missing inviter and referral conflicts for invite recording', async () => {
    await expect(
      partnerRouter.createCaller(makeContext(new FakeUserLookupDb([{ id: 123, externalId: 'usr_partner' }]))).recordInvite({
        inviterExternalId: 'usr_missing',
      }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'inviter user was not found',
    });
    expect(recordInviteMock).not.toHaveBeenCalled();

    recordInviteMock.mockRejectedValueOnce(new PartnerReferralConflictError());
    await expect(
      partnerRouter.createCaller(makeContext()).recordInvite({
        inviterExternalId: 'usr_inviter',
      }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'partner referral attribution conflict',
    });
  });

  it('derives high-risk review withdrawal requests because same-name bank checks are unavailable', async () => {
    const reviewDueAt = new Date('2026-04-15T00:00:00.000Z');
    getKycStatusMock.mockResolvedValueOnce('passed');
    requestWithdrawalMock.mockResolvedValueOnce({
      externalId: 'payment_withdrawal_1',
      amountCreditCents: 1_000_00,
      status: 'reviewing',
      reviewDueAt,
      riskScore: 25,
    });

    await expect(
      partnerRouter.createCaller(makeContext()).requestWithdrawal({
        amountCreditCents: 1_000_00,
        bankAccountFingerprint: 'bank-fp-1',
        idempotencyKey: 'withdrawal-idem-1',
      }),
    ).resolves.toEqual({
      withdrawalExternalId: 'payment_withdrawal_1',
      amountCreditCents: 1_000_00,
      status: 'reviewing',
      reviewDueAt,
      riskScore: 25,
    });
    expect(getKycStatusMock).toHaveBeenCalledWith(123);
    expect(requestWithdrawalMock).toHaveBeenCalledWith({
      userId: 123,
      amountCreditCents: 1_000_00,
      bankAccountFingerprint: 'bank-fp-1',
      highRisk: true,
      riskScore: 25,
      idempotencyKey: 'withdrawal-idem-1',
    });
  });

  it('trims withdrawal string inputs and rejects non-integer amounts before the service', async () => {
    const reviewDueAt = new Date('2026-04-15T00:00:00.000Z');
    getKycStatusMock.mockResolvedValueOnce('passed');
    requestWithdrawalMock.mockResolvedValueOnce({
      externalId: 'payment_withdrawal_1',
      amountCreditCents: 1_000_00,
      status: 'reviewing',
      reviewDueAt,
      riskScore: 25,
    });

    await partnerRouter.createCaller(makeContext()).requestWithdrawal({
      amountCreditCents: 1_000_00,
      bankAccountFingerprint: '  bank-fp-trimmed  ',
      idempotencyKey: '  withdrawal-idem-trimmed  ',
    });
    expect(requestWithdrawalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        bankAccountFingerprint: 'bank-fp-trimmed',
        idempotencyKey: 'withdrawal-idem-trimmed',
      }),
    );

    await expect(
      partnerRouter.createCaller(makeContext()).requestWithdrawal({
        amountCreditCents: 500_00.5,
        bankAccountFingerprint: 'bank-fp-fractional',
        idempotencyKey: 'withdrawal-fractional',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(requestWithdrawalMock).toHaveBeenCalledTimes(1);
  });

  it('maps withdrawal gate, validation, and idempotency errors', async () => {
    const caller = partnerRouter.createCaller(makeContext());
    getKycStatusMock.mockResolvedValue('passed');
    requestWithdrawalMock.mockRejectedValueOnce(new WithdrawalGateError('kyc_required'));
    requestWithdrawalMock.mockRejectedValueOnce(new WithdrawalValidationError('below_minimum'));
    requestWithdrawalMock.mockRejectedValueOnce(
      new WithdrawalValidationError('insufficient_available_credit'),
    );
    requestWithdrawalMock.mockRejectedValueOnce(new WithdrawalRequestIdempotencyConflictError());

    await expect(
      caller.requestWithdrawal({
        amountCreditCents: 500_00,
        bankAccountFingerprint: 'bank-fp-kyc',
        idempotencyKey: 'withdrawal-kyc-gate',
      }),
    ).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'partner KYC must be passed before withdrawal',
    });
    await expect(
      caller.requestWithdrawal({
        amountCreditCents: 499_00,
        bankAccountFingerprint: 'bank-fp-below-minimum',
        idempotencyKey: 'withdrawal-below-minimum',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'below_minimum' });
    await expect(
      caller.requestWithdrawal({
        amountCreditCents: 10_000_00,
        bankAccountFingerprint: 'bank-fp-insufficient',
        idempotencyKey: 'withdrawal-insufficient',
      }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'insufficient_available_credit',
    });
    await expect(
      caller.requestWithdrawal({
        amountCreditCents: 500_00,
        bankAccountFingerprint: 'bank-fp-conflict',
        idempotencyKey: 'withdrawal-conflict',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('sanitizes unknown withdrawal service errors', async () => {
    getKycStatusMock.mockResolvedValueOnce('passed');
    requestWithdrawalMock.mockRejectedValueOnce(new Error('withdrawal stack details'));

    await expect(
      partnerRouter.createCaller(makeContext()).requestWithdrawal({
        amountCreditCents: 500_00,
        bankAccountFingerprint: 'bank-fp-unknown-error',
        idempotencyKey: 'withdrawal-unknown-error',
      }),
    ).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'failed to request partner withdrawal',
    });
  });
});
