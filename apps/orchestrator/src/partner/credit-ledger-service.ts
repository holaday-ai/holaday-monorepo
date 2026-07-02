import { newExternalId } from '@holaday/shared-types';
import { eq, sql } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { holaCreditLedgerEntries, type HolaCreditLedgerEntry } from '../db/schema/partner.js';

export type CreditBucket = 'available' | 'locked' | 'withdrawable' | 'pending_withdrawal' | 'frozen';
export type LedgerDirection = 'credit' | 'debit';

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
    if (!key) continue;

    if (entry.direction === 'credit') {
      summary[key] += entry.amountCreditCents;
    } else if (entry.direction === 'debit') {
      summary[key] -= entry.amountCreditCents;
    }
  }

  return summary;
}

function normalizeAmount(value: number | undefined, fieldName: string): number {
  const amount = value ?? 0;
  if (!Number.isInteger(amount) || amount < 0) {
    throw new RangeError(`${fieldName} must be a non-negative integer`);
  }
  return amount;
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
    const amountCreditCents = normalizeAmount(input.amountCreditCents, 'amountCreditCents');
    const amountApiUnits = normalizeAmount(input.amountApiUnits, 'amountApiUnits');

    await this.db
      .insert(holaCreditLedgerEntries)
      .values({
        externalId: newExternalId('payment'),
        userId: input.userId,
        lotId: input.lotId ?? null,
        entryType: input.entryType,
        direction: input.direction,
        bucket: input.bucket,
        amountCreditCents,
        amountApiUnits,
        status: 'posted',
        idempotencyKey: input.idempotencyKey,
        metadata: input.metadata ?? null,
      })
      .onDuplicateKeyUpdate({ set: { idempotencyKey: sql`idempotency_key` } });

    const [entry] = await this.db
      .select()
      .from(holaCreditLedgerEntries)
      .where(eq(holaCreditLedgerEntries.idempotencyKey, input.idempotencyKey))
      .limit(1);

    if (!entry) {
      throw new Error('hola credit ledger entry vanished after idempotent insert');
    }
    return entry;
  }

  async summarizeUser(userId: number): Promise<LedgerSummary> {
    const rows = await this.db
      .select({
        bucket: holaCreditLedgerEntries.bucket,
        direction: holaCreditLedgerEntries.direction,
        amountCreditCents: holaCreditLedgerEntries.amountCreditCents,
        status: holaCreditLedgerEntries.status,
      })
      .from(holaCreditLedgerEntries)
      .where(eq(holaCreditLedgerEntries.userId, userId));

    return summarizeLedgerEntries(rows);
  }
}
