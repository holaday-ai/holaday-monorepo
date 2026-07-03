import { describe, expect, it } from 'vitest';
import type { DB } from '../db/client.js';
import { partnerReferrals, type PartnerReferral } from '../db/schema/partner.js';
import type { CreditLedgerService } from './credit-ledger-service.js';
import {
  PartnerReferralConflictError,
  ReferralService,
} from './referral-service.js';

type FakeReferralInsert = Omit<PartnerReferral, 'id' | 'createdAt' | 'updatedAt'>;

function extractColumnValues(predicate: unknown, columnName: string): unknown[] {
  const values: unknown[] = [];

  function visitSql(candidate: unknown): void {
    if (candidate === null || typeof candidate !== 'object') return;
    const queryChunks = (candidate as { queryChunks?: unknown[] }).queryChunks;
    if (!Array.isArray(queryChunks)) return;

    for (let index = 0; index < queryChunks.length; index += 1) {
      const chunk = queryChunks[index] as { name?: unknown } | null;
      if (chunk?.name === columnName) {
        const paramChunk = queryChunks
          .slice(index + 1)
          .find(
            (laterChunk): laterChunk is { value: unknown } =>
              laterChunk !== null &&
              typeof laterChunk === 'object' &&
              'value' in laterChunk &&
              !Array.isArray((laterChunk as { value: unknown }).value),
          );
        if (paramChunk) {
          values.push(paramChunk.value);
        }
      }
      visitSql(chunk);
    }
  }

  visitSql(predicate);
  return values;
}

class FakeReferralDb {
  readonly referrals: PartnerReferral[];
  readonly insertedValues: FakeReferralInsert[] = [];
  transactionCalls = 0;
  private nextId: number;

  constructor(input: { referrals?: PartnerReferral[] } = {}) {
    this.referrals = [...(input.referrals ?? [])];
    this.nextId = Math.max(0, ...this.referrals.map((row) => row.id)) + 1;
  }

  asDB(): DB {
    return this as unknown as DB;
  }

  async transaction<T>(cb: (tx: DB) => Promise<T>): Promise<T> {
    this.transactionCalls += 1;
    return cb(this.asDB());
  }

  insert(table: unknown) {
    if (table !== partnerReferrals) {
      throw new Error('unexpected insert table');
    }
    return {
      values: (values: FakeReferralInsert) => {
        this.insertedValues.push(values);
        return {
          onDuplicateKeyUpdate: async (_config: unknown) => {
            const existing = this.referrals.find((row) => row.inviteeUserId === values.inviteeUserId);
            if (existing) return;
            this.referrals.push({
              id: this.nextId,
              createdAt: new Date('2026-07-03T00:00:00.000Z'),
              updatedAt: new Date('2026-07-03T00:00:00.000Z'),
              ...values,
            });
            this.nextId += 1;
          },
        };
      },
    };
  }

  select(_selection?: unknown) {
    return {
      from: (table: unknown) => ({
        where: (predicate: unknown) => ({
          limit: async (count: number) => {
            if (table !== partnerReferrals) return [];
            const row = this.findReferral(predicate);
            return row ? [row].slice(0, count) : [];
          },
        }),
      }),
    };
  }

  private findReferral(predicate: unknown): PartnerReferral | undefined {
    const inviteeUserIds = extractColumnValues(predicate, 'invitee_user_id');
    if (inviteeUserIds.length > 0) {
      return this.referrals.find((row) => inviteeUserIds.includes(row.inviteeUserId));
    }

    const ids = extractColumnValues(predicate, 'id');
    if (ids.length > 0) {
      return this.referrals.find((row) => ids.includes(row.id));
    }

    const externalIds = extractColumnValues(predicate, 'external_id');
    return this.referrals.find((row) => externalIds.includes(row.externalId));
  }
}

class FakeReferralLedger {
  readonly entries: Array<Parameters<CreditLedgerService['postEntry']>[0]> = [];

