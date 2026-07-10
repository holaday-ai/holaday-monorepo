import { newExternalId } from '@holaday/shared-types';
import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { readAffectedRows } from '../db/mysql-result.js';
import { partnerWithdrawalRequests, type PartnerKycProfile, type PartnerWithdrawalRequest } from '../db/schema/partner.js';
import { users } from '../db/schema/users.js';
import { CreditLedgerService } from './credit-ledger-service.js';
import { KycService, canWithdrawWithKycStatus, normalizeKycStatus } from './kyc-service.js';
import { PartnerMembershipService } from './membership-service.js';
import { partnerConfig } from './partner-config.js';

export const WITHDRAWAL_MIN_CREDIT_CENTS = 500_00;

type WithdrawalValidationReason =
  | 'below_minimum'
  | 'insufficient_withdrawable_credit'
  | 'daily_platform_cap_exceeded'
  | 'monthly_user_cap_exceeded';

export type WithdrawalValidationResult =
  | { ok: true }
  | { ok: false; reason: WithdrawalValidationReason };

export class WithdrawalValidationError extends Error {
  constructor(readonly reason: WithdrawalValidationReason) {
    super(`Withdrawal request rejected: ${reason}`);
    this.name = 'WithdrawalValidationError';
    Object.setPrototypeOf(this, WithdrawalValidationError.prototype);
  }
}

type WithdrawalGateReason =
  | 'membership_required'
  | 'kyc_required'
  | 'bank_account_required'
  | 'bank_account_mismatch'
  | 'bank_card_cooling_down'
  | 'risk_frozen';

export class WithdrawalGateError extends Error {
  constructor(readonly reason: WithdrawalGateReason) {
    super(
      reason === 'membership_required'
        ? 'Withdrawal requires an active partner membership'
        : reason === 'kyc_required'
          ? 'Withdrawal requires passed KYC status'
          : reason === 'bank_account_required'
            ? 'Withdrawal requires a verified bank account'
            : reason === 'bank_account_mismatch'
              ? 'Withdrawal bank account must match the verified KYC bank card'
              : reason === 'bank_card_cooling_down'
                ? 'Withdrawal bank card change is cooling down'
                : 'Withdrawal is frozen by risk control',
    );
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

export class WithdrawalTransitionError extends Error {
  constructor(
    readonly reason:
      | 'not_found'
      | 'not_reviewable'
      | 'not_approved'
      | 'already_paid'
      | 'already_rejected'
      | 'already_returned'
      | 'payout_conflict'
      | 'update_conflict',
  ) {
    super(`Withdrawal transition rejected: ${reason}`);
    this.name = 'WithdrawalTransitionError';
    Object.setPrototypeOf(this, WithdrawalTransitionError.prototype);
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
  return value.trim();
}

function assertValidDate(value: Date, fieldName: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new RangeError(`${fieldName} must be a valid Date`);
  }
  return new Date(value.getTime());
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
  withdrawableCreditCents: number;
  minCreditCents?: number;
}): WithdrawalValidationResult {
  const amountCreditCents = assertNonNegativeSafeInteger(input.amountCreditCents, 'amountCreditCents');
  const withdrawableCreditCents = assertNonNegativeSafeInteger(
    input.withdrawableCreditCents,
    'withdrawableCreditCents',
  );
  const minCreditCents = assertNonNegativeSafeInteger(
    input.minCreditCents ?? WITHDRAWAL_MIN_CREDIT_CENTS,
    'minCreditCents',
  );

  if (amountCreditCents < minCreditCents) {
    return { ok: false, reason: 'below_minimum' };
  }
  if (amountCreditCents > withdrawableCreditCents) {
    return { ok: false, reason: 'insufficient_withdrawable_credit' };
  }
  return { ok: true };
}

export function validateWithdrawalLimits(input: {
  amountCreditCents: number;
  dailyPlatformWithdrawalCreditCents: number;
  dailyPlatformCapCreditCents: number;
  monthlyUserWithdrawalCreditCents: number;
  monthlyUserCapCreditCents: number;
}): WithdrawalValidationResult {
  const amountCreditCents = assertNonNegativeSafeInteger(input.amountCreditCents, 'amountCreditCents');
  const dailyPlatformWithdrawalCreditCents = assertNonNegativeSafeInteger(
    input.dailyPlatformWithdrawalCreditCents,
    'dailyPlatformWithdrawalCreditCents',
  );
  const dailyPlatformCapCreditCents = assertNonNegativeSafeInteger(
    input.dailyPlatformCapCreditCents,
    'dailyPlatformCapCreditCents',
  );
  const monthlyUserWithdrawalCreditCents = assertNonNegativeSafeInteger(
    input.monthlyUserWithdrawalCreditCents,
    'monthlyUserWithdrawalCreditCents',
  );
  const monthlyUserCapCreditCents = assertNonNegativeSafeInteger(
    input.monthlyUserCapCreditCents,
    'monthlyUserCapCreditCents',
  );

  if (
    dailyPlatformCapCreditCents > 0 &&
    dailyPlatformWithdrawalCreditCents + amountCreditCents > dailyPlatformCapCreditCents
  ) {
    return { ok: false, reason: 'daily_platform_cap_exceeded' };
  }
  if (
    monthlyUserCapCreditCents > 0 &&
    monthlyUserWithdrawalCreditCents + amountCreditCents > monthlyUserCapCreditCents
  ) {
    return { ok: false, reason: 'monthly_user_cap_exceeded' };
  }
  return { ok: true };
}

export function computeWithdrawalReviewDueAt(input: { now: Date; highRisk: boolean }): Date {
  const now = assertValidDate(input.now, 'now');
  const highRisk = assertBoolean(input.highRisk, 'highRisk');
  return addUtcDays(now, highRisk ? 15 : 7);
}

function utcDayBounds(value: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  return { start, end: addUtcDays(start, 1) };
}

function utcMonthBounds(value: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
  const end = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 1));
  return { start, end };
}

