import { inspect } from 'node:util';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  partnerRechargeOrders,
  type PartnerLot,
  type PartnerRechargeOrder,
  type PartnerWithdrawalRequest,
} from '../../db/schema/partner.js';
import { users } from '../../db/schema/users.js';

const {
  confirmCapturedOrderMock,
  approveReviewRequiredOrderMock,
  upsertKycStatusMock,
  approveWithdrawalMock,
  rejectWithdrawalMock,
  markWithdrawalPaidMock,
  freezeRiskLotMock,
  resumeRiskLotMock,
  closeRiskLotMock,
} = vi.hoisted(() => ({
  confirmCapturedOrderMock: vi.fn(),
  approveReviewRequiredOrderMock: vi.fn(),
  upsertKycStatusMock: vi.fn(),
  approveWithdrawalMock: vi.fn(),
  rejectWithdrawalMock: vi.fn(),
  markWithdrawalPaidMock: vi.fn(),
  freezeRiskLotMock: vi.fn(),
  resumeRiskLotMock: vi.fn(),
  closeRiskLotMock: vi.fn(),
}));

vi.mock('../../partner/payment-confirm-service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../partner/payment-confirm-service.js')>();
  return {
    ...actual,
    PartnerPaymentConfirmService: vi.fn(() => ({
      confirmCapturedOrder: confirmCapturedOrderMock,
      approveReviewRequiredOrder: approveReviewRequiredOrderMock,
    })),
  };
});

vi.mock('../../partner/kyc-service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../partner/kyc-service.js')>();
  return {
    ...actual,
    KycService: vi.fn(() => ({
      upsertStatus: upsertKycStatusMock,
    })),
  };
});

vi.mock('../../partner/withdrawal-service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../partner/withdrawal-service.js')>();
  return {
    ...actual,
    WithdrawalService: vi.fn(() => ({
      approveWithdrawal: approveWithdrawalMock,
      rejectWithdrawal: rejectWithdrawalMock,
      markWithdrawalPaid: markWithdrawalPaidMock,
    })),
  };
});

vi.mock('../../partner/risk-lot-service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../partner/risk-lot-service.js')>();
  return {
    ...actual,
    PartnerRiskLotService: vi.fn(() => ({
      freezeLot: freezeRiskLotMock,
      resumeLot: resumeRiskLotMock,
      closeLot: closeRiskLotMock,
    })),
  };
});

import { adminRouter } from './admin.js';
import { __adminPartnerInternals } from './admin-partner.js';
import { WithdrawalGateError } from '../../partner/withdrawal-service.js';
import { PartnerRiskLotTransitionError } from '../../partner/risk-lot-service.js';

type FakeUserRow = {
  id: number;
  externalId: string;
  email: string | null;
  displayName: string | null;
  role: string;
};

class FakeAdminPartnerDb {
  readonly users: FakeUserRow[] = [
    {
      id: 1,
      externalId: 'usr_admin',
      email: 'admin@holaday.local',
      displayName: 'Admin',
      role: 'admin',
    },
    {
      id: 123,
      externalId: 'usr_partner',
      email: 'partner@holaday.local',
      displayName: 'Partner User',
      role: 'user',
    },
  ];
  readonly orders: PartnerRechargeOrder[];

  constructor(input: { adminRole?: string; orders?: PartnerRechargeOrder[] } = {}) {
    if (input.adminRole) {
      const admin = this.users[0];
      if (admin) this.users[0] = { ...admin, role: input.adminRole };
    }
    this.orders = input.orders ?? [fakeOrder()];
  }

  select(_selection?: unknown) {
    return {
      from: (table: unknown) => this.queryBuilder(table),
    };
  }

  private queryBuilder(table: unknown) {
    const builder = {
      innerJoin: (_joinTable: unknown, _predicate: unknown) => builder,
      where: (predicate: unknown) => {
        const predicateText = inspect(predicate, { depth: 6, getters: true });
        const chain = {
          orderBy: (_order: unknown) => chain,
          limit: async (count: number) => this.selectRows(table, predicateText).slice(0, count),
        };
        return chain;
      },
      orderBy: (_order: unknown) => builder,
      limit: async (count: number) => this.selectRows(table, '').slice(0, count),
    };
    return builder;
  }

  private selectRows(table: unknown, predicateText: string): unknown[] {
    if (table === users) {
      const row = this.users.find((user) => predicateText.includes(user.externalId));
      return row ? [row] : [];
    }
    if (table === partnerRechargeOrders) {
      const row = this.orders.find((order) => predicateText.includes(order.externalId));
      return row ? [row] : [];
    }
    return [];
  }
}

