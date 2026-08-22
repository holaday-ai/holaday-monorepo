import { inspect } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type HolaCreditLedgerEntry,
  type PartnerActivityEvent,
  type PartnerKycProfile,
  type PartnerLot,
  type PartnerMembership,
  type PartnerRechargeOrder,
  type PartnerReferral,
  type PartnerWithdrawalRequest,
  holaCreditLedgerEntries,
  partnerActivityEvents,
  partnerKycProfiles,
  partnerLots,
  partnerMemberships,
  partnerRechargeOrders,
  partnerReferrals,
  partnerWithdrawalRequests,
} from '../../db/schema/partner.js';
import { type User, users } from '../../db/schema/users.js';
import { appRouter } from '../router.js';
import { partnerRouter } from './partner.js';

class FakePartnerDb {
  readonly users: User[];
  readonly memberships: PartnerMembership[];
  readonly kycProfiles: PartnerKycProfile[];
  readonly ledgerEntries: HolaCreditLedgerEntry[];
  readonly activityEvents: PartnerActivityEvent[];
  readonly lots: PartnerLot[];
  readonly orders: PartnerRechargeOrder[];
  readonly withdrawals: PartnerWithdrawalRequest[];
  readonly referrals: PartnerReferral[];
  readonly selectTables: string[] = [];

  constructor(
    input: {
      users?: User[];
      memberships?: PartnerMembership[];
      kycProfiles?: PartnerKycProfile[];
      ledgerEntries?: HolaCreditLedgerEntry[];
      activityEvents?: PartnerActivityEvent[];
      lots?: PartnerLot[];
      orders?: PartnerRechargeOrder[];
      withdrawals?: PartnerWithdrawalRequest[];
      referrals?: PartnerReferral[];
    } = {},
  ) {
    this.users = [...(input.users ?? [fakeUser()])];
    this.memberships = [...(input.memberships ?? [])];
    this.kycProfiles = [...(input.kycProfiles ?? [])];
    this.ledgerEntries = [...(input.ledgerEntries ?? [])];
    this.activityEvents = [...(input.activityEvents ?? [])];
    this.lots = [...(input.lots ?? [])];
    this.orders = [...(input.orders ?? [])];
    this.withdrawals = [...(input.withdrawals ?? [])];
    this.referrals = [...(input.referrals ?? [])];
  }

  asContext(userId = 'usr_partner') {
    return {
      db: this,
      userId,
      logger: {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
        debug: () => undefined,
        child: () => undefined,
      },
    } as unknown as Parameters<typeof partnerRouter.createCaller>[0];
  }

  select(_selection?: unknown) {
    return {
      from: (table: unknown) => {
        this.selectTables.push(tableName(table));
        return {
          where: (predicate: unknown) => this.queryRows(table, predicate),
        };
      },
    };
  }

  private queryRows(table: unknown, predicate: unknown) {
    const predicateText = inspect(predicate, { depth: 8, getters: true });
    const rows = this.rowsForTable(table, predicateText);
    const chain = {
      orderBy: () => ({
        limit: async (count: number) => rows.slice(0, count),
      }),
      limit: async (count: number) => rows.slice(0, count),
      then: (
        onFulfilled?: ((value: Array<unknown>) => unknown) | null,
        onRejected?: ((reason: unknown) => unknown) | null,
      ) => Promise.resolve(rows).then(onFulfilled, onRejected),
    };
    return chain;
  }

