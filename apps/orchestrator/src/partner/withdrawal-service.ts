import { newExternalId } from '@holaday/shared-types';
import { eq, sql } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { partnerWithdrawalRequests, type PartnerWithdrawalRequest } from '../db/schema/partner.js';
import { users } from '../db/schema/users.js';
import { CreditLedgerService } from './credit-ledger-service.js';
import { KycService, canWithdrawWithKycStatus } from './kyc-service.js';

export const WITHDRAWAL_MIN_CREDIT_CENTS = 500_00;

export type WithdrawalValidationResult =
  | { ok: true }
  | { ok: false; reason: 'below_minimum' | 'insufficient_available_credit' };

export class WithdrawalValidationError extends Error {
  constructor(readonly reason: 'below_minimum' | 'insufficient_available_credit') {
    super(`Withdrawal request rejected: ${reason}`);
    this.name = 'WithdrawalValidationError';
    Object.setPrototypeOf(this, WithdrawalValidationError.prototype);
  }
}

export class WithdrawalGateError extends Error {
  constructor(readonly reason: 'kyc_required') {
    super('Withdrawal requires passed KYC status');
    this.name = 'WithdrawalGateError';
    Object.setPrototypeOf(this, WithdrawalGateError.prototype);
  }
}

export class WithdrawalRequestIdempotencyConflictError extends Error {
  constructor() {
    super('Partner withdrawal request idempotency key was reused with a different payload');
    this.name = 'WithdrawalRequestIdempotencyConflictError';
    Object.setPrototypeOf(this, WithdrawalRequestIdempotencyConflictError.prototype);
  }
}

function assertNonNegativeSafeInteger(value: number, fieldName: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${fieldName} must be a non-negative safe integer`);
  }
  return value;
}

function assertPositiveSafeInteger(value: number, fieldName: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${fieldName} must be a positive safe integer`);
  }
  return value;
}

function assertRiskScore(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 100) {
    throw new RangeError('riskScore must be an integer from 0 to 100');
  }
  return value;
}

function assertBoolean(value: boolean, fieldName: string): boolean {
  if (typeof value !== 'boolean') {
    throw new RangeError(`${fieldName} must be a boolean`);
  }
  return value;
}

function assertBoundedNonEmptyString(value: string, fieldName: string, maxLength: number): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
    throw new RangeError(`${fieldName} must be a non-empty string with length <= ${maxLength}`);
  }
  return value;
}

function assertValidDate(value: Date, fieldName: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new RangeError(`${fieldName} must be a valid Date`);
  }
  return value;
}

function addUtcDays(value: Date, days: number): Date {
  return new Date(
    Date.UTC(
      value.getUTCFullYear(),
      value.getUTCMonth(),
      value.getUTCDate() + days,
      value.getUTCHours(),
      value.getUTCMinutes(),
      value.getUTCSeconds(),
      value.getUTCMilliseconds(),
    ),
  );
}

export function validateWithdrawalRequest(input: {
  amountCreditCents: number;
  availableCreditCents: number;
}): WithdrawalValidationResult {
  const amountCreditCents = assertNonNegativeSafeInteger(input.amountCreditCents, 'amountCreditCents');
  const availableCreditCents = assertNonNegativeSafeInteger(
    input.availableCreditCents,
    'availableCreditCents',
  );

  if (amountCreditCents < WITHDRAWAL_MIN_CREDIT_CENTS) {
    return { ok: false, reason: 'below_minimum' };
  }
  if (amountCreditCents > availableCreditCents) {
    return { ok: false, reason: 'insufficient_available_credit' };
  }
  return { ok: true };
}

export function computeWithdrawalReviewDueAt(input: { now: Date; highRisk: boolean }): Date {
  const now = assertValidDate(input.now, 'now');
  const highRisk = assertBoolean(input.highRisk, 'highRisk');
  return addUtcDays(now, highRisk ? 15 : 7);
}

type WithdrawalRequestInput = {
  userId: number;
  amountCreditCents: number;
  bankAccountFingerprint: string;
  highRisk: boolean;
  riskScore: number;
  idempotencyKey: string;
  now?: Date;
};

type WithdrawalStatus = 'requested' | 'reviewing';
type WithdrawalLedger = Pick<CreditLedgerService, 'postEntry' | 'summarizeUser'>;
type WithdrawalKyc = Pick<KycService, 'getStatus'>;

type NormalizedWithdrawalRequest = Required<WithdrawalRequestInput> & {
  status: WithdrawalStatus;
};

function normalizeRequestInput(input: WithdrawalRequestInput): NormalizedWithdrawalRequest {
  const highRisk = assertBoolean(input.highRisk, 'highRisk');
  return {
    userId: assertPositiveSafeInteger(input.userId, 'userId'),
    amountCreditCents: assertNonNegativeSafeInteger(input.amountCreditCents, 'amountCreditCents'),
    bankAccountFingerprint: assertBoundedNonEmptyString(
      input.bankAccountFingerprint,
      'bankAccountFingerprint',
      128,
    ),
    highRisk,
    riskScore: assertRiskScore(input.riskScore),
    idempotencyKey: assertBoundedNonEmptyString(input.idempotencyKey, 'idempotencyKey', 128),
    now: assertValidDate(input.now ?? new Date(), 'now'),
    status: highRisk ? 'reviewing' : 'requested',
  };
}

