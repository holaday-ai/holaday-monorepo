import { inspect } from 'node:util';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { appRouter } from '../router.js';
import { partnerRouter } from './partner.js';
import { users, type User } from '../../db/schema/users.js';
import {
  holaCreditLedgerEntries,
  partnerKycProfiles,
  partnerLots,
  partnerMemberships,
  partnerRechargeOrders,
  type HolaCreditLedgerEntry,
  type PartnerKycProfile,
  type PartnerLot,
  type PartnerMembership,
  type PartnerRechargeOrder,
} from '../../db/schema/partner.js';

class FakePartnerDb {
  readonly users: User[];
  readonly memberships: PartnerMembership[];
  readonly kycProfiles: PartnerKycProfile[];
  readonly ledgerEntries: HolaCreditLedgerEntry[];
  readonly lots: PartnerLot[];
  readonly orders: PartnerRechargeOrder[];
  readonly selectTables: string[] = [];

  constructor(input: {
    users?: User[];
    memberships?: PartnerMembership[];
    kycProfiles?: PartnerKycProfile[];
    ledgerEntries?: HolaCreditLedgerEntry[];
    lots?: PartnerLot[];
    orders?: PartnerRechargeOrder[];
  } = {}) {
    this.users = [...(input.users ?? [fakeUser()])];
    this.memberships = [...(input.memberships ?? [])];
    this.kycProfiles = [...(input.kycProfiles ?? [])];
    this.ledgerEntries = [...(input.ledgerEntries ?? [])];
    this.lots = [...(input.lots ?? [])];
    this.orders = [...(input.orders ?? [])];
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
      return this.memberships.filter((membership) => predicateText.includes(String(membership.userId)));
    }
    if (table === partnerKycProfiles) {
      return this.kycProfiles.filter((profile) => predicateText.includes(String(profile.userId)));
    }
    if (table === holaCreditLedgerEntries) {
      return this.ledgerEntries.filter((entry) => predicateText.includes(String(entry.userId)));
    }
    if (table === partnerLots) {
      return this.lots.filter((lot) => predicateText.includes(String(lot.userId)));
    }
    if (table === partnerRechargeOrders) {
      return this.orders.filter(
        (order) =>
          predicateText.includes(String(order.userId)) &&
          order.status === 'completed' &&
          order.orderKind === 'recharge',
      );
    }
    return [];
  }
}

function tableName(table: unknown): string {
  return (table as Record<symbol, string> | null)?.[Symbol.for('drizzle:Name')] ?? 'unknown';
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
      kycProfiles: [fakeKyc({ status: 'passed' })],
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
      ],
      lots: [fakeLot()],
    });

    const result = await partnerRouter.createCaller(fakeDb.asContext()).dashboard();

    expect(result).toEqual({
      enabled: true,
      membership: {
        status: 'active',
        expiresAt: new Date('2027-01-01T00:00:00.000Z'),
      },
      kycStatus: 'passed',
      ledger: {
        availableCreditCents: 10_000_00,
        lockedCreditCents: 500_00,
        withdrawableCreditCents: 10_000_00,
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
    });
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
