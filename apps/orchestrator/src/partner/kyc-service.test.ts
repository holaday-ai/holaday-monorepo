import { inspect } from 'node:util';
import type { PartnerKycStatus } from '@holaday/shared-types';
import { describe, expect, it } from 'vitest';
import type { DB } from '../db/client.js';
import { partnerKycProfiles, type PartnerKycProfile } from '../db/schema/partner.js';
import {
  KycService,
  canRechargeWithKycStatus,
  canWithdrawWithKycStatus,
  normalizeKycStatus,
  resolveCnBankCardKycSubmission,
} from './kyc-service.js';

const KNOWN_STATUSES: readonly PartnerKycStatus[] = [
  'not_started',
  'pending',
  'passed',
  'review_required',
  'rejected',
];

type FakeKycRow = Partial<PartnerKycProfile> & {
  userId: number;
  status: string;
};

class FakeKycDb {
  readonly wherePredicateTexts: string[] = [];
  readonly insertAttempts: unknown[] = [];
  readonly upsertSetAttempts: unknown[] = [];
  rowsCreated = 0;
  private nextId = 1;

  constructor(private readonly rows: FakeKycRow[] = []) {}

  asDB(): DB {
    return this as unknown as DB;
  }

  select(_selection?: unknown) {
    return {
      from: (_table: unknown) => ({
        where: async (predicate: unknown) => {
          const predicateText = inspect(predicate, { depth: 6, getters: true });
          this.wherePredicateTexts.push(predicateText);
          return this.rows.filter((row) => predicateText.includes(String(row.userId)));
        },
      }),
    };
  }

  insert(table: unknown) {
    return {
      values: (values: Partial<PartnerKycProfile>) => {
        if (table !== partnerKycProfiles) {
          throw new Error('unexpected insert table');
        }

        return {
          onDuplicateKeyUpdate: async (config: unknown) => {
            this.insertAttempts.push(values);
            this.upsertSetAttempts.push(config);
            const existing = this.rows.find((row) => row.userId === values.userId);
            if (existing) {
              Object.assign(existing, {
                status: values.status,
                country: values.country,
                realNameHash: values.realNameHash,
                idNumberHash: values.idNumberHash,
                bankCardHash: values.bankCardHash,
                phoneHash: values.phoneHash,
                provider: values.provider,
                providerRef: values.providerRef,
                reviewedAt: values.reviewedAt,
                metadata: values.metadata,
                updatedAt: values.updatedAt,
              });
              return;
            }

            this.rows.push({
              id: this.nextId,
              externalId: values.externalId ?? 'pay_fake_kyc',
              userId: values.userId ?? 0,
              status: values.status ?? 'not_started',
              country: values.country ?? 'CN',
              realNameHash: values.realNameHash ?? null,
              idNumberHash: values.idNumberHash ?? null,
              bankCardHash: values.bankCardHash ?? null,
              phoneHash: values.phoneHash ?? null,
              provider: values.provider ?? null,
              providerRef: values.providerRef ?? null,
              reviewedAt: values.reviewedAt ?? null,
              metadata: values.metadata ?? null,
              createdAt: values.createdAt ?? new Date('2026-01-01T00:00:00.000Z'),
              updatedAt: values.updatedAt ?? new Date('2026-01-01T00:00:00.000Z'),
            });
            this.nextId += 1;
            this.rowsCreated += 1;
          },
        };
      },
    };
  }
}

describe('KYC status gates', () => {
  it('blocks recharge for not_started and review_required, and allows passed', () => {
    expect(canRechargeWithKycStatus('not_started')).toBe(false);
    expect(canRechargeWithKycStatus('review_required')).toBe(false);
    expect(canRechargeWithKycStatus('passed')).toBe(true);
  });

  it('allows withdraw only for passed', () => {
    expect(canWithdrawWithKycStatus('passed')).toBe(true);

    for (const status of KNOWN_STATUSES) {
      expect(canWithdrawWithKycStatus(status)).toBe(status === 'passed');
    }
  });

  it('allows recharge only for passed across all known statuses', () => {
    for (const status of KNOWN_STATUSES) {
      expect(canRechargeWithKycStatus(status)).toBe(status === 'passed');
    }
  });

  it('normalizes unknown database statuses conservatively', () => {
    expect(normalizeKycStatus('provider_surprise')).toBe('review_required');
  });
});