function aggregateCreditCents(value: unknown): number {
  return assertNonNegativeSafeInteger(Number(value ?? 0), 'totalCreditCents');
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
type WithdrawalKyc = Pick<KycService, 'getProfile'>;
type WithdrawalMembership = Pick<PartnerMembershipService, 'getActiveMembership'>;

const WITHDRAWAL_CAP_STATUSES = ['requested', 'reviewing', 'approved', 'paid'] as const;

type NormalizedWithdrawalRequest = Required<WithdrawalRequestInput> & {
  status: WithdrawalStatus;
};

type WithdrawalAdminInputBase = {
  withdrawalExternalId: string;
  reviewerUserId: number;
  now?: Date;
};

type NormalizedApproveWithdrawalInput = Required<WithdrawalAdminInputBase> & {
  note: string | null;
};

type NormalizedRejectWithdrawalInput = Required<WithdrawalAdminInputBase> & {
  reason: string;
};

type NormalizedMarkPaidWithdrawalInput = Required<WithdrawalAdminInputBase> & {
  providerPayoutId: string;
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

function normalizeApproveInput(input: WithdrawalAdminInputBase & { note?: string }): NormalizedApproveWithdrawalInput {
  return {
    withdrawalExternalId: assertBoundedNonEmptyString(
      input.withdrawalExternalId,
      'withdrawalExternalId',
      32,
    ),
    reviewerUserId: assertPositiveSafeInteger(input.reviewerUserId, 'reviewerUserId'),
    note: input.note == null ? null : assertBoundedNonEmptyString(input.note, 'note', 1000),
    now: assertValidDate(input.now ?? new Date(), 'now'),
  };
}

function normalizeRejectInput(input: WithdrawalAdminInputBase & { reason: string }): NormalizedRejectWithdrawalInput {
  return {
    withdrawalExternalId: assertBoundedNonEmptyString(
      input.withdrawalExternalId,
      'withdrawalExternalId',
      32,
    ),
    reviewerUserId: assertPositiveSafeInteger(input.reviewerUserId, 'reviewerUserId'),
    reason: assertBoundedNonEmptyString(input.reason, 'reason', 1000),
    now: assertValidDate(input.now ?? new Date(), 'now'),
  };
}

function normalizeMarkPaidInput(
  input: WithdrawalAdminInputBase & { providerPayoutId: string },
): NormalizedMarkPaidWithdrawalInput {
  return {
    withdrawalExternalId: assertBoundedNonEmptyString(
      input.withdrawalExternalId,
      'withdrawalExternalId',
      32,
    ),
    reviewerUserId: assertPositiveSafeInteger(input.reviewerUserId, 'reviewerUserId'),
    providerPayoutId: assertBoundedNonEmptyString(input.providerPayoutId, 'providerPayoutId', 128),
    now: assertValidDate(input.now ?? new Date(), 'now'),
  };
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function metadataText(value: unknown, key: string): string | undefined {
  const raw = metadataRecord(value)[key];
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : undefined;
}

function verifiedBankCardHash(profile: PartnerKycProfile): string | null {
  const bankCardHash = profile.bankCardHash;
  return typeof bankCardHash === 'string' && bankCardHash.trim().length > 0 ? bankCardHash.trim() : null;
}

function metadataDate(value: unknown, key: string): Date | null {
  const raw = metadataText(value, key);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isWithinBankCardCooldown(changedAt: Date, now: Date, cooldownDays: number): boolean {
  if (cooldownDays <= 0) return false;
  return now.getTime() - changedAt.getTime() < cooldownDays * 24 * 60 * 60 * 1000;
}

function transitionErrorForTerminalStatus(
  status: string,
  fallback: WithdrawalTransitionError['reason'],
): WithdrawalTransitionError {
  if (status === 'paid') return new WithdrawalTransitionError('already_paid');
  if (status === 'rejected') return new WithdrawalTransitionError('already_rejected');
  if (status === 'returned') return new WithdrawalTransitionError('already_returned');
  return new WithdrawalTransitionError(fallback);
}

function assertIdempotentRequestPayloadMatches(
  row: PartnerWithdrawalRequest,
  expected: NormalizedWithdrawalRequest,
): void {
  // Status, riskScore, and reviewDueAt are server-derived at creation time.
  // Replays preserve the stored review decision even if current KYC/risk context changed.
  if (
    row.userId !== expected.userId ||
    row.amountCreditCents !== expected.amountCreditCents ||
    row.bankAccountFingerprint !== expected.bankAccountFingerprint ||
    row.idempotencyKey !== expected.idempotencyKey
  ) {
    throw new WithdrawalRequestIdempotencyConflictError();
  }
}

export class WithdrawalService {
  private readonly ledger?: WithdrawalLedger;
  private readonly kyc?: WithdrawalKyc;
  private readonly membership?: WithdrawalMembership;

  constructor(
    private readonly db: DB,
    deps: { ledger?: WithdrawalLedger; kyc?: WithdrawalKyc; membership?: WithdrawalMembership } = {},
  ) {
    this.ledger = deps.ledger;
    this.kyc = deps.kyc;
    this.membership = deps.membership;
  }

  private ledgerFor(db: DB): WithdrawalLedger {
    return this.ledger ?? new CreditLedgerService(db);
  }

  private kycFor(db: DB): WithdrawalKyc {
    return this.kyc ?? new KycService(db);
  }

  private membershipFor(db: DB): WithdrawalMembership {
    return this.membership ?? new PartnerMembershipService(db);
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

  private async readByExternalId(db: DB, externalId: string): Promise<PartnerWithdrawalRequest | undefined> {
    const [row] = await db
      .select()
      .from(partnerWithdrawalRequests)
      .where(eq(partnerWithdrawalRequests.externalId, externalId))
      .limit(1);
    return row;
  }

  private async readDailyPlatformWithdrawalCreditCents(db: DB, now: Date): Promise<number> {
    const { start, end } = utcDayBounds(now);
    const [row] = await db
      .select({
        totalCreditCents: sql<number>`COALESCE(SUM(${partnerWithdrawalRequests.amountCreditCents}), 0)`,
      })
      .from(partnerWithdrawalRequests)
      .where(
        and(
          inArray(partnerWithdrawalRequests.status, [...WITHDRAWAL_CAP_STATUSES]),
          gte(partnerWithdrawalRequests.createdAt, start),
          lt(partnerWithdrawalRequests.createdAt, end),
        ),
      )
      .limit(1);
    return aggregateCreditCents(row?.totalCreditCents);
  }

  private async readMonthlyUserWithdrawalCreditCents(db: DB, userId: number, now: Date): Promise<number> {
    const { start, end } = utcMonthBounds(now);
    const [row] = await db
      .select({
        totalCreditCents: sql<number>`COALESCE(SUM(${partnerWithdrawalRequests.amountCreditCents}), 0)`,
      })
      .from(partnerWithdrawalRequests)
      .where(
        and(
          eq(partnerWithdrawalRequests.userId, userId),
          inArray(partnerWithdrawalRequests.status, [...WITHDRAWAL_CAP_STATUSES]),
          gte(partnerWithdrawalRequests.createdAt, start),
          lt(partnerWithdrawalRequests.createdAt, end),
        ),
      )
      .limit(1);
    return aggregateCreditCents(row?.totalCreditCents);
  }

  private async assertAccountNotFrozen(ledger: WithdrawalLedger, userId: number): Promise<void> {
    const summary = await ledger.summarizeUser(userId);
    if (summary.frozenCreditCents > 0) {
      throw new WithdrawalGateError('risk_frozen');
    }
  }

  private async postHoldEntries(
    ledger: WithdrawalLedger,
    row: PartnerWithdrawalRequest,
  ): Promise<void> {
    await ledger.postEntry({
      userId: row.userId,
      entryType: 'withdrawal_request_hold',
      direction: 'debit',
      bucket: 'withdrawable',
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

  private async postRejectReleaseEntries(
    ledger: WithdrawalLedger,
    row: PartnerWithdrawalRequest,
  ): Promise<void> {
    await ledger.postEntry({
      userId: row.userId,
      entryType: 'withdrawal_rejected_release',
      direction: 'credit',
      bucket: 'withdrawable',
      amountCreditCents: row.amountCreditCents,
      idempotencyKey: `withdrawal:reject:withdrawable:${row.idempotencyKey}`,
      metadata: {
        withdrawalRequestId: row.id,
        withdrawalRequestExternalId: row.externalId,
      },
    });
    await ledger.postEntry({
      userId: row.userId,
      entryType: 'withdrawal_rejected_release',
      direction: 'debit',
      bucket: 'pending_withdrawal',
      amountCreditCents: row.amountCreditCents,
      idempotencyKey: `withdrawal:reject:pending:${row.idempotencyKey}`,
      metadata: {
        withdrawalRequestId: row.id,
        withdrawalRequestExternalId: row.externalId,
      },
    });
  }

  private async postPaidSettlementEntry(
    ledger: WithdrawalLedger,
    row: PartnerWithdrawalRequest,
  ): Promise<void> {
    await ledger.postEntry({
      userId: row.userId,
      entryType: 'withdrawal_paid_settlement',
      direction: 'debit',
      bucket: 'pending_withdrawal',
      amountCreditCents: row.amountCreditCents,
      idempotencyKey: `withdrawal:paid:${row.idempotencyKey}`,
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

    const membership = await this.membershipFor(db).getActiveMembership(request.userId, request.now);
    if (!membership) {
      throw new WithdrawalGateError('membership_required');
    }

    const kycProfile = await this.kycFor(db).getProfile(request.userId);
    if (!kycProfile || !canWithdrawWithKycStatus(normalizeKycStatus(kycProfile.status))) {
      throw new WithdrawalGateError('kyc_required');
    }

    const config = partnerConfig();
    const bankCardHash = verifiedBankCardHash(kycProfile);
    if (!bankCardHash) {
      throw new WithdrawalGateError('bank_account_required');
    }
    if (bankCardHash !== request.bankAccountFingerprint) {
      throw new WithdrawalGateError('bank_account_mismatch');
    }
    const bankCardHashUpdatedAt = metadataDate(kycProfile.metadata, 'bankCardHashUpdatedAt');
    if (
      bankCardHashUpdatedAt &&
      isWithinBankCardCooldown(bankCardHashUpdatedAt, request.now, config.withdrawalBankCardCooldownDays)
    ) {
      throw new WithdrawalGateError('bank_card_cooling_down');
    }

    const summary = await ledger.summarizeUser(request.userId);
    if (summary.frozenCreditCents > 0) {
      throw new WithdrawalGateError('risk_frozen');
    }

    const validation = validateWithdrawalRequest({
      amountCreditCents: request.amountCreditCents,
      withdrawableCreditCents: summary.withdrawableCreditCents,
      minCreditCents: config.withdrawalMinCreditCents,
    });
    if (!validation.ok) {
      throw new WithdrawalValidationError(validation.reason);
    }

    const limitValidation = validateWithdrawalLimits({
      amountCreditCents: request.amountCreditCents,
      dailyPlatformWithdrawalCreditCents:
        config.withdrawalDailyPlatformCapCreditCents > 0
          ? await this.readDailyPlatformWithdrawalCreditCents(db, request.now)
          : 0,
      dailyPlatformCapCreditCents: config.withdrawalDailyPlatformCapCreditCents,
      monthlyUserWithdrawalCreditCents:
        config.withdrawalMonthlyUserCapCreditCents > 0
          ? await this.readMonthlyUserWithdrawalCreditCents(db, request.userId, request.now)
          : 0,
      monthlyUserCapCreditCents: config.withdrawalMonthlyUserCapCreditCents,
    });
    if (!limitValidation.ok) {
      throw new WithdrawalValidationError(limitValidation.reason);
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

  async approveWithdrawal(input: WithdrawalAdminInputBase & { note?: string }): Promise<PartnerWithdrawalRequest> {
    const request = normalizeApproveInput(input);
    return this.db.transaction(async (tx) => {
      const db = tx as unknown as DB;
      const row = await this.readByExternalId(db, request.withdrawalExternalId);
      if (!row) throw new WithdrawalTransitionError('not_found');
      await this.lockUserForWithdrawal(db, row.userId);
      const ledger = this.ledgerFor(db);

      if (row.status === 'approved') return row;
      if (row.status !== 'requested' && row.status !== 'reviewing') {
        throw transitionErrorForTerminalStatus(row.status, 'not_reviewable');
      }
      await this.assertAccountNotFrozen(ledger, row.userId);

      const metadata = {
        ...metadataRecord(row.metadata),
        approvedByUserId: request.reviewerUserId,
        approvedAt: request.now.toISOString(),
        ...(request.note ? { approvalNote: request.note } : {}),
      };
      const result = await db
        .update(partnerWithdrawalRequests)
        .set({
          status: 'approved',
          metadata,
          updatedAt: request.now,
        })
        .where(eq(partnerWithdrawalRequests.externalId, row.externalId));
      if (readAffectedRows(result) !== 1) {
        throw new WithdrawalTransitionError('update_conflict');
      }

      const updated = await this.readByExternalId(db, row.externalId);
      if (!updated) throw new WithdrawalTransitionError('not_found');
      return updated;
    });
  }

  async rejectWithdrawal(input: WithdrawalAdminInputBase & { reason: string }): Promise<PartnerWithdrawalRequest> {
    const request = normalizeRejectInput(input);
    return this.db.transaction(async (tx) => {
      const db = tx as unknown as DB;
      const row = await this.readByExternalId(db, request.withdrawalExternalId);
      if (!row) throw new WithdrawalTransitionError('not_found');
      await this.lockUserForWithdrawal(db, row.userId);
      const ledger = this.ledgerFor(db);

      if (row.status === 'rejected') {
        await this.postRejectReleaseEntries(ledger, row);
        return row;
      }
      if (row.status !== 'requested' && row.status !== 'reviewing' && row.status !== 'approved') {
        throw transitionErrorForTerminalStatus(row.status, 'not_reviewable');
      }

      const metadata = {
        ...metadataRecord(row.metadata),
        rejectedByUserId: request.reviewerUserId,
        rejectedAt: request.now.toISOString(),
      };
      const result = await db
        .update(partnerWithdrawalRequests)
        .set({
          status: 'rejected',
          rejectionReason: request.reason,
          metadata,
          updatedAt: request.now,
        })
        .where(eq(partnerWithdrawalRequests.externalId, row.externalId));
      if (readAffectedRows(result) !== 1) {
        throw new WithdrawalTransitionError('update_conflict');
      }

      const updated = await this.readByExternalId(db, row.externalId);
      if (!updated) throw new WithdrawalTransitionError('not_found');
      await this.postRejectReleaseEntries(ledger, updated);
      return updated;
    });
  }

  async markWithdrawalPaid(
    input: WithdrawalAdminInputBase & { providerPayoutId: string },
  ): Promise<PartnerWithdrawalRequest> {
    const request = normalizeMarkPaidInput(input);
    return this.db.transaction(async (tx) => {
      const db = tx as unknown as DB;
      const row = await this.readByExternalId(db, request.withdrawalExternalId);
      if (!row) throw new WithdrawalTransitionError('not_found');
      await this.lockUserForWithdrawal(db, row.userId);
      const ledger = this.ledgerFor(db);

      if (row.status === 'paid') {
        const existingProviderPayoutId = metadataText(row.metadata, 'providerPayoutId');
        if (existingProviderPayoutId && existingProviderPayoutId !== request.providerPayoutId) {
          throw new WithdrawalTransitionError('payout_conflict');
        }
        await this.postPaidSettlementEntry(ledger, row);
        return row;
      }
      if (row.status !== 'approved') {
        throw transitionErrorForTerminalStatus(row.status, 'not_approved');
      }
      await this.assertAccountNotFrozen(ledger, row.userId);

      const metadata = {
        ...metadataRecord(row.metadata),
        paidByUserId: request.reviewerUserId,
        providerPayoutId: request.providerPayoutId,
        paidAt: request.now.toISOString(),
      };
      const result = await db
        .update(partnerWithdrawalRequests)
        .set({
          status: 'paid',
          metadata,
          updatedAt: request.now,
        })
        .where(eq(partnerWithdrawalRequests.externalId, row.externalId));
      if (readAffectedRows(result) !== 1) {
        throw new WithdrawalTransitionError('update_conflict');
      }

      const updated = await this.readByExternalId(db, row.externalId);
      if (!updated) throw new WithdrawalTransitionError('not_found');
      await this.postPaidSettlementEntry(ledger, updated);
      return updated;
    });
  }
}
