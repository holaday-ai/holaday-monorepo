import { inspect } from 'node:util';
import type { PartnerKycStatus } from '@holaday/shared-types';
import { describe, expect, it } from 'vitest';
import type { DB } from '../db/client.js';
import { users } from '../db/schema/users.js';
import { partnerWithdrawalRequests, type PartnerWithdrawalRequest } from '../db/schema/partner.js';
import { LedgerIdempotencyConflictError, type CreditLedgerService } from './credit-ledger-service.js';
import type { KycService } from './kyc-service.js';
import { evaluatePartnerRisk } from './risk-service.js';
import {
  WITHDRAWAL_MIN_CREDIT_CENTS,
  WithdrawalGateError,
  WithdrawalRequestIdempotencyConflictError,
  WithdrawalService,
  WithdrawalValidationError,
  computeWithdrawalReviewDueAt,
  validateWithdrawalRequest,
} from './withdrawal-service.js';

type FakeWithdrawalInsert = {
  externalId: string;
  userId: number;
  amountCreditCents: number;
  status: string;
  reviewDueAt: Date;
  bankAccountFingerprint: string;
  riskScore: number;
  idempotencyKey: string;
  metadata?: unknown;
};

type FakeLedgerPostInput = Parameters<CreditLedgerService['postEntry']>[0];
type FakeLedgerEntry = Omit<FakeLedgerPostInput, 'lotId' | 'amountCreditCents' | 'amountApiUnits' | 'metadata'> & {
  lotId: number | null;
  amountCreditCents: number;
  amountApiUnits: number;
  metadata: Record<string, unknown> | null;
};

class FakeWithdrawalDb {
  readonly rows: PartnerWithdrawalRequest[];
  readonly insertAttempts: FakeWithdrawalInsert[] = [];
  readonly wherePredicateTexts: string[] = [];
  readonly lockedUserIds: number[] = [];
  transactionCalls = 0;
  rowsCreated = 0;
  private nextId: number;

  constructor(rows: PartnerWithdrawalRequest[] = []) {
    this.rows = [...rows];
    this.nextId = Math.max(0, ...rows.map((row) => row.id)) + 1;
  }

  asDB(): DB {
    return this as unknown as DB;
  }

  async transaction<T>(callback: (tx: this) => Promise<T>): Promise<T> {
    this.transactionCalls += 1;
    const rowSnapshot = [...this.rows];
    const insertSnapshot = [...this.insertAttempts];
    const rowsCreatedSnapshot = this.rowsCreated;
    const nextIdSnapshot = this.nextId;
    try {
      return await callback(this);
    } catch (error) {
      this.rows.splice(0, this.rows.length, ...rowSnapshot);
      this.insertAttempts.splice(0, this.insertAttempts.length, ...insertSnapshot);
      this.rowsCreated = rowsCreatedSnapshot;
      this.nextId = nextIdSnapshot;
      throw error;
    }
  }

  insert(table: unknown) {
    return {
      values: (values: FakeWithdrawalInsert) => {
        if (table !== partnerWithdrawalRequests) {
          throw new Error('unexpected insert table');
        }

        return {
          onDuplicateKeyUpdate: async (_config: unknown) => {
            this.insertAttempts.push(values);
            const existing = this.rows.find((row) => row.idempotencyKey === values.idempotencyKey);
            if (existing) return;
            this.rows.push({
              id: this.nextId,
              rejectionReason: null,
              metadata: null,
              createdAt: new Date('2026-01-01T00:00:00.000Z'),
              updatedAt: new Date('2026-01-01T00:00:00.000Z'),
              ...values,
            });
            this.nextId += 1;
            this.rowsCreated += 1;
          },
        };
      },
    };
  }