describe('resolveCnBankCardKycSubmission', () => {
  it('passes provider-backed bank card submissions without manual review', () => {
    expect(
      resolveCnBankCardKycSubmission({
        bankCardHash: 'bank_hash_123',
        providerRef: 'bankcard-flow-1',
        allowMockAutoPass: true,
      }),
    ).toEqual({
      status: 'passed',
      provider: 'cn-bankcard',
      providerRef: 'bankcard-flow-1',
      bankCardHash: 'bank_hash_123',
      note: 'same-name bank card verified by provider',
    });
  });

  it('does not trust a provider reference when mock auto-pass is disabled', () => {
    expect(
      resolveCnBankCardKycSubmission({
        bankCardHash: 'bank_hash_123',
        providerRef: 'bankcard-flow-1',
        allowMockAutoPass: false,
      }),
    ).toEqual({
      status: 'review_required',
      provider: 'cn-bankcard',
      providerRef: 'bankcard-flow-1',
      bankCardHash: 'bank_hash_123',
      note: 'cn bank card provider reference requires server verification; manual review required',
    });
  });

  it('falls back to review_required when the provider reference is missing', () => {
    expect(
      resolveCnBankCardKycSubmission({
        bankCardHash: 'bank_hash_123',
      }),
    ).toEqual({
      status: 'review_required',
      provider: 'cn-bankcard',
      providerRef: null,
      bankCardHash: 'bank_hash_123',
      note: 'cn bank card provider reference missing; manual review required',
    });
  });
});