  private rowsForTable(table: unknown, predicateText: string): Array<unknown> {
    if (table === users) {
      return this.users.filter((user) => predicateText.includes(user.externalId));
    }
    if (table === partnerMemberships) {
      return this.memberships.filter((membership) =>
        predicateText.includes(String(membership.userId)),
      );
    }
    if (table === partnerKycProfiles) {
      return this.kycProfiles.filter((profile) => predicateText.includes(String(profile.userId)));
    }
    if (table === holaCreditLedgerEntries) {
      return this.ledgerEntries.filter((entry) => predicateText.includes(String(entry.userId)));
    }
    if (table === partnerActivityEvents) {
      const predicateStrings = extractPredicateStrings(predicateText);
      const days = predicateStrings.filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value));
      const startDay = days[0] ?? null;
      const endDay = days[days.length - 1] ?? startDay;
      return this.activityEvents.filter((event) => {
        if (!predicateText.includes(String(event.userId))) return false;
        if (predicateText.includes('daily_checkin') && event.eventType !== 'daily_checkin')
          return false;
        if (startDay && event.activityDate < startDay) return false;
        if (endDay && event.activityDate > endDay) return false;
        return true;
      });
    }
    if (table === partnerLots) {
      return this.lots.filter((lot) => predicateText.includes(String(lot.userId)));
    }
    if (table === partnerRechargeOrders) {
      const rows = this.orders.filter((order) => predicateText.includes(String(order.userId)));
      if (predicateText.includes('completed')) {
        return rows.filter(
          (order) => order.status === 'completed' && order.orderKind === 'recharge',
        );
      }
      return rows;
    }
    if (table === partnerWithdrawalRequests) {
      return this.withdrawals.filter((withdrawal) =>
        predicateText.includes(String(withdrawal.userId)),
      );
    }
    if (table === partnerReferrals) {
      return this.referrals.filter((referral) =>
        predicateText.includes(String(referral.inviterUserId)),
      );
    }
    return [];
  }
}

function tableName(table: unknown): string {
  return (table as Record<symbol, string> | null)?.[Symbol.for('drizzle:Name')] ?? 'unknown';
}

function extractPredicateStrings(value: string): string[] {
  return Array.from(value.matchAll(/'([^']+)'|"([^"]+)"/g), (match) => match[1] ?? match[2] ?? '');
}