  select(_selection?: unknown) {
    return {
      from: (table: unknown) => ({
        where: (predicate: unknown) => {
          const predicateText = inspect(predicate, { depth: 6, getters: true });
          this.wherePredicateTexts.push(predicateText);
          const chain = {
            for: (lock: string) => {
              if (table === users && lock === 'update') {
                const userId = Number(predicateText.match(/value:\s*(\d+)/)?.[1] ?? 0);
                this.lockedUserIds.push(userId);
              }
              return chain;
            },
            limit: async (count: number) => this.selectRows(table, predicateText).slice(0, count),
          };
          return {
            ...chain,
          };
        },
      }),
    };
  }

  private selectRows(table: unknown, predicateText: string): PartnerWithdrawalRequest[] | Array<{ id: number }> {
    if (table === users) {
      const userId = Number(predicateText.match(/value:\s*(\d+)/)?.[1] ?? 0);
      return userId > 0 ? [{ id: userId }] : [];
    }
    if (table !== partnerWithdrawalRequests) return [];
    const byKey = this.rows.find((row) => predicateText.includes(row.idempotencyKey));
    if (byKey) return [byKey];
    const byExternalId = this.rows.find((row) => predicateText.includes(row.externalId));
    return byExternalId ? [byExternalId] : [];
  }
}

class FakeLedgerService implements Pick<CreditLedgerService, 'postEntry' | 'summarizeUser'> {
  readonly entries: FakeLedgerEntry[] = [];
  readonly attempts: FakeLedgerPostInput[] = [];
  readonly conflictKeys: Set<string>;

  constructor(
    private readonly baseAvailableCreditCents: number,
    input: { entries?: FakeLedgerEntry[]; conflictKeys?: string[] } = {},
  ) {
    this.entries = [...(input.entries ?? [])];
    this.conflictKeys = new Set(input.conflictKeys ?? []);
  }

  async summarizeUser(userId: number) {
    const postedAvailableDelta = this.entries
      .filter((entry) => entry.userId === userId && entry.bucket === 'available')
      .reduce(
        (sum, entry) => sum + (entry.direction === 'credit' ? entry.amountCreditCents : -entry.amountCreditCents),
        0,
      );
    return {
      availableCreditCents: this.baseAvailableCreditCents + postedAvailableDelta,
      lockedCreditCents: 0,
      withdrawableCreditCents: 0,
      pendingWithdrawalCreditCents: 0,
      frozenCreditCents: 0,
    };
  }

  async postEntry(input: FakeLedgerPostInput) {
    this.attempts.push(input);
    if (this.conflictKeys.has(input.idempotencyKey)) {
      throw new LedgerIdempotencyConflictError();
    }
    const existing = this.entries.find((entry) => entry.idempotencyKey === input.idempotencyKey);
    if (existing) {
      if (
        existing.userId !== input.userId ||
        existing.entryType !== input.entryType ||
        existing.direction !== input.direction ||
        existing.bucket !== input.bucket ||
        existing.amountCreditCents !== input.amountCreditCents
      ) {
        throw new LedgerIdempotencyConflictError();
      }
      return {
        id: this.entries.indexOf(existing) + 1,
        externalId: `ledger_${this.entries.indexOf(existing) + 1}`,
        status: 'posted',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        ...existing,
      };
    }

    const entry: FakeLedgerEntry = {
      ...input,
      lotId: input.lotId ?? null,
      amountCreditCents: input.amountCreditCents ?? 0,
      amountApiUnits: input.amountApiUnits ?? 0,
      metadata: input.metadata ?? null,
    };
    this.entries.push(entry);
    return {
      id: this.entries.length,
      externalId: `ledger_${this.entries.length}`,
      status: 'posted',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      ...entry,
    };
  }
}

function fakeKycService(status: PartnerKycStatus): Pick<KycService, 'getStatus'> {
  return {
    getStatus: async () => status,
  };
}