describe('KycService', () => {
  it('returns not_started when the user has no KYC profile', async () => {
    const service = new KycService(new FakeKycDb().asDB());

    await expect(service.getStatus(123)).resolves.toBe('not_started');
  });

  it('returns the normalized status for the user profile', async () => {
    const fakeDb = new FakeKycDb([
      { userId: 999, status: 'passed' },
      { userId: 123, status: 'pending' },
    ]);
    const service = new KycService(fakeDb.asDB());

    await expect(service.getStatus(123)).resolves.toBe('pending');
    expect(fakeDb.wherePredicateTexts[0]).toContain('user_id');
  });

  it('returns the stored profile for dashboard display', async () => {
    const fakeDb = new FakeKycDb([
      { userId: 999, status: 'passed', providerRef: 'other-ref' },
      { userId: 123, status: 'pending', provider: 'cn-bankcard', providerRef: 'bankcard-flow-123' },
    ]);
    const service = new KycService(fakeDb.asDB());

    await expect(service.getProfile(123)).resolves.toMatchObject({
      userId: 123,
      status: 'pending',
      provider: 'cn-bankcard',
      providerRef: 'bankcard-flow-123',
    });
  });

  it('fails closed for unknown database statuses', async () => {
    const service = new KycService(new FakeKycDb([{ userId: 123, status: 'provider_surprise' }]).asDB());

    await expect(service.getStatus(123)).resolves.toBe('review_required');
  });

  it('rejects invalid public inputs', async () => {
    const service = new KycService(new FakeKycDb().asDB());

    await expect(service.getStatus(0)).rejects.toBeInstanceOf(RangeError);
  });

  it('upserts a provider-backed status and returns the stored KYC profile', async () => {
    const fakeDb = new FakeKycDb();
    const service = new KycService(fakeDb.asDB());
    const reviewedAt = new Date('2026-07-03T02:30:00.000Z');

    const row = await service.upsertStatus({
      userId: 123,
      status: 'passed',
      provider: 'cn-bankcard',
      providerRef: 'aliyun-kyc-123',
      bankCardHash: 'bank_hash_123',
      reviewerUserId: 999,
      note: 'same-name bank card verified',
      now: reviewedAt,
    });

    expect(row).toMatchObject({
      userId: 123,
      status: 'passed',
      country: 'CN',
      provider: 'cn-bankcard',
      providerRef: 'aliyun-kyc-123',
      bankCardHash: 'bank_hash_123',
      reviewedAt,
      metadata: {
        reviewerUserId: 999,
        note: 'same-name bank card verified',
      },
    });
    expect(row.externalId).toMatch(/^pay_/);
    expect(fakeDb.rowsCreated).toBe(1);
    expect(fakeDb.upsertSetAttempts).toHaveLength(1);
  });

  it('records bank card change time when a verified card changes', async () => {
    const fakeDb = new FakeKycDb([
      {
        id: 10,
        externalId: 'pay_existing_kyc',
        userId: 123,
        status: 'passed',
        country: 'CN',
        provider: 'cn-bankcard',
        providerRef: 'bankcard-flow-existing',
        bankCardHash: 'bank_hash_old',
        reviewedAt: new Date('2026-07-01T00:00:00.000Z'),
        metadata: {
          source: 'cn-bankcard',
          bankCardHashUpdatedAt: '2026-07-01T00:00:00.000Z',
        },
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-07-01T00:00:00.000Z'),
      },
    ]);
    const service = new KycService(fakeDb.asDB());
    const changedAt = new Date('2026-07-03T03:00:00.000Z');

    const row = await service.upsertStatus({
      userId: 123,
      status: 'passed',
      provider: 'cn-bankcard',
      bankCardHash: 'bank_hash_new',
      now: changedAt,
    });

    expect(row).toMatchObject({
      bankCardHash: 'bank_hash_new',
      metadata: {
        source: 'cn-bankcard',
        bankCardHashUpdatedAt: '2026-07-03T03:00:00.000Z',
      },
    });
  });

  it('updates the existing user profile without creating a duplicate row', async () => {
    const fakeDb = new FakeKycDb([
      {
        id: 10,
        externalId: 'pay_existing_kyc',
        userId: 123,
        status: 'pending',
        country: 'CN',
        provider: 'manual',
        providerRef: 'bankcard-flow-existing',
        reviewedAt: null,
        metadata: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);
    const service = new KycService(fakeDb.asDB());

    const row = await service.upsertStatus({
      userId: 123,
      status: 'rejected',
      provider: 'manual',
      note: 'document mismatch',
      now: new Date('2026-07-03T03:00:00.000Z'),
    });

    expect(row).toMatchObject({
      id: 10,
      externalId: 'pay_existing_kyc',
      status: 'rejected',
      provider: 'manual',
      providerRef: 'bankcard-flow-existing',
      metadata: { note: 'document mismatch' },
    });
    expect(fakeDb.rowsCreated).toBe(0);
    expect(fakeDb.insertAttempts).toHaveLength(1);
  });

  it('preserves existing provider audit metadata when reviewing an existing profile', async () => {
    const fakeDb = new FakeKycDb([
      {
        id: 10,
        externalId: 'pay_existing_kyc',
        userId: 123,
        status: 'review_required',
        country: 'CN',
        provider: 'cn-bankcard',
        providerRef: 'bankcard-flow-existing',
        reviewedAt: null,
        metadata: {
          source: 'cn-bankcard',
          providerRef: 'bankcard-flow-existing',
          providerRequestId: 'aliyun-job-1',
          bankCardLast4: '1234',
        },
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);
    const service = new KycService(fakeDb.asDB());

    const row = await service.upsertStatus({
      userId: 123,
      status: 'passed',
      provider: 'cn-bankcard',
      reviewerUserId: 999,
      note: 'same-name bank card verified',
      now: new Date('2026-07-03T03:30:00.000Z'),
    });

    expect(row.metadata).toMatchObject({
      source: 'cn-bankcard',
      providerRef: 'bankcard-flow-existing',
      providerRequestId: 'aliyun-job-1',
      bankCardLast4: '1234',
      reviewerUserId: 999,
      note: 'same-name bank card verified',
    });
  });

  it('rejects not_started as an explicit upsert target', async () => {
    const service = new KycService(new FakeKycDb().asDB());

    await expect(
      service.upsertStatus({
        userId: 123,
        status: 'not_started',
        provider: 'manual',
      }),
    ).rejects.toBeInstanceOf(RangeError);
  });
});