function fakeUser(overrides: Partial<User> = {}): User {
  return {
    id: 123,
    externalId: 'usr_partner',
    email: 'partner@example.com',
    passwordHash: '',
    plan: 'pro',
    role: 'user',
    planExpiresAt: null,
    status: 'active',
    authVersion: 0,
    mfaEnabled: false,
    mfaSecretEncrypted: null,
    mfaSetupCreatedAt: null,
    mfaLastUsedStep: null,
    mfaFailedAttempts: 0,
    mfaLockedUntil: null,
    displayName: 'Partner User',
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
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function fakeMembership(overrides: Partial<PartnerMembership> = {}): PartnerMembership {
  return {
    id: 10,
    externalId: 'pay_membership',
    userId: 123,
    status: 'active',
    startsAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: new Date('2027-01-01T00:00:00.000Z'),
    sourcePaymentExternalId: null,
    metadata: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function fakeKyc(overrides: Partial<PartnerKycProfile> = {}): PartnerKycProfile {
  return {
    id: 20,
    externalId: 'kyc_profile',
    userId: 123,
    status: 'passed',
    country: 'CN',
    realNameHash: null,
    idNumberHash: null,
    bankCardHash: null,
    phoneHash: null,
    provider: null,
    providerRef: null,
    reviewedAt: new Date('2026-02-01T00:00:00.000Z'),
    metadata: null,
    createdAt: new Date('2026-02-01T00:00:00.000Z'),
    updatedAt: new Date('2026-02-01T00:00:00.000Z'),
    ...overrides,
  };
}

function fakeLedgerEntry(overrides: Partial<HolaCreditLedgerEntry> = {}): HolaCreditLedgerEntry {
  return {
    id: 30,
    externalId: 'ledger_entry',
    userId: 123,
    lotId: null,
    entryType: 'recharge_principal',
    direction: 'credit',
    bucket: 'available',
    amountCreditCents: 10_000_00,
    amountApiUnits: 0,
    status: 'posted',
    idempotencyKey: 'ledger-idem-1',
    metadata: null,
    createdAt: new Date('2026-03-01T00:00:00.000Z'),
    ...overrides,
  };
}

function fakeActivity(overrides: Partial<PartnerActivityEvent> = {}): PartnerActivityEvent {
  return {
    id: 35,
    externalId: 'payment_activity',
    userId: 123,
    activityDate: '2026-07-02',
    eventType: 'daily_checkin',
    points: 1,
    idempotencyKey: 'activity:daily_checkin:123:2026-07-02',
    metadata: null,
    createdAt: new Date('2026-07-02T00:00:00.000Z'),
    ...overrides,
  };
}

function fakeLot(overrides: Partial<PartnerLot> = {}): PartnerLot {
  return {
    id: 40,
    externalId: 'pay_lot',
    userId: 123,
    rechargeOrderId: 77,
    status: 'accumulating',
    riskStatus: 'normal',
    principalCreditCents: 10_000_00,
    tierMultiplierBps: 10_500,
    apiUnits: 10_500_000,
    bonusCapCreditCents: 2_000_00,
    lockedBonusCreditCents: 500_00,
    releasedPrincipalCreditCents: 1_000_00,
    releasedBonusCreditCents: 100_00,
    carryForwardCreditCents: 25_00,
    accumulationStartsAt: new Date('2026-03-01T00:00:00.000Z'),
    accumulationEndsAt: new Date('2026-06-29T00:00:00.000Z'),
    releaseStartsAt: new Date('2026-06-30T00:00:00.000Z'),
    releaseEndsAt: new Date('2027-02-28T00:00:00.000Z'),
    metadata: null,
    createdAt: new Date('2026-03-01T00:00:00.000Z'),
    updatedAt: new Date('2026-03-01T00:00:00.000Z'),
    ...overrides,
  };
}

function fakeOrder(overrides: Partial<PartnerRechargeOrder> = {}): PartnerRechargeOrder {
  return {
    id: 50,
    externalId: 'pay_order',
    userId: 123,
    provider: 'wechat',
    providerOrderId: null,
    providerCaptureId: 'cap_order',
    amountCnyCents: 40_001_00,
    status: 'completed',
    orderKind: 'recharge',
    idempotencyKey: 'order-idem-1',
    metadata: null,
    createdAt: new Date('2026-06-20T00:00:00.000Z'),
    updatedAt: new Date('2026-06-20T00:00:00.000Z'),
    ...overrides,
  };
}

function fakeWithdrawal(
  overrides: Partial<PartnerWithdrawalRequest> = {},
): PartnerWithdrawalRequest {
  return {
    id: 60,
    externalId: 'pay_withdrawal',
    userId: 123,
    amountCreditCents: 600_00,
    status: 'reviewing',
    reviewDueAt: new Date('2026-07-09T00:00:00.000Z'),
    bankAccountFingerprint: 'bank_fp_123',
    riskScore: 72,
    idempotencyKey: 'withdrawal-idem-1',
    rejectionReason: null,
    metadata: null,
    createdAt: new Date('2026-07-02T00:00:00.000Z'),
    updatedAt: new Date('2026-07-02T00:00:00.000Z'),
    ...overrides,
  };
}

function fakeReferral(overrides: Partial<PartnerReferral> = {}): PartnerReferral {
  return {
    id: 70,
    externalId: 'pay_referral',
    inviterUserId: 123,
    inviteeUserId: 456,
    rechargeOrderId: null,
    status: 'pending',
    rewardCreditCents: 0,
    rewardRateBps: 0,
    assisted: 0,
    metadata: null,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('partnerRouter', () => {
  const originalFlag = process.env.PARTNER_LEDGER_ENABLED;

  beforeEach(() => {
    vi.setSystemTime(new Date('2026-07-02T00:00:00.000Z'));
    delete process.env.PARTNER_LEDGER_ENABLED;
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalFlag === undefined) {
      delete process.env.PARTNER_LEDGER_ENABLED;
    } else {
      process.env.PARTNER_LEDGER_ENABLED = originalFlag;
    }
  });

  it('options returns disabled when the env flag is not true', async () => {
    const caller = partnerRouter.createCaller(new FakePartnerDb().asContext());

    await expect(caller.options()).resolves.toEqual({ enabled: false });
  });

  it('dashboard disabled returns only disabled state without partner reads', async () => {
    const fakeDb = new FakePartnerDb({
      memberships: [fakeMembership()],
      kycProfiles: [fakeKyc()],
      ledgerEntries: [fakeLedgerEntry()],
      lots: [fakeLot()],
    });

    await expect(partnerRouter.createCaller(fakeDb.asContext()).dashboard()).resolves.toEqual({
      enabled: false,
    });
    expect(fakeDb.selectTables).toEqual([]);
  });

  it('dashboard enabled returns active partner status, KYC, ledger summary, and lots', async () => {
    process.env.PARTNER_LEDGER_ENABLED = 'true';
    const fakeDb = new FakePartnerDb({
      memberships: [fakeMembership()],
      kycProfiles: [
        fakeKyc({
          status: 'pending',
          provider: 'cn-bankcard',
          providerRef: 'bankcard-flow-123',
          bankCardHash: 'bank_hash_123',
        }),
      ],
      ledgerEntries: [
        fakeLedgerEntry({ bucket: 'available', direction: 'credit', amountCreditCents: 10_000_00 }),
        fakeLedgerEntry({
          id: 31,
          externalId: 'ledger_locked',
          bucket: 'locked',
          direction: 'credit',
          amountCreditCents: 500_00,
          idempotencyKey: 'ledger-idem-2',
        }),
        fakeLedgerEntry({
          id: 32,
          externalId: 'ledger_withdrawable',
          bucket: 'withdrawable',
          direction: 'credit',
          amountCreditCents: 7_000_00,
          idempotencyKey: 'ledger-idem-3',
        }),
      ],
      activityEvents: [
        fakeActivity({ id: 35, activityDate: '2026-07-01', idempotencyKey: 'activity:d1' }),
        fakeActivity({ id: 36, activityDate: '2026-07-02', idempotencyKey: 'activity:d2' }),
      ],
      lots: [fakeLot()],
      orders: [
        fakeOrder({
          externalId: 'pay_membership_pending',
          provider: 'manual',
          providerCaptureId: null,
          orderKind: 'membership',
          amountCnyCents: 999_00,
          status: 'pending',
          idempotencyKey: 'membership-idem-1',
        }),
      ],
      withdrawals: [fakeWithdrawal()],
      referrals: [fakeReferral()],
    });

    const result = await partnerRouter.createCaller(fakeDb.asContext()).dashboard();

    expect(result).toEqual({
      enabled: true,
      limits: {
        withdrawalMinCreditCents: 500_00,
      },
      membership: {
        status: 'active',
        expiresAt: new Date('2027-01-01T00:00:00.000Z'),
      },
      kycStatus: 'pending',
      kycProfile: {
        kycExternalId: 'kyc_profile',
        status: 'pending',
        country: 'CN',
        provider: 'cn-bankcard',
        providerRef: 'bankcard-flow-123',
        bankCardVerified: true,
        reviewedAt: new Date('2026-02-01T00:00:00.000Z'),
      },
      inviteCode: 'usr_partner',
      activity: {
        activityDate: '2026-07-02',
        checkedInToday: true,
        loginDays: 2,
        completedTasks: 0,
        validInvites: 0,
        activityFactorBps: 10_200,
      },
      ledger: {
        availableCreditCents: 10_000_00,
        lockedCreditCents: 500_00,
        withdrawableCreditCents: 7_000_00,
        pendingWithdrawalCreditCents: 0,
        frozenCreditCents: 0,
      },
      lots: [
        {
          id: 40,
          externalId: 'pay_lot',
          status: 'accumulating',
          riskStatus: 'normal',
          principalCreditCents: 10_000_00,
          lockedBonusCreditCents: 500_00,
          releasedPrincipalCreditCents: 1_000_00,
          releasedBonusCreditCents: 100_00,
          carryForwardCreditCents: 25_00,
          releaseStartsAt: new Date('2026-06-30T00:00:00.000Z'),
          releaseEndsAt: new Date('2027-02-28T00:00:00.000Z'),
        },
      ],
      orders: [
        {
          orderExternalId: 'pay_membership_pending',
          provider: 'manual',
          orderKind: 'membership',
          amountCnyCents: 999_00,
          status: 'pending',
          createdAt: new Date('2026-06-20T00:00:00.000Z'),
        },
      ],
      withdrawals: [
        {
          withdrawalExternalId: 'pay_withdrawal',
          amountCreditCents: 600_00,
          status: 'reviewing',
          reviewDueAt: new Date('2026-07-09T00:00:00.000Z'),
          bankAccountFingerprint: 'bank_fp_123',
          riskScore: 72,
        },
      ],
      referrals: [
        {
          referralExternalId: 'pay_referral',
          status: 'pending',
          assisted: false,
          rewardCreditCents: 0,
          rewardRateBps: 0,
          createdAt: new Date('2026-07-01T00:00:00.000Z'),
        },
      ],
    });
  });

  it('dashboard preserves zero withdrawable credit instead of falling back to available credit', async () => {
    process.env.PARTNER_LEDGER_ENABLED = 'true';
    const fakeDb = new FakePartnerDb({
      memberships: [fakeMembership()],
      kycProfiles: [fakeKyc()],
      ledgerEntries: [
        fakeLedgerEntry({ bucket: 'available', direction: 'credit', amountCreditCents: 10_000_00 }),
      ],
    });

    const result = await partnerRouter.createCaller(fakeDb.asContext()).dashboard();

    expect(result).toMatchObject({
      enabled: true,
      ledger: {
        availableCreditCents: 10_000_00,
        withdrawableCreditCents: 0,
      },
    });
  });

  it('dashboard exposes user-facing order and withdrawal progress context', async () => {
    process.env.PARTNER_LEDGER_ENABLED = 'true';
    const fakeDb = new FakePartnerDb({
      memberships: [fakeMembership()],
      kycProfiles: [fakeKyc()],
      orders: [
        fakeOrder({
          externalId: 'pay_order_review',
          status: 'review_required',
          metadata: {
            reviewReason: 'lot_creation_failed',
            errorMessage: 'monthly cap exceeded',
          },
        }),
      ],
      withdrawals: [
        fakeWithdrawal({
          externalId: 'pay_withdrawal_rejected',
          status: 'rejected',
          rejectionReason: 'bank mismatch',
          metadata: {
            rejectedAt: '2026-07-03T05:00:00.000Z',
          },
        }),
        fakeWithdrawal({
          id: 61,
          externalId: 'pay_withdrawal_paid',
          status: 'paid',
          metadata: {
            providerPayoutId: 'bank-payout-1',
            paidAt: '2026-07-03T06:00:00.000Z',
          },
        }),
        fakeWithdrawal({
          id: 62,
          externalId: 'pay_withdrawal_returned',
          status: 'returned',
          metadata: {
            returnedReason: 'bank returned funds',
            returnedAt: '2026-07-04T06:00:00.000Z',
          },
        }),
      ],
      referrals: [
        fakeReferral({
          externalId: 'pay_referral_rewarded',
          status: 'rewarded',
          rewardCreditCents: 2_000_00,
          rewardRateBps: 2_000,
          metadata: {
            rewardedAt: '2026-07-04T06:00:00.000Z',
          },
        }),
      ],
    });

    const result = await partnerRouter.createCaller(fakeDb.asContext()).dashboard();

    expect(result).toMatchObject({
      enabled: true,
      orders: [
        {
          orderExternalId: 'pay_order_review',
          status: 'review_required',
          reviewReason: 'lot_creation_failed',
          reviewErrorMessage: 'monthly cap exceeded',
        },
      ],
      withdrawals: [
        {
          withdrawalExternalId: 'pay_withdrawal_rejected',
          status: 'rejected',
          rejectionReason: 'bank mismatch',
          rejectedAt: '2026-07-03T05:00:00.000Z',
        },
        {
          withdrawalExternalId: 'pay_withdrawal_paid',
          status: 'paid',
          providerPayoutId: 'bank-payout-1',
          paidAt: '2026-07-03T06:00:00.000Z',
        },
        {
          withdrawalExternalId: 'pay_withdrawal_returned',
          status: 'returned',
          returnedReason: 'bank returned funds',
          returnedAt: '2026-07-04T06:00:00.000Z',
        },
      ],
      referrals: [
        {
          referralExternalId: 'pay_referral_rewarded',
          status: 'rewarded',
          assisted: false,
          rewardCreditCents: 2_000_00,
          rewardRateBps: 2_000,
          createdAt: new Date('2026-07-01T00:00:00.000Z'),
          rewardedAt: '2026-07-04T06:00:00.000Z',
        },
      ],
    });
  });

  it('orderStatus returns a current-user pending order with a payment intent', async () => {
    process.env.PARTNER_LEDGER_ENABLED = 'true';
    const fakeDb = new FakePartnerDb({
      orders: [
        fakeOrder({
          externalId: 'pay_order_pending',
          provider: 'alipay',
          providerCaptureId: null,
          status: 'pending',
          createdAt: new Date('2026-07-10T10:00:00.000Z'),
        }),
      ],
    });

    await expect(
      partnerRouter.createCaller(fakeDb.asContext()).orderStatus({
        orderExternalId: 'pay_order_pending',
      }),
    ).resolves.toMatchObject({
      orderExternalId: 'pay_order_pending',
      provider: 'alipay',
      status: 'pending',
      paymentIntent: {
        provider: 'alipay',
        mode: 'redirect',
        payUrl: expect.stringContaining('pay_order_pending'),
        expiresAt: new Date('2026-07-10T10:30:00.000Z'),
      },
    });
  });

  it('orderStatus does not expose another user order', async () => {
    process.env.PARTNER_LEDGER_ENABLED = 'true';
    const fakeDb = new FakePartnerDb({
      orders: [
        fakeOrder({
          externalId: 'pay_other_user_order',
          userId: 456,
        }),
      ],
    });

    await expect(
      partnerRouter.createCaller(fakeDb.asContext()).orderStatus({
        orderExternalId: 'pay_other_user_order',
      }),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'partner order not found',
    });
  });

  it('dashboard exposes configured partner action limits', async () => {
    process.env.PARTNER_LEDGER_ENABLED = 'true';
    const original = process.env.PARTNER_WITHDRAWAL_MIN_CREDIT_CENTS;
    process.env.PARTNER_WITHDRAWAL_MIN_CREDIT_CENTS = String(750_00);
    try {
      const result = await partnerRouter.createCaller(new FakePartnerDb().asContext()).dashboard();

      expect(result).toMatchObject({
        enabled: true,
        limits: {
          withdrawalMinCreditCents: 750_00,
        },
      });
    } finally {
      if (original === undefined) {
        delete process.env.PARTNER_WITHDRAWAL_MIN_CREDIT_CENTS;
      } else {
        process.env.PARTNER_WITHDRAWAL_MIN_CREDIT_CENTS = original;
      }
    }
  });

  it('rechargePreview is blocked when the feature flag is disabled', async () => {
    await expect(
      partnerRouter.createCaller(new FakePartnerDb().asContext()).rechargePreview({
        amountCnyCents: 10_000_00,
      }),
    ).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'partner ledger is disabled',
    });
  });

  it('rechargePreview blocks users without active membership', async () => {
    process.env.PARTNER_LEDGER_ENABLED = 'true';
    const fakeDb = new FakePartnerDb({ memberships: [], kycProfiles: [fakeKyc()] });

    await expect(
      partnerRouter.createCaller(fakeDb.asContext()).rechargePreview({
        amountCnyCents: 10_000_00,
      }),
    ).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'partner membership required',
    });
  });

  it('rechargePreview blocks before KYC has passed', async () => {
    process.env.PARTNER_LEDGER_ENABLED = 'true';
    const fakeDb = new FakePartnerDb({
      memberships: [fakeMembership()],
      kycProfiles: [fakeKyc({ status: 'pending' })],
    });

    await expect(
      partnerRouter.createCaller(fakeDb.asContext()).rechargePreview({
        amountCnyCents: 10_000_00,
      }),
    ).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'partner KYC must be passed before recharge',
    });
  });

  it('rechargePreview validates amount and computed rolling total', async () => {
    process.env.PARTNER_LEDGER_ENABLED = 'true';
    const caller = partnerRouter.createCaller(
      new FakePartnerDb({
        memberships: [fakeMembership()],
        kycProfiles: [fakeKyc()],
        orders: [
          fakeOrder({
            amountCnyCents: 490_001_00,
            updatedAt: new Date('2026-06-20T00:00:00.000Z'),
          }),
        ],
      }).asContext(),
    );

    await expect(caller.rechargePreview({ amountCnyCents: 9_999_00 })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'below_minimum',
    });
    await expect(
      caller.rechargePreview({
        amountCnyCents: 10_000_00,
        rollingThirtyDayCnyCents: 10_000_00,
      }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'rollingThirtyDayCnyCents must not exceed the monthly maximum',
    });
  });

  it('rechargePreview honors configured recharge limits', async () => {
    process.env.PARTNER_LEDGER_ENABLED = 'true';
    const originalMin = process.env.PARTNER_RECHARGE_MIN_CNY_CENTS;
    const originalMonthly = process.env.PARTNER_RECHARGE_MAX_MONTHLY_CNY_CENTS;
    process.env.PARTNER_RECHARGE_MIN_CNY_CENTS = String(7_500_00);
    process.env.PARTNER_RECHARGE_MAX_MONTHLY_CNY_CENTS = String(250_000_00);
    try {
      const caller = partnerRouter.createCaller(
        new FakePartnerDb({
          memberships: [fakeMembership()],
          kycProfiles: [fakeKyc()],
          orders: [
            fakeOrder({
              amountCnyCents: 242_501_00,
              updatedAt: new Date('2026-06-20T00:00:00.000Z'),
            }),
          ],
        }).asContext(),
      );

      await expect(caller.rechargePreview({ amountCnyCents: 7_500_00 })).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: 'rollingThirtyDayCnyCents must not exceed the monthly maximum',
      });
    } finally {
      if (originalMin === undefined) {
        delete process.env.PARTNER_RECHARGE_MIN_CNY_CENTS;
      } else {
        process.env.PARTNER_RECHARGE_MIN_CNY_CENTS = originalMin;
      }
      if (originalMonthly === undefined) {
        delete process.env.PARTNER_RECHARGE_MAX_MONTHLY_CNY_CENTS;
      } else {
        process.env.PARTNER_RECHARGE_MAX_MONTHLY_CNY_CENTS = originalMonthly;
      }
    }
  });

  it('rechargePreview returns tier and API Units for a valid active partner', async () => {
    process.env.PARTNER_LEDGER_ENABLED = 'true';
    const caller = partnerRouter.createCaller(
      new FakePartnerDb({
        memberships: [fakeMembership()],
        kycProfiles: [fakeKyc()],
        orders: [
          fakeOrder({
            amountCnyCents: 40_001_00,
            updatedAt: new Date('2026-06-20T00:00:00.000Z'),
          }),
          fakeOrder({
            id: 51,
            externalId: 'pay_order_outside_window',
            amountCnyCents: 200_000_00,
            providerCaptureId: 'cap_order_outside',
            idempotencyKey: 'order-idem-outside',
            updatedAt: new Date('2026-05-01T00:00:00.000Z'),
          }),
        ],
      }).asContext(),
    );

    await expect(
      caller.rechargePreview({
        amountCnyCents: 10_000_00,
        rollingThirtyDayCnyCents: 10_000_00,
      }),
    ).resolves.toEqual({
      amountCnyCents: 10_000_00,
      rollingThirtyDayCnyCents: 50_001_00,
      tier: {
        minCnyCents: 50_001_00,
        maxCnyCents: 100_000_00,
        multiplierBps: 10_800,
      },
      apiUnits: 10_800_000,
    });
  });

  it('is mounted on appRouter', async () => {
    process.env.PARTNER_LEDGER_ENABLED = 'true';
    const caller = appRouter.createCaller(new FakePartnerDb().asContext() as never) as {
      partner: {
        options: () => Promise<{ enabled: boolean }>;
      };
    };

    await expect(caller.partner.options()).resolves.toEqual({ enabled: true });
  });
});