function fakeWithdrawalRequest(overrides: Partial<PartnerWithdrawalRequest> = {}): PartnerWithdrawalRequest {
  return {
    id: 1,
    externalId: 'pay_existing_withdrawal',
    userId: 123,
    amountCreditCents: 600_00,
    status: 'requested',
    reviewDueAt: new Date('2026-07-09T10:20:30.000Z'),
    bankAccountFingerprint: 'bank_fingerprint_123',
    riskScore: 12,
    idempotencyKey: 'withdrawal-idem-1',
    rejectionReason: null,
    metadata: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function fakeHoldEntry(overrides: Partial<FakeLedgerEntry> = {}): FakeLedgerEntry {
  return {
    userId: 123,
    lotId: null,
    entryType: 'withdrawal_request_hold',
    direction: 'debit',
    bucket: 'available',
    amountCreditCents: 600_00,
    amountApiUnits: 0,
    idempotencyKey: 'withdrawal:hold:withdrawal-idem-1',
    metadata: {
      withdrawalRequestId: 1,
      withdrawalRequestExternalId: 'pay_existing_withdrawal',
    },
    ...overrides,
  };
}

function serviceWithDeps(input: {
  db?: FakeWithdrawalDb;
  ledger?: FakeLedgerService;
  kycStatus?: PartnerKycStatus;
} = {}): { db: FakeWithdrawalDb; ledger: FakeLedgerService; service: WithdrawalService } {
  const db = input.db ?? new FakeWithdrawalDb();
  const ledger = input.ledger ?? new FakeLedgerService(2_000_00);
  const service = new WithdrawalService(db.asDB(), {
    ledger,
    kyc: fakeKycService(input.kycStatus ?? 'passed') as KycService,
  });
  return { db, ledger, service };
}

const validWithdrawalInput: Parameters<WithdrawalService['requestWithdrawal']>[0] = {
  userId: 123,
  amountCreditCents: 600_00,
  bankAccountFingerprint: 'bank_fingerprint_123',
  highRisk: false,
  riskScore: 12,
  idempotencyKey: 'withdrawal-idem-1',
  now: new Date('2026-07-02T10:20:30.000Z'),
};

describe('evaluatePartnerRisk', () => {
  it('returns frozen with score 100 when the account is frozen', () => {
    expect(
      evaluatePartnerRisk({
        kycPassed: false,
        sameNameBank: false,
        amountCreditCents: 99_000_00,
        referralConcentration: true,
        accountFrozen: true,
      }),
    ).toEqual({ status: 'frozen', score: 100, reasons: ['account_frozen'] });
  });

  it('returns normal with score 0 when no review reasons apply', () => {
    expect(
      evaluatePartnerRisk({
        kycPassed: true,
        sameNameBank: true,
        amountCreditCents: 1_000_00,
        referralConcentration: false,
        accountFrozen: false,
      }),
    ).toEqual({ status: 'normal', score: 0, reasons: [] });
  });

  it('returns review reasons with score capped below frozen', () => {
    const decision = evaluatePartnerRisk({
      kycPassed: false,
      sameNameBank: false,
      amountCreditCents: 50_000_00,
      referralConcentration: true,
      accountFrozen: false,
    });

    expect(decision.status).toBe('review_required');
    expect(decision.reasons).toEqual([
      'missing_kyc',
      'bank_name_mismatch',
      'large_amount',
      'referral_concentration',
    ]);
    expect(decision.score).toBeLessThanOrEqual(99);
    expect(decision.score).toBeGreaterThan(0);
  });

  it('rejects invalid risk amounts', () => {
    expect(() =>
      evaluatePartnerRisk({
        kycPassed: true,
        sameNameBank: true,
        amountCreditCents: -1,
        referralConcentration: false,
        accountFrozen: false,
      }),
    ).toThrow(RangeError);
  });

  it('rejects invalid risk booleans', () => {
    expect(() =>
      evaluatePartnerRisk({
        kycPassed: 'yes' as unknown as boolean,
        sameNameBank: true,
        amountCreditCents: 1_000_00,
        referralConcentration: false,
        accountFrozen: false,
      }),
    ).toThrow(RangeError);
  });
});

describe('withdrawal pure helpers', () => {
  it('enforces the minimum withdrawal amount', () => {
    expect(
      validateWithdrawalRequest({
        amountCreditCents: WITHDRAWAL_MIN_CREDIT_CENTS - 1,
        availableCreditCents: WITHDRAWAL_MIN_CREDIT_CENTS,
      }),
    ).toEqual({ ok: false, reason: 'below_minimum' });
    expect(
      validateWithdrawalRequest({
        amountCreditCents: WITHDRAWAL_MIN_CREDIT_CENTS,
        availableCreditCents: WITHDRAWAL_MIN_CREDIT_CENTS,
      }),
    ).toEqual({ ok: true });
  });

  it('blocks requests above available credit', () => {
    expect(
      validateWithdrawalRequest({
        amountCreditCents: 600_00,
        availableCreditCents: 599_99,
      }),
    ).toEqual({ ok: false, reason: 'insufficient_available_credit' });
  });

  it('computes T+7 and T+15 review due dates with UTC day math without mutating now', () => {
    const now = new Date('2026-03-08T23:30:15.123Z');
    const originalTime = now.getTime();

    expect(computeWithdrawalReviewDueAt({ now, highRisk: false }).toISOString()).toBe(
      '2026-03-15T23:30:15.123Z',
    );
    expect(computeWithdrawalReviewDueAt({ now, highRisk: true }).toISOString()).toBe(
      '2026-03-23T23:30:15.123Z',
    );
    expect(now.getTime()).toBe(originalTime);
  });

  it.each([
    ['negative amount', () => validateWithdrawalRequest({ amountCreditCents: -1, availableCreditCents: 1_000_00 })],
    [
      'fractional available credit',
      () => validateWithdrawalRequest({ amountCreditCents: 500_00, availableCreditCents: 1_000_00.5 }),
    ],
    ['invalid date', () => computeWithdrawalReviewDueAt({ now: new Date(Number.NaN), highRisk: false })],
  ])('rejects helper validation for %s', (_name, action) => {
    expect(action).toThrow(RangeError);
  });
});

describe('WithdrawalService requestWithdrawal', () => {
  it('blocks requests below the minimum', async () => {
    const { db, ledger, service } = serviceWithDeps();

    await expect(
      service.requestWithdrawal({
        ...validWithdrawalInput,
        amountCreditCents: WITHDRAWAL_MIN_CREDIT_CENTS - 1,
      }),
    ).rejects.toMatchObject({ reason: 'below_minimum' });
    expect(db.rowsCreated).toBe(0);
    expect(ledger.entries).toHaveLength(0);
  });

  it('blocks requests above available credit', async () => {
    const { db, ledger, service } = serviceWithDeps({ ledger: new FakeLedgerService(599_99) });

    await expect(service.requestWithdrawal(validWithdrawalInput)).rejects.toMatchObject({
      reason: 'insufficient_available_credit',
    });
    expect(db.rowsCreated).toBe(0);
    expect(ledger.entries).toHaveLength(0);
  });

  it('requires passed KYC before withdrawal', async () => {
    const { db, ledger, service } = serviceWithDeps({ kycStatus: 'review_required' });

    await expect(service.requestWithdrawal(validWithdrawalInput)).rejects.toBeInstanceOf(WithdrawalGateError);
    await expect(service.requestWithdrawal(validWithdrawalInput)).rejects.toMatchObject({ reason: 'kyc_required' });
    expect(db.rowsCreated).toBe(0);
    expect(ledger.entries).toHaveLength(0);
  });

  it('inserts a requested withdrawal and posts exactly two hold ledger entries', async () => {
    const { db, ledger, service } = serviceWithDeps();

    const row = await service.requestWithdrawal(validWithdrawalInput);

    expect(row).toMatchObject({
      userId: 123,
      amountCreditCents: 600_00,
      status: 'requested',
      reviewDueAt: new Date('2026-07-09T10:20:30.000Z'),
      bankAccountFingerprint: 'bank_fingerprint_123',
      riskScore: 12,
    });
    expect(row.externalId).toMatch(/^pay_/);
    expect(db.rowsCreated).toBe(1);
    expect(db.insertAttempts[0]).toMatchObject({
      status: 'requested',
      reviewDueAt: new Date('2026-07-09T10:20:30.000Z'),
      bankAccountFingerprint: 'bank_fingerprint_123',
      riskScore: 12,
      idempotencyKey: 'withdrawal-idem-1',
    });
    expect(db.transactionCalls).toBe(1);
    expect(db.lockedUserIds).toEqual([123]);
    expect(db.wherePredicateTexts.some((predicateText) => predicateText.includes('idempotency_key'))).toBe(true);
    expect(ledger.entries).toHaveLength(2);
    expect(ledger.entries).toEqual([
      expect.objectContaining({
        userId: 123,
        entryType: 'withdrawal_request_hold',
        direction: 'debit',
        bucket: 'available',
        amountCreditCents: 600_00,
        idempotencyKey: 'withdrawal:hold:withdrawal-idem-1',
      }),
      expect.objectContaining({
        userId: 123,
        entryType: 'withdrawal_request_hold',
        direction: 'credit',
        bucket: 'pending_withdrawal',
        amountCreditCents: 600_00,
        idempotencyKey: 'withdrawal:pending:withdrawal-idem-1',
      }),
    ]);
  });

  it('uses reviewing status and T+15 due date for high-risk withdrawals', async () => {
    const { ledger, service } = serviceWithDeps();

    const row = await service.requestWithdrawal({
      ...validWithdrawalInput,
      highRisk: true,
      riskScore: 88,
      idempotencyKey: 'withdrawal-idem-high-risk',
    });

    expect(row).toMatchObject({
      status: 'reviewing',
      reviewDueAt: new Date('2026-07-17T10:20:30.000Z'),
      riskScore: 88,
    });
    expect(ledger.entries).toHaveLength(2);
  });

  it('returns the same request row without duplicating request or ledger entries on exact retry', async () => {
    const { db, ledger, service } = serviceWithDeps();

    const first = await service.requestWithdrawal(validWithdrawalInput);
    const second = await service.requestWithdrawal(validWithdrawalInput);

    expect(second).toBe(first);
    expect(db.rowsCreated).toBe(1);
    expect(ledger.attempts).toHaveLength(4);
    expect(ledger.entries).toHaveLength(2);
  });

  it.each([
    ['different amount', { amountCreditCents: 700_00 }],
    ['different user', { userId: 456 }],
    ['different fingerprint', { bankAccountFingerprint: 'different_bank_fingerprint' }],
    ['different highRisk status', { highRisk: true }],
    ['different riskScore', { riskScore: 77 }],
  ])('throws an idempotency conflict for same key with %s', async (_name, patch) => {
    const existing = fakeWithdrawalRequest();
    const { db, ledger, service } = serviceWithDeps({
      db: new FakeWithdrawalDb([existing]),
      ledger: new FakeLedgerService(2_000_00),
    });

    await expect(
      service.requestWithdrawal({
        ...validWithdrawalInput,
        ...patch,
      }),
    ).rejects.toBeInstanceOf(WithdrawalRequestIdempotencyConflictError);
    expect(db.rows).toEqual([existing]);
    expect(db.rowsCreated).toBe(0);
    expect(ledger.entries).toHaveLength(0);
  });

  it('does not re-check available balance for an exact-balance retry', async () => {
    const { db, ledger, service } = serviceWithDeps({ ledger: new FakeLedgerService(600_00) });

    const first = await service.requestWithdrawal(validWithdrawalInput);
    const second = await service.requestWithdrawal(validWithdrawalInput);

    expect(second).toBe(first);
    expect(db.rowsCreated).toBe(1);
    expect(ledger.entries).toHaveLength(2);
  });

  it('repairs both ledger holds for an existing request without holds', async () => {
    const existing = fakeWithdrawalRequest();
    const { db, ledger, service } = serviceWithDeps({
      db: new FakeWithdrawalDb([existing]),
      ledger: new FakeLedgerService(0),
    });

    const row = await service.requestWithdrawal(validWithdrawalInput);

    expect(row).toBe(existing);
    expect(db.rowsCreated).toBe(0);
    expect(ledger.entries).toHaveLength(2);
    expect(ledger.entries.map((entry) => entry.idempotencyKey)).toEqual([
      'withdrawal:hold:withdrawal-idem-1',
      'withdrawal:pending:withdrawal-idem-1',
    ]);
  });

  it('repairs a missing pending hold without duplicating an existing debit hold', async () => {
    const existing = fakeWithdrawalRequest();
    const debit = fakeHoldEntry();
    const { ledger, service } = serviceWithDeps({
      db: new FakeWithdrawalDb([existing]),
      ledger: new FakeLedgerService(0, { entries: [debit] }),
    });

    const row = await service.requestWithdrawal(validWithdrawalInput);

    expect(row).toBe(existing);
    expect(ledger.entries.filter((entry) => entry.idempotencyKey === 'withdrawal:hold:withdrawal-idem-1')).toHaveLength(1);
    expect(ledger.entries.filter((entry) => entry.idempotencyKey === 'withdrawal:pending:withdrawal-idem-1')).toHaveLength(1);
  });

  it('rolls back a newly inserted request when a ledger hold conflicts', async () => {
    const { db, ledger, service } = serviceWithDeps({
      ledger: new FakeLedgerService(2_000_00, {
        conflictKeys: ['withdrawal:hold:withdrawal-idem-1'],
      }),
    });

    await expect(service.requestWithdrawal(validWithdrawalInput)).rejects.toBeInstanceOf(
      LedgerIdempotencyConflictError,
    );
    expect(db.rowsCreated).toBe(0);
    expect(db.rows).toHaveLength(0);
    expect(ledger.entries).toHaveLength(0);
  });

  it('serializes distinct-key exact-balance withdrawals so the second sees the first hold', async () => {
    const { db, ledger, service } = serviceWithDeps({ ledger: new FakeLedgerService(600_00) });

    await service.requestWithdrawal(validWithdrawalInput);
    await expect(
      service.requestWithdrawal({
        ...validWithdrawalInput,
        idempotencyKey: 'withdrawal-idem-2',
      }),
    ).rejects.toMatchObject({ reason: 'insufficient_available_credit' });

    expect(db.rowsCreated).toBe(1);
    expect(db.lockedUserIds).toEqual([123, 123]);
    expect(ledger.entries).toHaveLength(2);
  });

  it.each([
    ['invalid user', { userId: 0 }],
    ['invalid amount', { amountCreditCents: Number.NaN }],
    ['empty bank fingerprint', { bankAccountFingerprint: '   ' }],
    ['long bank fingerprint', { bankAccountFingerprint: 'x'.repeat(129) }],
    ['negative riskScore', { riskScore: -1 }],
    ['riskScore over 100', { riskScore: 101 }],
    ['empty idempotency key', { idempotencyKey: '' }],
    ['long idempotency key', { idempotencyKey: 'x'.repeat(129) }],
    ['invalid now', { now: new Date(Number.NaN) }],
  ])('rejects %s', async (_name, patch) => {
    const { service } = serviceWithDeps();

    await expect(
      service.requestWithdrawal({
        ...validWithdrawalInput,
        ...patch,
      }),
    ).rejects.toBeInstanceOf(RangeError);
  });

  it('uses withdrawal validation errors for request amount gates', async () => {
    const { service } = serviceWithDeps();

    await expect(
      service.requestWithdrawal({
        ...validWithdrawalInput,
        amountCreditCents: WITHDRAWAL_MIN_CREDIT_CENTS - 1,
      }),
    ).rejects.toBeInstanceOf(WithdrawalValidationError);
  });
});
