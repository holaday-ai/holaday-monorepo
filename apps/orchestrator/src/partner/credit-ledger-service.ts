import { newExternalId } from '@holaday/shared-types';
import { eq, sql } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { holaCreditLedgerEntries, type HolaCreditLedgerEntry } from '../db/schema/partner.js';

export type CreditBucket = 'available' | 'locked' | 'withdrawable' | 'pending_withdrawal' | 'frozen';
export type LedgerDirection = 'credit' | 'debit';

const CREDIT_BUCKET_VALUES: readonly CreditBucket[] = [
  'available',
  'locked',
  'withdrawable',
  'pending_withdrawal',
  'frozen',
];
const LEDGER_DIRECTION_VALUES: readonly LedgerDirection[] = ['credit', 'debit'];
const MYSQL_UNSIGNED_INT_MAX = 4_294_967_295;

export interface LedgerSummaryInput {
  bucket: string;
  direction: string;
  amountCreditCents: number;
  status: string;
}

export interface LedgerSummary {
  availableCreditCents: number;
  lockedCreditCents: number;
  withdrawableCreditCents: number;
  pendingWithdrawalCreditCents: number;
  frozenCreditCents: number;
}

const SUMMARY_KEY_BY_BUCKET = new Map<string, keyof LedgerSummary>([
  ['available', 'availableCreditCents'],
  ['locked', 'lockedCreditCents'],
  ['withdrawable', 'withdrawableCreditCents'],
  ['pending_withdrawal', 'pendingWithdrawalCreditCents'],
  ['frozen', 'frozenCreditCents'],
]);

export class LedgerIdempotencyConflictError extends Error {
  constructor() {
    super('Hola credit ledger idempotency key was reused with a different payload');
    this.name = 'LedgerIdempotencyConflictError';
    Object.setPrototypeOf(this, LedgerIdempotencyConflictError.prototype);
  }
}

export function summarizeLedgerEntries(entries: readonly LedgerSummaryInput[]): LedgerSummary {
  const summary: LedgerSummary = {
    availableCreditCents: 0,
    lockedCreditCents: 0,
    withdrawableCreditCents: 0,
    pendingWithdrawalCreditCents: 0,
    frozenCreditCents: 0,
  };

  for (const entry of entries) {
    if (entry.status !== 'posted') continue;

    const key = SUMMARY_KEY_BY_BUCKET.get(entry.bucket);
    if (!key) {
      throw new RangeError('ledger bucket must be a known credit bucket');
    }

    if (entry.direction === 'credit') {
      summary[key] += entry.amountCreditCents;
    } else if (entry.direction === 'debit') {
      summary[key] -= entry.amountCreditCents;
    } else {
      throw new RangeError('ledger direction must be credit or debit');
    }
  }

  return summary;
}

function normalizeAmount(value: number | undefined, fieldName: string, maxValue = Number.MAX_SAFE_INTEGER): number {
  const amount = value ?? 0;
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > maxValue) {
    throw new RangeError(`${fieldName} must be a non-negative safe integer`);
  }
  return amount;
}

