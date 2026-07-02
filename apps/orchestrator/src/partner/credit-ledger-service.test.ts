import { describe, expect, it } from 'vitest';
import type { DB } from '../db/client.js';
import {
  CreditLedgerService,
  LedgerIdempotencyConflictError,
  summarizeLedgerEntries,
} from './credit-ledger-service.js';

type FakeLedgerRow = {
  id: number;
  externalId: string;
  userId: number;
  lotId: number | null;
  entryType: string;
  direction: string;
  bucket: string;
  amountCreditCents: number;
  amountApiUnits: number;
  status: string;
  idempotencyKey: string;
  metadata: unknown;
  createdAt: Date;
};

type FakeLedgerInsert = Omit<FakeLedgerRow, 'id' | 'createdAt'>;

class FakeCreditLedgerDb {
  readonly rows: FakeLedgerRow[];
  readonly insertedValues: FakeLedgerInsert[] = [];
  private nextId: number;
  private lastIdempotencyKey: string | null = null;

  constructor(rows: FakeLedgerRow[] = []) {
    this.rows = [...rows];
    this.nextId = Math.max(0, ...rows.map((row) => row.id)) + 1;
  }

  asDB(): DB {
    return this as unknown as DB;
  }

  insert(_table: unknown) {
    return {
      values: (values: FakeLedgerInsert) => {
        this.insertedValues.push(values);
        this.lastIdempotencyKey = values.idempotencyKey;
        return {
          onDuplicateKeyUpdate: async (_config: unknown) => {
            const existing = this.rows.find((row) => row.idempotencyKey === values.idempotencyKey);
            if (existing) return;
            this.rows.push({
              id: this.nextId,
              createdAt: new Date('2026-01-01T00:00:00.000Z'),
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
      from: (_table: unknown) => ({
        where: (_predicate: unknown) => ({
          limit: async (count: number) => {
            if (!this.lastIdempotencyKey) return [];
            return this.rows
              .filter((row) => row.idempotencyKey === this.lastIdempotencyKey)
              .slice(0, count);
          },
        }),
      }),
    };
  }
}

function fakeLedgerRow(overrides: Partial<FakeLedgerRow> = {}): FakeLedgerRow {
  return {
    id: 1,
    externalId: 'payment_existing',
    userId: 123,
    lotId: null,
    entryType: 'recharge',
    direction: 'credit',
    bucket: 'available',
    amountCreditCents: 10_00,
    amountApiUnits: 5,
    status: 'posted',
    idempotencyKey: 'ledger-idem-1',
    metadata: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

const validPostInput: Parameters<CreditLedgerService['postEntry']>[0] = {
  userId: 123,
  lotId: null,
  entryType: 'recharge',
  direction: 'credit',
  bucket: 'available',
  amountCreditCents: 10_00,
  amountApiUnits: 5,
  idempotencyKey: 'ledger-idem-1',
  metadata: { source: 'test' },
};

describe('CreditLedgerService pure summary', () => {
  it('summarizes credit buckets from posted ledger rows only', () => {
    const summary = summarizeLedgerEntries([
      { bucket: 'locked', direction: 'credit', amountCreditCents: 10_000_00, status: 'posted' },
      { bucket: 'locked', direction: 'debit', amountCreditCents: 1_500_00, status: 'posted' },
      { bucket: 'available', direction: 'credit', amountCreditCents: 1_500_00, status: 'posted' },
      { bucket: 'available', direction: 'credit', amountCreditCents: 99_00, status: 'voided' },
    ]);
    expect(summary).toEqual({
      availableCreditCents: 1_500_00,
      lockedCreditCents: 8_500_00,
      withdrawableCreditCents: 0,
      pendingWithdrawalCreditCents: 0,
      frozenCreditCents: 0,
    });
  });

  it('ignores unknown buckets', () => {
    const summary = summarizeLedgerEntries([
      { bucket: 'toString', direction: 'credit', amountCreditCents: 42_00, status: 'posted' },
    ]);
    expect(summary).toEqual({
      availableCreditCents: 0,
      lockedCreditCents: 0,
      withdrawableCreditCents: 0,
      pendingWithdrawalCreditCents: 0,
      frozenCreditCents: 0,
    });
  });

  it('throws for unknown directions on posted known buckets', () => {
    expect(() =>
      summarizeLedgerEntries([
        { bucket: 'available', direction: 'hold', amountCreditCents: 42_00, status: 'posted' },
      ]),
    ).toThrow(RangeError);
  });
});

describe('CreditLedgerService postEntry', () => {
  it('inserts and returns the readback row', async () => {
    const fakeDb = new FakeCreditLedgerDb();
    const service = new CreditLedgerService(fakeDb.asDB());

    const row = await service.postEntry(validPostInput);

    expect(row).toMatchObject({
      userId: 123,
      lotId: null,
      entryType: 'recharge',
      direction: 'credit',
      bucket: 'available',
      amountCreditCents: 10_00,
      amountApiUnits: 5,
      status: 'posted',
      idempotencyKey: 'ledger-idem-1',
      metadata: { source: 'test' },
    });
    expect(fakeDb.rows).toHaveLength(1);
    expect(fakeDb.insertedValues[0]).toMatchObject({
      userId: 123,
      lotId: null,
      status: 'posted',
      idempotencyKey: 'ledger-idem-1',
    });
  });

  it('returns an existing row for the same idempotency key and same payload', async () => {
    const existingRow = fakeLedgerRow({ metadata: { original: true } });
    const fakeDb = new FakeCreditLedgerDb([existingRow]);
    const service = new CreditLedgerService(fakeDb.asDB());

    const row = await service.postEntry({
      ...validPostInput,
      metadata: { retry: true },
    });

    expect(row).toBe(existingRow);
    expect(fakeDb.rows).toHaveLength(1);
  });

  it('throws a conflict error for the same idempotency key with a different amount', async () => {
    const fakeDb = new FakeCreditLedgerDb([fakeLedgerRow()]);
    const service = new CreditLedgerService(fakeDb.asDB());

    await expect(
      service.postEntry({
        ...validPostInput,
        amountCreditCents: 11_00,
      }),
    ).rejects.toBeInstanceOf(LedgerIdempotencyConflictError);
  });

  it('throws a conflict error for the same idempotency key with a different direction', async () => {
    const fakeDb = new FakeCreditLedgerDb([fakeLedgerRow()]);
    const service = new CreditLedgerService(fakeDb.asDB());

    await expect(
      service.postEntry({
        ...validPostInput,
        direction: 'debit',
      }),
    ).rejects.toBeInstanceOf(LedgerIdempotencyConflictError);
  });

  it.each([
    ['negative amount', { amountCreditCents: -1 }],
    ['fraction amount', { amountApiUnits: 1.5 }],
    ['bad userId', { userId: 0 }],
    ['empty idempotencyKey', { idempotencyKey: '' }],
    ['bad bucket', { bucket: 'mystery' }],
    ['bad direction', { direction: 'hold' }],
  ])('throws RangeError for %s', async (_name, patch) => {
    const fakeDb = new FakeCreditLedgerDb();
    const service = new CreditLedgerService(fakeDb.asDB());
    const input = { ...validPostInput, ...patch } as Parameters<CreditLedgerService['postEntry']>[0];

    await expect(service.postEntry(input)).rejects.toBeInstanceOf(RangeError);
  });
});
