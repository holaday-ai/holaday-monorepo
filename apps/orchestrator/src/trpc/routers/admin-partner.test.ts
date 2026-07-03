import { inspect } from 'node:util';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { partnerRechargeOrders, type PartnerRechargeOrder, type PartnerWithdrawalRequest } from '../../db/schema/partner.js';
import { users } from '../../db/schema/users.js';

const {
  confirmCapturedOrderMock,
  upsertKycStatusMock,
  approveWithdrawalMock,
  rejectWithdrawalMock,
  markWithdrawalPaidMock,
} = vi.hoisted(() => ({
  confirmCapturedOrderMock: vi.fn(),
  upsertKycStatusMock: vi.fn(),
  approveWithdrawalMock: vi.fn(),
  rejectWithdrawalMock: vi.fn(),
  markWithdrawalPaidMock: vi.fn(),
}));

vi.mock('../../partner/payment-confirm-service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../partner/payment-confirm-service.js')>();
  return {
    ...actual,
    PartnerPaymentConfirmService: vi.fn(() => ({
      confirmCapturedOrder: confirmCapturedOrderMock,
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

import { adminRouter } from './admin.js';

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
    upsertKycStatusMock.mockReset();
    approveWithdrawalMock.mockReset();
    rejectWithdrawalMock.mockReset();
    markWithdrawalPaidMock.mockReset();
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
});