function assertIdempotentRequestPayloadMatches(
  row: PartnerWithdrawalRequest,
  expected: NormalizedWithdrawalRequest,
): void {
  if (
    row.userId !== expected.userId ||
    row.amountCreditCents !== expected.amountCreditCents ||
    row.bankAccountFingerprint !== expected.bankAccountFingerprint ||
    row.status !== expected.status ||
    row.riskScore !== expected.riskScore ||
    row.idempotencyKey !== expected.idempotencyKey
  ) {
    throw new WithdrawalRequestIdempotencyConflictError();
  }
}

export class WithdrawalService {
  private readonly ledger?: WithdrawalLedger;
  private readonly kyc?: WithdrawalKyc;

  constructor(
    private readonly db: DB,
    deps: { ledger?: WithdrawalLedger; kyc?: WithdrawalKyc } = {},
  ) {
    this.ledger = deps.ledger;
    this.kyc = deps.kyc;
  }

  private ledgerFor(db: DB): WithdrawalLedger {
    return this.ledger ?? new CreditLedgerService(db);
  }

  private kycFor(db: DB): WithdrawalKyc {
    return this.kyc ?? new KycService(db);
  }

  private async lockUserForWithdrawal(db: DB, userId: number): Promise<void> {
    const [row] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .for('update')
      .limit(1);
    if (!row) {
      throw new Error('user row not found for withdrawal lock');
    }
  }

  private async readByIdempotencyKey(
    db: DB,
    idempotencyKey: string,
  ): Promise<PartnerWithdrawalRequest | undefined> {
    const [row] = await db
      .select()
      .from(partnerWithdrawalRequests)
      .where(eq(partnerWithdrawalRequests.idempotencyKey, idempotencyKey))
      .limit(1);
    return row;
  }

  private async postHoldEntries(
    ledger: WithdrawalLedger,
    row: PartnerWithdrawalRequest,
  ): Promise<void> {
    await ledger.postEntry({
      userId: row.userId,
      entryType: 'withdrawal_request_hold',
      direction: 'debit',
      bucket: 'available',
      amountCreditCents: row.amountCreditCents,
      idempotencyKey: `withdrawal:hold:${row.idempotencyKey}`,
      metadata: {
        withdrawalRequestId: row.id,
        withdrawalRequestExternalId: row.externalId,
      },
    });
    await ledger.postEntry({
      userId: row.userId,
      entryType: 'withdrawal_request_hold',
      direction: 'credit',
      bucket: 'pending_withdrawal',
      amountCreditCents: row.amountCreditCents,
      idempotencyKey: `withdrawal:pending:${row.idempotencyKey}`,
      metadata: {
        withdrawalRequestId: row.id,
        withdrawalRequestExternalId: row.externalId,
      },
    });
  }

  private async requestWithdrawalInTransaction(
    db: DB,
    request: NormalizedWithdrawalRequest,
  ): Promise<PartnerWithdrawalRequest> {
    await this.lockUserForWithdrawal(db, request.userId);

    const ledger = this.ledgerFor(db);
    const existing = await this.readByIdempotencyKey(db, request.idempotencyKey);
    if (existing) {
      assertIdempotentRequestPayloadMatches(existing, request);
      await this.postHoldEntries(ledger, existing);
      return existing;
    }

    const kycStatus = await this.kycFor(db).getStatus(request.userId);
    if (!canWithdrawWithKycStatus(kycStatus)) {
      throw new WithdrawalGateError('kyc_required');
    }

    const summary = await ledger.summarizeUser(request.userId);
    const validation = validateWithdrawalRequest({
      amountCreditCents: request.amountCreditCents,
      availableCreditCents: summary.availableCreditCents,
    });
    if (!validation.ok) {
      throw new WithdrawalValidationError(validation.reason);
    }

    const externalId = newExternalId('payment');
    await db
      .insert(partnerWithdrawalRequests)
      .values({
        externalId,
        userId: request.userId,
        amountCreditCents: request.amountCreditCents,
        status: request.status,
        reviewDueAt: computeWithdrawalReviewDueAt({ now: request.now, highRisk: request.highRisk }),
        bankAccountFingerprint: request.bankAccountFingerprint,
        riskScore: request.riskScore,
        idempotencyKey: request.idempotencyKey,
        metadata: null,
      })
      .onDuplicateKeyUpdate({ set: { idempotencyKey: sql`idempotency_key` } });

    const row = await this.readByIdempotencyKey(db, request.idempotencyKey);
    if (!row) {
      throw new Error('partner withdrawal request vanished after insert');
    }
    assertIdempotentRequestPayloadMatches(row, request);
    await this.postHoldEntries(ledger, row);

    return row;
  }

  async requestWithdrawal(input: WithdrawalRequestInput): Promise<PartnerWithdrawalRequest> {
    const request = normalizeRequestInput(input);
    return this.db.transaction((tx) => this.requestWithdrawalInTransaction(tx as unknown as DB, request));
  }
}