function fakeOrder(overrides: Partial<PartnerRechargeOrder> = {}): PartnerRechargeOrder {
  return {
    id: 10,
    externalId: 'pay_order_1',
    userId: 123,
    provider: 'manual',
    providerOrderId: null,
    providerCaptureId: null,
    amountCnyCents: 10_000_00,
    status: 'pending',
    orderKind: 'recharge',
    idempotencyKey: 'recharge-idem-1',
    metadata: null,
    createdAt: new Date('2026-07-03T01:00:00.000Z'),
    updatedAt: new Date('2026-07-03T01:00:00.000Z'),
    ...overrides,
  };
}

function fakeWithdrawal(overrides: Partial<PartnerWithdrawalRequest> = {}): PartnerWithdrawalRequest {
  return {
    id: 20,
    externalId: 'pay_withdrawal_1',
    userId: 123,
    amountCreditCents: 600_00,
    status: 'approved',
    reviewDueAt: new Date('2026-07-10T01:00:00.000Z'),
    bankAccountFingerprint: 'bank_fingerprint_123',
    riskScore: 20,
    idempotencyKey: 'withdrawal-idem-1',
    rejectionReason: null,
    metadata: null,
    createdAt: new Date('2026-07-03T01:00:00.000Z'),
    updatedAt: new Date('2026-07-03T01:00:00.000Z'),
    ...overrides,
  };
}

function fakeLot(overrides: Partial<PartnerLot> = {}): PartnerLot {
  return {
    id: 30,
    externalId: 'pay_risk_lot_1',
    userId: 123,
    rechargeOrderId: 10,
    status: 'accumulating',
    riskStatus: 'review',
    principalCreditCents: 10_000_00,
    tierMultiplierBps: 10_500,
    apiUnits: 10_500_000,
    bonusCapCreditCents: 2_000_00,
    lockedBonusCreditCents: 0,
    releasedPrincipalCreditCents: 0,
    releasedBonusCreditCents: 0,
    carryForwardCreditCents: 0,
    accumulationStartsAt: new Date('2026-07-03T01:00:00.000Z'),
    accumulationEndsAt: new Date('2026-10-31T01:00:00.000Z'),
    releaseStartsAt: new Date('2026-11-01T01:00:00.000Z'),
    releaseEndsAt: new Date('2027-11-01T01:00:00.000Z'),
    metadata: null,
    createdAt: new Date('2026-07-03T01:00:00.000Z'),
    updatedAt: new Date('2026-07-03T01:00:00.000Z'),
    ...overrides,
  };
}

function makeContext(db = new FakeAdminPartnerDb()) {
  return {
    db,
    userId: 'usr_admin',
    logger: {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      debug: () => undefined,
      child: () => undefined,
    },
  } as unknown as Parameters<typeof adminRouter.createCaller>[0];
}