  async postEntry(input: Parameters<CreditLedgerService['postEntry']>[0]) {
    const existing = this.entries.find((entry) => entry.idempotencyKey === input.idempotencyKey);
    if (existing) {
      if (
        existing.userId !== input.userId ||
        (existing.lotId ?? null) !== (input.lotId ?? null) ||
        existing.entryType !== input.entryType ||
        existing.direction !== input.direction ||
        existing.bucket !== input.bucket ||
        (existing.amountCreditCents ?? 0) !== (input.amountCreditCents ?? 0) ||
        (existing.amountApiUnits ?? 0) !== (input.amountApiUnits ?? 0)
      ) {
        throw new Error('ledger idempotency conflict');
      }
      const existingIndex = this.entries.indexOf(existing) + 1;
      return {
        id: existingIndex,
        externalId: `payment_ledger_${existingIndex}`,
        userId: existing.userId,
        lotId: existing.lotId ?? null,
        entryType: existing.entryType,
        direction: existing.direction,
        bucket: existing.bucket,
        amountCreditCents: existing.amountCreditCents ?? 0,
        amountApiUnits: existing.amountApiUnits ?? 0,
        status: 'posted',
        idempotencyKey: existing.idempotencyKey,
        metadata: existing.metadata ?? null,
        createdAt: new Date('2026-07-03T00:00:00.000Z'),
      };
    }

    this.entries.push(input);
    return {
      id: this.entries.length,
      externalId: `payment_ledger_${this.entries.length}`,
      userId: input.userId,
      lotId: input.lotId ?? null,
      entryType: input.entryType,
      direction: input.direction,
      bucket: input.bucket,
      amountCreditCents: input.amountCreditCents ?? 0,
      amountApiUnits: input.amountApiUnits ?? 0,
      status: 'posted',
      idempotencyKey: input.idempotencyKey,
      metadata: input.metadata ?? null,
      createdAt: new Date('2026-07-03T00:00:00.000Z'),
    };
  }
}