function normalizePositiveSafeInteger(value: number, fieldName: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${fieldName} must be a positive safe integer`);
  }
  return value;
}

function normalizeOptionalPositiveSafeInteger(
  value: number | null | undefined,
  fieldName: string,
): number | null {
  if (value == null) return null;
  return normalizePositiveSafeInteger(value, fieldName);
}

function normalizeBoundedString(value: string, fieldName: string, maxLength: number): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
    throw new RangeError(`${fieldName} must be a non-empty string with length <= ${maxLength}`);
  }
  return value;
}

function normalizeDirection(value: string): LedgerDirection {
  if (!LEDGER_DIRECTION_VALUES.includes(value as LedgerDirection)) {
    throw new RangeError('direction must be credit or debit');
  }
  return value as LedgerDirection;
}

function normalizeBucket(value: string): CreditBucket {
  if (!CREDIT_BUCKET_VALUES.includes(value as CreditBucket)) {
    throw new RangeError('bucket must be a known credit bucket');
  }
  return value as CreditBucket;
}

interface NormalizedPostEntry {
  userId: number;
  lotId: number | null;
  entryType: string;
  direction: LedgerDirection;
  bucket: CreditBucket;
  amountCreditCents: number;
  amountApiUnits: number;
  status: 'posted';
  idempotencyKey: string;
  metadata: Record<string, unknown> | null;
}

function normalizePostEntryInput(input: {
  userId: number;
  lotId?: number | null;
  entryType: string;
  direction: LedgerDirection;
  bucket: CreditBucket;
  amountCreditCents?: number;
  amountApiUnits?: number;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}): NormalizedPostEntry {
  return {
    userId: normalizePositiveSafeInteger(input.userId, 'userId'),
    lotId: normalizeOptionalPositiveSafeInteger(input.lotId, 'lotId'),
    entryType: normalizeBoundedString(input.entryType, 'entryType', 48),
    direction: normalizeDirection(input.direction),
    bucket: normalizeBucket(input.bucket),
    amountCreditCents: normalizeAmount(input.amountCreditCents, 'amountCreditCents', MYSQL_UNSIGNED_INT_MAX),
    amountApiUnits: normalizeAmount(input.amountApiUnits, 'amountApiUnits'),
    status: 'posted',
    idempotencyKey: normalizeBoundedString(input.idempotencyKey, 'idempotencyKey', 160),
    metadata: input.metadata ?? null,
  };
}

function assertIdempotentPayloadMatches(
  row: HolaCreditLedgerEntry,
  expected: NormalizedPostEntry,
): void {
  if (
    row.userId !== expected.userId ||
    (row.lotId ?? null) !== expected.lotId ||
    row.entryType !== expected.entryType ||
    row.direction !== expected.direction ||
    row.bucket !== expected.bucket ||
    row.amountCreditCents !== expected.amountCreditCents ||
    row.amountApiUnits !== expected.amountApiUnits ||
    row.status !== expected.status
  ) {
    throw new LedgerIdempotencyConflictError();
  }
}

export class CreditLedgerService {
  constructor(private readonly db: DB) {}

  async postEntry(input: {
    userId: number;
    lotId?: number | null;
    entryType: string;
    direction: LedgerDirection;
    bucket: CreditBucket;
    amountCreditCents?: number;
    amountApiUnits?: number;
    idempotencyKey: string;
    metadata?: Record<string, unknown>;
  }): Promise<HolaCreditLedgerEntry> {
    const entry = normalizePostEntryInput(input);

    await this.db
      .insert(holaCreditLedgerEntries)
      .values({
        externalId: newExternalId('payment'),
        userId: entry.userId,
        lotId: entry.lotId,
        entryType: entry.entryType,
        direction: entry.direction,
        bucket: entry.bucket,
        amountCreditCents: entry.amountCreditCents,
        amountApiUnits: entry.amountApiUnits,
        status: entry.status,
        idempotencyKey: entry.idempotencyKey,
        metadata: entry.metadata,
      })
      .onDuplicateKeyUpdate({ set: { idempotencyKey: sql`idempotency_key` } });

    const [row] = await this.db
      .select()
      .from(holaCreditLedgerEntries)
      .where(eq(holaCreditLedgerEntries.idempotencyKey, entry.idempotencyKey))
      .limit(1);

    if (!row) {
      throw new Error('hola credit ledger entry vanished after idempotent insert');
    }
    assertIdempotentPayloadMatches(row, entry);
    return row;
  }

  async summarizeUser(userId: number): Promise<LedgerSummary> {
    const normalizedUserId = normalizePositiveSafeInteger(userId, 'userId');
    const rows = await this.db
      .select({
        bucket: holaCreditLedgerEntries.bucket,
        direction: holaCreditLedgerEntries.direction,
        amountCreditCents: holaCreditLedgerEntries.amountCreditCents,
        status: holaCreditLedgerEntries.status,
      })
      .from(holaCreditLedgerEntries)
      .where(eq(holaCreditLedgerEntries.userId, normalizedUserId));

    return summarizeLedgerEntries(rows);
  }
}