describe('admin.partner router', () => {
  const originalFlag = process.env.PARTNER_LEDGER_ENABLED;

  beforeEach(() => {
    process.env.PARTNER_LEDGER_ENABLED = 'true';
    confirmCapturedOrderMock.mockReset();
    approveReviewRequiredOrderMock.mockReset();
    upsertKycStatusMock.mockReset();
    approveWithdrawalMock.mockReset();
    rejectWithdrawalMock.mockReset();
    markWithdrawalPaidMock.mockReset();
    freezeRiskLotMock.mockReset();
    resumeRiskLotMock.mockReset();
    closeRiskLotMock.mockReset();
  });

  afterEach(() => {
    if (originalFlag === undefined) {
      delete process.env.PARTNER_LEDGER_ENABLED;
    } else {
      process.env.PARTNER_LEDGER_ENABLED = originalFlag;
    }
  });

  it('is mounted under admin.partner and keeps the admin role gate', async () => {
    const caller = adminRouter.createCaller(makeContext(new FakeAdminPartnerDb({ adminRole: 'user' })));

    await expect(caller.partner.overview()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('returns disabled overview without reading partner service state when the feature flag is off', async () => {
    delete process.env.PARTNER_LEDGER_ENABLED;

    await expect(adminRouter.createCaller(makeContext()).partner.overview()).resolves.toEqual({
      enabled: false,
    });
    expect(upsertKycStatusMock).not.toHaveBeenCalled();
    expect(confirmCapturedOrderMock).not.toHaveBeenCalled();
  });

  it('upserts KYC status with the target user and admin reviewer ids', async () => {
    upsertKycStatusMock.mockResolvedValueOnce({
      externalId: 'pay_kyc_1',
      userId: 123,
      status: 'passed',
      country: 'CN',
      provider: 'cn-bankcard',
      providerRef: 'bankcard-verify-1',
      reviewedAt: new Date('2026-07-03T02:00:00.000Z'),
    });

    const result = await adminRouter.createCaller(makeContext()).partner.setKycStatus({
      userExternalId: 'usr_partner',
      status: 'passed',
      provider: 'cn-bankcard',
      providerRef: 'bankcard-verify-1',
      bankCardHash: 'bank_hash_123',
      note: 'same-name bank card verified',
    });

    expect(result).toMatchObject({
      kycExternalId: 'pay_kyc_1',
      userExternalId: 'usr_partner',
      status: 'passed',
      provider: 'cn-bankcard',
    });
    expect(upsertKycStatusMock).toHaveBeenCalledWith({
      userId: 123,
      status: 'passed',
      provider: 'cn-bankcard',
      providerRef: 'bankcard-verify-1',
      bankCardHash: 'bank_hash_123',
      reviewerUserId: 1,
      note: 'same-name bank card verified',
    });
  });

  it('confirms an order through the payment confirmation service using stored provider data', async () => {
    confirmCapturedOrderMock.mockResolvedValueOnce({
      ok: true,
      status: 'completed',
      orderExternalId: 'pay_order_1',
      orderKind: 'recharge',
      deduped: false,
    });

    const result = await adminRouter.createCaller(makeContext()).partner.confirmOrder({
      orderExternalId: 'pay_order_1',
    });

    expect(result).toMatchObject({
      status: 'completed',
      orderExternalId: 'pay_order_1',
      orderKind: 'recharge',
    });
    expect(confirmCapturedOrderMock).toHaveBeenCalledWith({
      orderExternalId: 'pay_order_1',
      provider: 'manual',
      providerCaptureId: 'manual:pay_order_1',
      amountCnyCents: 10_000_00,
    });
  });

  it('approves a review-required order with the admin reviewer id', async () => {
    approveReviewRequiredOrderMock.mockResolvedValueOnce({
      ok: true,
      status: 'completed',
      orderExternalId: 'pay_order_1',
      orderKind: 'recharge',
      deduped: false,
    });

    const result = await adminRouter.createCaller(makeContext()).partner.approveReviewRequiredOrder({
      orderExternalId: 'pay_order_1',
      note: '人工复核放行',
    });

    expect(result).toMatchObject({
      status: 'completed',
      orderExternalId: 'pay_order_1',
      orderKind: 'recharge',
    });
    expect(approveReviewRequiredOrderMock).toHaveBeenCalledWith({
      orderExternalId: 'pay_order_1',
      reviewerUserId: 1,
      note: '人工复核放行',
    });
  });

  it('passes withdrawal review actions through the ledger-aware service', async () => {
    approveWithdrawalMock.mockResolvedValueOnce(fakeWithdrawal({ status: 'approved' }));
    rejectWithdrawalMock.mockResolvedValueOnce(fakeWithdrawal({ status: 'rejected', rejectionReason: 'bank mismatch' }));
    markWithdrawalPaidMock.mockResolvedValueOnce(fakeWithdrawal({ status: 'paid' }));
    const caller = adminRouter.createCaller(makeContext()).partner;

    await expect(
      caller.approveWithdrawal({
        withdrawalExternalId: 'pay_withdrawal_1',
        note: 'bank checked',
      }),
    ).resolves.toMatchObject({ status: 'approved' });
    await expect(
      caller.rejectWithdrawal({
        withdrawalExternalId: 'pay_withdrawal_1',
        reason: 'bank mismatch',
      }),
    ).resolves.toMatchObject({ status: 'rejected' });
    await expect(
      caller.markWithdrawalPaid({
        withdrawalExternalId: 'pay_withdrawal_1',
        providerPayoutId: 'bank-payout-1',
      }),
    ).resolves.toMatchObject({ status: 'paid' });

    expect(approveWithdrawalMock).toHaveBeenCalledWith({
      withdrawalExternalId: 'pay_withdrawal_1',
      reviewerUserId: 1,
      note: 'bank checked',
    });
    expect(rejectWithdrawalMock).toHaveBeenCalledWith({
      withdrawalExternalId: 'pay_withdrawal_1',
      reviewerUserId: 1,
      reason: 'bank mismatch',
    });
    expect(markWithdrawalPaidMock).toHaveBeenCalledWith({
      withdrawalExternalId: 'pay_withdrawal_1',
      reviewerUserId: 1,
      providerPayoutId: 'bank-payout-1',
    });
  });

  it('maps frozen withdrawal review gates to precondition failures', async () => {
    approveWithdrawalMock.mockRejectedValueOnce(new WithdrawalGateError('risk_frozen'));

    await expect(
      adminRouter.createCaller(makeContext()).partner.approveWithdrawal({
        withdrawalExternalId: 'pay_withdrawal_1',
        note: 'bank checked',
      }),
    ).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'partner withdrawal is frozen by risk control',
    });
  });

  it('maps bank-card withdrawal gates to precondition failures', async () => {
    approveWithdrawalMock.mockRejectedValueOnce(new WithdrawalGateError('bank_account_mismatch'));

    await expect(
      adminRouter.createCaller(makeContext()).partner.approveWithdrawal({
        withdrawalExternalId: 'pay_withdrawal_1',
        note: 'bank checked',
      }),
    ).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'partner withdrawal bank account must match KYC bank card',
    });
  });

  it('passes risk lot freeze, resume, and close actions through the risk lot service', async () => {
    freezeRiskLotMock.mockResolvedValueOnce(fakeLot({ status: 'frozen', riskStatus: 'frozen' }));
    resumeRiskLotMock.mockResolvedValueOnce(fakeLot({ status: 'releasing', riskStatus: 'review' }));
    closeRiskLotMock.mockResolvedValueOnce(fakeLot({ status: 'closed', riskStatus: 'frozen' }));
    const caller = adminRouter.createCaller(makeContext()).partner;

    await expect(
      caller.freezeRiskLot({
        lotExternalId: 'pay_risk_lot_1',
        reason: 'bank dispute signal',
      }),
    ).resolves.toMatchObject({ lotExternalId: 'pay_risk_lot_1', status: 'frozen', riskStatus: 'frozen' });
    await expect(
      caller.resumeRiskLot({
        lotExternalId: 'pay_risk_lot_1',
        note: 'manual review cleared',
      }),
    ).resolves.toMatchObject({ lotExternalId: 'pay_risk_lot_1', status: 'releasing', riskStatus: 'review' });
    await expect(
      caller.closeRiskLot({
        lotExternalId: 'pay_risk_lot_1',
        reason: 'provider refund completed',
        resolutionKind: 'refund',
        resolutionRef: 'wx-refund-20260705',
      }),
    ).resolves.toMatchObject({ lotExternalId: 'pay_risk_lot_1', status: 'closed', riskStatus: 'frozen' });

    expect(freezeRiskLotMock).toHaveBeenCalledWith({
      lotExternalId: 'pay_risk_lot_1',
      reviewerUserId: 1,
      reason: 'bank dispute signal',
    });
    expect(resumeRiskLotMock).toHaveBeenCalledWith({
      lotExternalId: 'pay_risk_lot_1',
      reviewerUserId: 1,
      note: 'manual review cleared',
    });
    expect(closeRiskLotMock).toHaveBeenCalledWith({
      lotExternalId: 'pay_risk_lot_1',
      reviewerUserId: 1,
      reason: 'provider refund completed',
      resolutionKind: 'refund',
      resolutionRef: 'wx-refund-20260705',
    });
  });

  it('maps missing risk lots to not-found responses', async () => {
    freezeRiskLotMock.mockRejectedValueOnce(new PartnerRiskLotTransitionError('not_found'));

    await expect(
      adminRouter.createCaller(makeContext()).partner.freezeRiskLot({
        lotExternalId: 'pay_missing_lot',
        reason: 'bank dispute signal',
      }),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'partner risk lot not found',
    });
  });

  it('summarizes withdrawal queue metrics by workflow stage', () => {
    const summarizeWithdrawalMetrics = (
      __adminPartnerInternals as typeof __adminPartnerInternals & {
        summarizeWithdrawalMetrics: (
          rows: PartnerWithdrawalRequest[],
          now: Date,
        ) => Record<string, number>;
      }
    ).summarizeWithdrawalMetrics;
    const now = new Date('2026-07-03T04:00:00.000Z');

    expect(
      summarizeWithdrawalMetrics(
        [
          fakeWithdrawal({
            externalId: 'pay_withdrawal_requested',
            status: 'requested',
            reviewDueAt: new Date('2026-07-03T03:00:00.000Z'),
          }),
          fakeWithdrawal({ externalId: 'pay_withdrawal_reviewing', status: 'reviewing' }),
          fakeWithdrawal({ externalId: 'pay_withdrawal_approved', status: 'approved' }),
          fakeWithdrawal({ externalId: 'pay_withdrawal_paid', status: 'paid' }),
          fakeWithdrawal({ externalId: 'pay_withdrawal_rejected', status: 'rejected' }),
          fakeWithdrawal({ externalId: 'pay_withdrawal_returned', status: 'returned' }),
        ],
        now,
      ),
    ).toEqual({
      pendingWithdrawalCount: 2,
      approvedWithdrawalCount: 1,
      paidWithdrawalCount: 1,
      rejectedWithdrawalCount: 1,
      returnedWithdrawalCount: 1,
      overdueWithdrawalCount: 1,
    });
  });

  it('summarizes partner reconciliation rows for operator export', () => {
    const summarizePartnerReconciliation = (
      __adminPartnerInternals as typeof __adminPartnerInternals & {
        summarizePartnerReconciliation: (input: {
          orders: Array<Record<string, unknown>>;
          withdrawals: Array<Record<string, unknown>>;
        }) => Record<string, unknown>;
      }
    ).summarizePartnerReconciliation;

    expect(
      summarizePartnerReconciliation({
        orders: [
          {
            orderExternalId: 'pay_membership_completed',
            userExternalId: 'usr_partner',
            orderKind: 'membership',
            provider: 'wechat',
            amountCnyCents: 999_00,
            status: 'completed',
            providerCaptureId: 'wx-cap-1',
          },
          {
            orderExternalId: 'pay_recharge_completed',
            userExternalId: 'usr_partner',
            orderKind: 'recharge',
            provider: 'alipay',
            amountCnyCents: 10_000_00,
            status: 'completed',
            providerCaptureId: 'ali-cap-1',
          },
          {
            orderExternalId: 'pay_recharge_review',
            userExternalId: 'usr_partner',
            orderKind: 'recharge',
            provider: 'wechat',
            amountCnyCents: 20_000_00,
            status: 'review_required',
            providerCaptureId: 'wx-cap-review',
          },
        ],
        withdrawals: [
          {
            withdrawalExternalId: 'pay_withdrawal_paid',
            userExternalId: 'usr_partner',
            amountCreditCents: 600_00,
            status: 'paid',
          },
          {
            withdrawalExternalId: 'pay_withdrawal_approved',
            userExternalId: 'usr_partner',
            amountCreditCents: 700_00,
            status: 'approved',
          },
        ],
      }),
    ).toMatchObject({
      metrics: {
        orderCount: 3,
        completedOrderCount: 2,
        pendingOrderCount: 0,
        reviewRequiredOrderCount: 1,
        membershipRevenueCnyCents: 999_00,
        rechargePrincipalCnyCents: 10_000_00,
        paidWithdrawalCreditCents: 600_00,
        approvedWithdrawalCreditCents: 700_00,
      },
      providerBreakdown: [
        {
          provider: 'alipay',
          completedOrderCount: 1,
          completedAmountCnyCents: 10_000_00,
        },
        {
          provider: 'wechat',
          completedOrderCount: 1,
          completedAmountCnyCents: 999_00,
        },
      ],
    });
  });

  it('summarizes partner order, KYC, withdrawal, and risk lot audit metadata for review queues', () => {
    const order = __adminPartnerInternals.summarizeOrder(
      fakeOrder({
        status: 'review_required',
        metadata: {
          reviewReason: 'lot_creation_failed',
          errorName: 'RechargeLotConflictError',
          errorMessage: 'monthly cap exceeded',
          reviewApprovedByUserId: 77,
          reviewApprovedAt: '2026-07-03T04:00:00.000Z',
          reviewApprovalNote: '人工复核放行',
        },
      }),
    );
    expect(order).toMatchObject({
      reviewReason: 'lot_creation_failed',
      reviewErrorName: 'RechargeLotConflictError',
      reviewErrorMessage: 'monthly cap exceeded',
      reviewApprovedByUserId: 77,
      reviewApprovedAt: '2026-07-03T04:00:00.000Z',
      reviewApprovalNote: '人工复核放行',
    });

    const kyc = (
      __adminPartnerInternals as typeof __adminPartnerInternals & {
        summarizeKycProfile: (row: Record<string, unknown>) => Record<string, unknown>;
      }
    ).summarizeKycProfile({
      kycExternalId: 'pay_kyc_1',
      userExternalId: 'usr_partner',
      email: 'partner@holaday.local',
      displayName: 'Partner User',
      status: 'review_required',
      country: 'CN',
      provider: 'cn-bankcard',
      providerRef: 'bankcard-flow-1',
      reviewedAt: new Date('2026-07-03T04:00:00.000Z'),
      updatedAt: new Date('2026-07-03T04:10:00.000Z'),
      metadata: {
        source: 'cn-bankcard',
        reviewerUserId: 77,
        note: '银行卡四要素通过，证件照待复核',
      },
    });
    expect(kyc).toMatchObject({
      kycExternalId: 'pay_kyc_1',
      reviewerUserId: 77,
      reviewNote: '银行卡四要素通过，证件照待复核',
      reviewSource: 'cn-bankcard',
    });
    expect(kyc).not.toHaveProperty('metadata');

    const withdrawal = __adminPartnerInternals.summarizeWithdrawal(
      fakeWithdrawal({
        bankAccountFingerprint: 'bank_fp_123',
        metadata: {
          approvedByUserId: 88,
          approvedAt: '2026-07-03T05:00:00.000Z',
          approvalNote: 'bank checked',
          providerPayoutId: 'bank-payout-1',
          paidAt: '2026-07-03T06:00:00.000Z',
        },
      }),
    );
    expect(withdrawal).toMatchObject({
      bankAccountFingerprint: 'bank_fp_123',
      approvedByUserId: 88,
      approvedAt: '2026-07-03T05:00:00.000Z',
      approvalNote: 'bank checked',
      providerPayoutId: 'bank-payout-1',
      paidAt: '2026-07-03T06:00:00.000Z',
    });

    const riskLot = (
      __adminPartnerInternals as typeof __adminPartnerInternals & {
        summarizeRiskLotQueueRow: (row: Record<string, unknown>) => Record<string, unknown>;
      }
    ).summarizeRiskLotQueueRow({
      lotExternalId: 'pay_risk_lot_1',
      status: 'frozen',
      riskStatus: 'frozen',
      metadata: {
        riskFrozenByUserId: 99,
        riskFrozenAt: '2026-07-03T09:00:00.000Z',
        riskFreezeReason: 'bank dispute signal',
        riskResumedByUserId: 100,
        riskResumedAt: '2026-07-04T10:00:00.000Z',
        riskResumeNote: 'manual review cleared',
        riskClosedByUserId: 101,
        riskClosedAt: '2026-07-05T11:00:00.000Z',
        riskCloseReason: 'provider refund completed',
        riskCloseResolutionKind: 'refund',
        riskCloseResolutionRef: 'wx-refund-20260705',
      },
    });
    expect(riskLot).toMatchObject({
      lotExternalId: 'pay_risk_lot_1',
      riskFrozenByUserId: 99,
      riskFrozenAt: '2026-07-03T09:00:00.000Z',
      riskFreezeReason: 'bank dispute signal',
      riskResumedByUserId: 100,
      riskResumedAt: '2026-07-04T10:00:00.000Z',
      riskResumeNote: 'manual review cleared',
      riskClosedByUserId: 101,
      riskClosedAt: '2026-07-05T11:00:00.000Z',
      riskCloseReason: 'provider refund completed',
      riskCloseResolutionKind: 'refund',
      riskCloseResolutionRef: 'wx-refund-20260705',
    });
    expect(riskLot).not.toHaveProperty('metadata');

    const riskEvent = (
      __adminPartnerInternals as typeof __adminPartnerInternals & {
        summarizeRiskEventQueueRow: (row: Record<string, unknown>) => Record<string, unknown>;
      }
    ).summarizeRiskEventQueueRow({
      riskEventExternalId: 'pay_risk_event_1',
      eventType: 'lot_closed',
      severity: 'high',
      status: 'closed',
      metadata: {
        reviewerUserId: 101,
        reason: 'provider refund completed',
        resolutionKind: 'refund',
        resolutionRef: 'wx-refund-20260705',
        note: 'manual close after refund',
      },
    });
    expect(riskEvent).toMatchObject({
      riskEventExternalId: 'pay_risk_event_1',
      eventType: 'lot_closed',
      reviewerUserId: 101,
      riskReason: 'provider refund completed',
      riskResolutionKind: 'refund',
      riskResolutionRef: 'wx-refund-20260705',
      riskNote: 'manual close after refund',
    });
    expect(riskEvent).not.toHaveProperty('metadata');
  });
});