function fakeReferral(overrides: Partial<PartnerReferral> = {}): PartnerReferral {
  return {
    id: 1,
    externalId: 'payment_referral_1',
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

function serviceWithFakes(input: { referrals?: PartnerReferral[] } = {}) {
  const db = new FakeReferralDb(input);
  const ledger = new FakeReferralLedger();
  const service = new ReferralService(db.asDB(), { ledger });
  return { db, ledger, service };
}

describe('ReferralService.recordInvite', () => {
  it('creates one pending first-attribution referral and treats the same invite as idempotent', async () => {
    const { db, service } = serviceWithFakes();

    const first = await service.recordInvite({
      inviterUserId: 123,
      inviteeUserId: 456,
      assisted: true,
      now: new Date('2026-07-03T01:00:00.000Z'),
    });
    const second = await service.recordInvite({
      inviterUserId: 123,
      inviteeUserId: 456,
      assisted: true,
      now: new Date('2026-07-03T01:01:00.000Z'),
    });

    expect(first).toMatchObject({
      inviterUserId: 123,
      inviteeUserId: 456,
      status: 'pending',
      assisted: 1,
      rewardCreditCents: 0,
    });
    expect(second).toMatchObject({
      id: first.id,
      inviterUserId: 123,
      inviteeUserId: 456,
      assisted: 1,
    });
    expect(db.referrals).toHaveLength(1);
  });

  it('rejects self invites and conflicting invite attribution', async () => {
    await expect(
      serviceWithFakes().service.recordInvite({
        inviterUserId: 123,
        inviteeUserId: 123,
      }),
    ).rejects.toThrow(RangeError);

    await expect(
      serviceWithFakes({ referrals: [fakeReferral({ inviterUserId: 111, inviteeUserId: 456 })] }).service.recordInvite({
        inviterUserId: 123,
        inviteeUserId: 456,
      }),
    ).rejects.toBeInstanceOf(PartnerReferralConflictError);
  });

  it('rejects non-boolean assisted flags at the service boundary', async () => {
    await expect(
      serviceWithFakes().service.recordInvite({
        inviterUserId: 123,
        inviteeUserId: 456,
        assisted: 'false' as unknown as boolean,
      }),
    ).rejects.toBeInstanceOf(RangeError);
  });
});

describe('ReferralService.settleRechargeReward', () => {
  it('credits the inviter with 20 percent of an invitee recharge once', async () => {
    const { db, ledger, service } = serviceWithFakes({ referrals: [fakeReferral()] });

    const first = await service.settleRechargeReward({
      inviteeUserId: 456,
      rechargeOrderId: 77,
      amountCnyCents: 10_000_00,
      now: new Date('2026-07-03T02:00:00.000Z'),
    });
    const second = await service.settleRechargeReward({
      inviteeUserId: 456,
      rechargeOrderId: 77,
      amountCnyCents: 10_000_00,
      now: new Date('2026-07-03T02:01:00.000Z'),
    });

    expect(first).toMatchObject({
      status: 'pending',
      rechargeOrderId: null,
      rewardCreditCents: 0,
      rewardRateBps: 0,
    });
    expect(second).toMatchObject({
      id: first?.id,
      inviteeUserId: 456,
      inviterUserId: 123,
    });
    expect(db.transactionCalls).toBe(0);
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0]).toMatchObject({
      userId: 123,
      entryType: 'referral_recharge_reward',
      direction: 'credit',
      bucket: 'available',
      amountCreditCents: 2_000_00,
      idempotencyKey: 'referral:recharge_reward:1:77',
    });
  });

  it('credits assisted recharge referrals at 10 percent', async () => {
    const { ledger, service } = serviceWithFakes({ referrals: [fakeReferral({ assisted: 1 })] });

    const row = await service.settleRechargeReward({
      inviteeUserId: 456,
      rechargeOrderId: 77,
      amountCnyCents: 10_000_00,
    });

    expect(row).toMatchObject({
      inviteeUserId: 456,
      inviterUserId: 123,
    });
    expect(ledger.entries[0]?.amountCreditCents).toBe(1_000_00);
  });

  it('rejects persisted assisted values outside 0 or 1', async () => {
    const { ledger, service } = serviceWithFakes({ referrals: [fakeReferral({ assisted: 2 })] });

    await expect(
      service.settleRechargeReward({
        inviteeUserId: 456,
        rechargeOrderId: 77,
        amountCnyCents: 10_000_00,
      }),
    ).rejects.toBeInstanceOf(RangeError);
    expect(ledger.entries).toEqual([]);
  });

  it('credits each distinct recharge for the same attributed invitee', async () => {
    const { ledger, service } = serviceWithFakes({
      referrals: [
        fakeReferral({
          status: 'rewarded',
          rechargeOrderId: 77,
          rewardCreditCents: 2_000_00,
          rewardRateBps: 2_000,
        }),
      ],
    });

    await expect(
      service.settleRechargeReward({
        inviteeUserId: 456,
        rechargeOrderId: 78,
        amountCnyCents: 20_000_00,
      }),
    ).resolves.toMatchObject({
      inviteeUserId: 456,
      inviterUserId: 123,
    });

    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0]).toMatchObject({
      userId: 123,
      amountCreditCents: 4_000_00,
      idempotencyKey: 'referral:recharge_reward:1:78',
    });
  });

  it('returns null without side effects when no referral existed before recharge settlement', async () => {
    const { db, ledger, service } = serviceWithFakes();

    await expect(
      service.settleRechargeReward({
        inviteeUserId: 456,
        rechargeOrderId: 77,
        amountCnyCents: 10_000_00,
      }),
    ).resolves.toBeNull();
    expect(ledger.entries).toEqual([]);
  });

  it('does not overwrite the attribution row while settling a recharge reward', async () => {
    const referral = fakeReferral();
    const { db, ledger, service } = serviceWithFakes({ referrals: [referral] });

    await expect(
      service.settleRechargeReward({
        inviteeUserId: 456,
        rechargeOrderId: 77,
        amountCnyCents: 10_000_00,
      }),
    ).resolves.toBe(referral);

    expect(referral).toMatchObject({
      status: 'pending',
      rechargeOrderId: null,
      rewardCreditCents: 0,
      rewardRateBps: 0,
    });
    expect(ledger.entries).toHaveLength(1);
  });
});
