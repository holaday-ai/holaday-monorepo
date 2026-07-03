import {
  HOLA_CREDIT_CNY_CENTS,
  PARTNER_ACCUMULATION_DAYS,
  PARTNER_RECHARGE_MAX_MONTHLY_CNY_CENTS,
  PARTNER_RECHARGE_MAX_SINGLE_CNY_CENTS,
  PARTNER_RECHARGE_MIN_CNY_CENTS,
  PARTNER_RELEASE_MONTHS,
  newExternalId,
} from '@holaday/shared-types';
import { and, eq, gte, sql } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import {
  partnerLots,
  partnerRechargeOrders,
  type PartnerLot,
  type PartnerRechargeOrder,
} from '../db/schema/partner.js';
import { KycService, canRechargeWithKycStatus } from './kyc-service.js';
import { PartnerMembershipService } from './membership-service.js';
import { partnerConfig } from './partner-config.js';
import { calculateApiUnits, calculateLotCaps, selectRechargeTier } from './partner-rules.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * DAY_MS;
const REVIEW_OVERRIDE_NOTE_MAX_LENGTH = 1000;

export type RechargeAmountValidationResult =
  | { ok: true }
  | { ok: false; reason: 'invalid_amount' | 'not_whole_cny' | 'below_minimum' | 'above_single_maximum' };

export type RechargeOrderKind = 'membership' | 'recharge';
export type RechargeGateReason = 'membership_required' | 'kyc_required';

export interface RechargeServiceDeps {
  membership?: Pick<PartnerMembershipService, 'getActiveMembership'>;
  kyc?: Pick<KycService, 'getStatus'>;
}

export interface RechargeLotReviewOverride {
  reviewerUserId: number;
  approvedAt: Date;
  note?: string;
}

interface NormalizedRechargeLotReviewOverride {
  reviewerUserId: number;
  approvedAt: Date;
  note?: string;
}

interface NormalizedPendingOrder {
  userId: number;
  provider: string;
  amountCnyCents: number;
  orderKind: RechargeOrderKind;
  idempotencyKey: string;
  status: 'pending';
  now: Date;
}

interface ExpectedLotPayload {
  userId: number;
  rechargeOrderId: number;
  status: 'accumulating';
  riskStatus: 'normal' | 'review';
  principalCreditCents: number;
  tierMultiplierBps: number;
  apiUnits: number;
  bonusCapCreditCents: number;
  accumulationStartsAt: Date;
  accumulationEndsAt: Date;
  releaseStartsAt: Date;
  releaseEndsAt: Date;
  metadata: Record<string, unknown> | null;
}

export class RechargeGateError extends Error {
  constructor(readonly reason: RechargeGateReason) {
    super(`Partner recharge gate failed: ${reason}`);
    this.name = 'RechargeGateError';
    Object.setPrototypeOf(this, RechargeGateError.prototype);
  }
}

export class RechargeOrderIdempotencyConflictError extends Error {
  constructor() {
    super('Partner recharge order idempotency key was reused with a different payload');
    this.name = 'RechargeOrderIdempotencyConflictError';
    Object.setPrototypeOf(this, RechargeOrderIdempotencyConflictError.prototype);
  }
}

export class RechargeLotConflictError extends Error {
  constructor() {
    super('Partner recharge lot already exists for this recharge order with a different payload');
    this.name = 'RechargeLotConflictError';
    Object.setPrototypeOf(this, RechargeLotConflictError.prototype);
  }
}

export function rechargeRollingThirtyDayWindowStart(now: Date): Date {
  return new Date(normalizeDate(now, 'now').getTime() - THIRTY_DAYS_MS);
}

export function rechargeAnnualWindowStart(now: Date): Date {
  const normalized = normalizeDate(now, 'now');
  const start = new Date(normalized.getTime());
  start.setUTCFullYear(start.getUTCFullYear() - 1);
  return start;
}

export function assertAnnualRechargeCap(input: {
  annualRechargeTotalCnyCents: number;
  annualRechargeCapCnyCents?: number;
}): void {
  const annualRechargeTotalCnyCents = normalizeNonNegativeWholeCnyAmount(
    input.annualRechargeTotalCnyCents,
    'annualRechargeTotalCnyCents',
  );
  const annualRechargeCapCnyCents = normalizeNonNegativeWholeCnyAmount(
    input.annualRechargeCapCnyCents ?? partnerConfig().annualRechargeCapCnyCents,
    'annualRechargeCapCnyCents',
  );

  if (annualRechargeTotalCnyCents > annualRechargeCapCnyCents) {
    throw new RangeError('annual recharge cap exceeded');
  }
}

export async function computeCompletedRechargeTotalCnyCents(
  db: DB,
  input: { userId: number; windowStart: Date; now: Date },
): Promise<number> {
  const userId = normalizePositiveSafeInteger(input.userId, 'userId');
  const windowStart = normalizeDate(input.windowStart, 'windowStart');
  const now = normalizeDate(input.now, 'now');

  const rows = await db
    .select()
    .from(partnerRechargeOrders)
    .where(
      and(
        eq(partnerRechargeOrders.userId, userId),
        eq(partnerRechargeOrders.status, 'completed'),
        eq(partnerRechargeOrders.orderKind, 'recharge'),
        gte(partnerRechargeOrders.updatedAt, windowStart),
      ),
    );

  return rows
    .filter((row) => {
      if (row.userId !== userId || row.status !== 'completed' || row.orderKind !== 'recharge') {
        return false;
      }
      const effectiveAt = row.updatedAt ?? row.createdAt;
      return effectiveAt.getTime() >= windowStart.getTime() && effectiveAt.getTime() <= now.getTime();
    })
    .reduce((sum, row) => sum + row.amountCnyCents, 0);
}

export function validateRechargeAmount(amountCnyCents: number): RechargeAmountValidationResult {
  if (!Number.isSafeInteger(amountCnyCents) || amountCnyCents <= 0) {
    return { ok: false, reason: 'invalid_amount' };
  }

  if (amountCnyCents % HOLA_CREDIT_CNY_CENTS !== 0) {
    return { ok: false, reason: 'not_whole_cny' };
  }

  if (amountCnyCents < PARTNER_RECHARGE_MIN_CNY_CENTS) {
    return { ok: false, reason: 'below_minimum' };
  }

  if (amountCnyCents > PARTNER_RECHARGE_MAX_SINGLE_CNY_CENTS) {
    return { ok: false, reason: 'above_single_maximum' };
  }

  return { ok: true };
}

function normalizePositiveSafeInteger(value: number, fieldName: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${fieldName} must be a positive safe integer`);
  }
  return value;
}

function normalizeBoundedString(value: string, fieldName: string, maxLength: number): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
    throw new RangeError(`${fieldName} must be a non-empty string with length <= ${maxLength}`);
  }
  return value;
}

function normalizeDate(value: Date, fieldName: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new RangeError(`${fieldName} must be a valid Date`);
  }
  return new Date(value.getTime());
}

function normalizeOrderKind(value: string): RechargeOrderKind {
  if (value !== 'membership' && value !== 'recharge') {
    throw new RangeError('orderKind must be membership or recharge');
  }
  return value;
}

function normalizePositiveWholeCnyAmount(amountCnyCents: number, fieldName: string): number {
  if (!Number.isSafeInteger(amountCnyCents) || amountCnyCents <= 0) {
    throw new RangeError(`${fieldName} must be a positive safe integer`);
  }
  if (amountCnyCents % HOLA_CREDIT_CNY_CENTS !== 0) {
    throw new RangeError(`${fieldName} must be a whole CNY amount`);
  }
  return amountCnyCents;
}

function normalizeNonNegativeWholeCnyAmount(amountCnyCents: number, fieldName: string): number {
  if (!Number.isSafeInteger(amountCnyCents) || amountCnyCents < 0) {
    throw new RangeError(`${fieldName} must be a non-negative safe integer`);
  }
  if (amountCnyCents % HOLA_CREDIT_CNY_CENTS !== 0) {
    throw new RangeError(`${fieldName} must be a whole CNY amount`);
  }
  return amountCnyCents;
}

function normalizeRechargeAmountOrThrow(amountCnyCents: number): number {
  const validation = validateRechargeAmount(amountCnyCents);
  if (!validation.ok) {
    throw new RangeError(validation.reason);
  }
  return amountCnyCents;
}

function normalizeOptionalBoundedString(
  value: string | undefined,
  fieldName: string,
  maxLength: number,
): string | undefined {
  if (value === undefined) return undefined;
  return normalizeBoundedString(value, fieldName, maxLength).trim();
}

function normalizeReviewOverride(
  value: RechargeLotReviewOverride | undefined,
): NormalizedRechargeLotReviewOverride | undefined {
  if (value === undefined) return undefined;
  return {
    reviewerUserId: normalizePositiveSafeInteger(value.reviewerUserId, 'reviewOverride.reviewerUserId'),
    approvedAt: normalizeDate(value.approvedAt, 'reviewOverride.approvedAt'),
    note: normalizeOptionalBoundedString(value.note, 'reviewOverride.note', REVIEW_OVERRIDE_NOTE_MAX_LENGTH),
  };
}

function normalizeRollingThirtyDayAmount(
  rollingThirtyDayCnyCents: number,
  amountCnyCents: number,
  options: { allowAboveMonthlyMaximum?: boolean } = {},
): number {
  if (!Number.isSafeInteger(rollingThirtyDayCnyCents) || rollingThirtyDayCnyCents < 0) {
    throw new RangeError('rollingThirtyDayCnyCents must be a non-negative safe integer');
  }
  if (rollingThirtyDayCnyCents % HOLA_CREDIT_CNY_CENTS !== 0) {
    throw new RangeError('rollingThirtyDayCnyCents must be a whole CNY amount');
  }
  if (rollingThirtyDayCnyCents < amountCnyCents) {
    throw new RangeError('rollingThirtyDayCnyCents must include the current recharge amount');
  }
  if (
    rollingThirtyDayCnyCents > PARTNER_RECHARGE_MAX_MONTHLY_CNY_CENTS &&
    options.allowAboveMonthlyMaximum !== true
  ) {
    throw new RangeError('rollingThirtyDayCnyCents must not exceed the monthly maximum');
  }
  return rollingThirtyDayCnyCents;
}

function normalizePendingOrderInput(input: {
  userId: number;
  provider: string;
  amountCnyCents: number;
  orderKind: RechargeOrderKind;
  idempotencyKey: string;
  now?: Date;
}): NormalizedPendingOrder {
  const orderKind = normalizeOrderKind(input.orderKind);
  const amountCnyCents =
    orderKind === 'recharge'
      ? normalizeRechargeAmountOrThrow(input.amountCnyCents)
      : normalizePositiveWholeCnyAmount(input.amountCnyCents, 'amountCnyCents');

  return {
    userId: normalizePositiveSafeInteger(input.userId, 'userId'),
    provider: normalizeBoundedString(input.provider, 'provider', 24),
    amountCnyCents,
    orderKind,
    idempotencyKey: normalizeBoundedString(input.idempotencyKey, 'idempotencyKey', 128),
    status: 'pending',
    now: normalizeDate(input.now ?? new Date(), 'now'),
  };
}

function assertIdempotentOrderPayloadMatches(
  row: PartnerRechargeOrder,
  expected: NormalizedPendingOrder,
): void {
  if (
    row.userId !== expected.userId ||
    row.provider !== expected.provider ||
    row.amountCnyCents !== expected.amountCnyCents ||
    row.orderKind !== expected.orderKind ||
    row.status !== expected.status
  ) {
    throw new RechargeOrderIdempotencyConflictError();
  }
}

function addUtcDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

function addUtcMonths(date: Date, months: number): Date {
  const copy = new Date(date.getTime());
  copy.setUTCMonth(copy.getUTCMonth() + months);
  return copy;
}

function buildExpectedLotPayload(input: {
  userId: number;
  rechargeOrderId: number;
  amountCnyCents: number;
  rollingThirtyDayCnyCents: number;
  now: Date;
  reviewOverride?: RechargeLotReviewOverride;
}): ExpectedLotPayload {
  const userId = normalizePositiveSafeInteger(input.userId, 'userId');
  const rechargeOrderId = normalizePositiveSafeInteger(input.rechargeOrderId, 'rechargeOrderId');
  const amountCnyCents = normalizeRechargeAmountOrThrow(input.amountCnyCents);
  const reviewOverride = normalizeReviewOverride(input.reviewOverride);
  const rollingThirtyDayCnyCents = normalizeRollingThirtyDayAmount(
    input.rollingThirtyDayCnyCents,
    amountCnyCents,
    { allowAboveMonthlyMaximum: reviewOverride !== undefined },
  );
  const accumulationStartsAt = normalizeDate(input.now, 'now');
  const accumulationEndsAt = addUtcDays(accumulationStartsAt, PARTNER_ACCUMULATION_DAYS);
  const releaseStartsAt = addUtcDays(accumulationEndsAt, 1);
  const releaseEndsAt = addUtcMonths(releaseStartsAt, PARTNER_RELEASE_MONTHS);
  const tier = selectRechargeTier(rollingThirtyDayCnyCents);
  const caps = calculateLotCaps(amountCnyCents);

  return {
    userId,
    rechargeOrderId,
    status: 'accumulating',
    riskStatus: reviewOverride ? 'review' : 'normal',
    principalCreditCents: caps.principalCreditCents,
    tierMultiplierBps: tier.multiplierBps,
    apiUnits: calculateApiUnits(amountCnyCents, tier.multiplierBps),
    bonusCapCreditCents: caps.bonusCapCreditCents,
    accumulationStartsAt,
    accumulationEndsAt,
    releaseStartsAt,
    releaseEndsAt,
    metadata: reviewOverride
      ? {
          reviewOverride: {
            reviewerUserId: reviewOverride.reviewerUserId,
            approvedAt: reviewOverride.approvedAt.toISOString(),
            ...(reviewOverride.note ? { note: reviewOverride.note } : {}),
          },
          rollingThirtyDayCnyCents,
          monthlyCapCnyCents: PARTNER_RECHARGE_MAX_MONTHLY_CNY_CENTS,
        }
      : null,
  };
}

function assertExistingLotPayloadMatches(row: PartnerLot, expected: ExpectedLotPayload): void {
  if (
    row.userId !== expected.userId ||
    row.rechargeOrderId !== expected.rechargeOrderId ||
    row.principalCreditCents !== expected.principalCreditCents ||
    row.tierMultiplierBps !== expected.tierMultiplierBps ||
    row.apiUnits !== expected.apiUnits ||
    row.bonusCapCreditCents !== expected.bonusCapCreditCents ||
    row.riskStatus !== expected.riskStatus ||
    row.status !== expected.status
  ) {
    throw new RechargeLotConflictError();
  }
}

export class RechargeService {
  private readonly membership: Pick<PartnerMembershipService, 'getActiveMembership'>;
  private readonly kyc: Pick<KycService, 'getStatus'>;

  constructor(private readonly db: DB, deps: RechargeServiceDeps = {}) {
    this.membership = deps.membership ?? new PartnerMembershipService(db);
    this.kyc = deps.kyc ?? new KycService(db);
  }

  async createPendingOrder(input: {
    userId: number;
    provider: string;
    amountCnyCents: number;
    orderKind: RechargeOrderKind;
    idempotencyKey: string;
    now?: Date;
  }): Promise<PartnerRechargeOrder> {
    const order = normalizePendingOrderInput(input);

    if (order.orderKind === 'recharge') {
      const membership = await this.membership.getActiveMembership(order.userId, order.now);
      if (!membership) {
        throw new RechargeGateError('membership_required');
      }

      const kycStatus = await this.kyc.getStatus(order.userId);
      if (!canRechargeWithKycStatus(kycStatus)) {
        throw new RechargeGateError('kyc_required');
      }
    }

    const [existing] = await this.db
      .select()
      .from(partnerRechargeOrders)
      .where(eq(partnerRechargeOrders.idempotencyKey, order.idempotencyKey))
      .limit(1);
    if (existing) {
      assertIdempotentOrderPayloadMatches(existing, order);
      return existing;
    }

    if (order.orderKind === 'recharge') {
      const annualRechargeTotalCnyCents =
        order.amountCnyCents +
        (await computeCompletedRechargeTotalCnyCents(this.db, {
          userId: order.userId,
          windowStart: rechargeAnnualWindowStart(order.now),
          now: order.now,
        }));
      assertAnnualRechargeCap({ annualRechargeTotalCnyCents });
    }

    await this.db
      .insert(partnerRechargeOrders)
      .values({
        externalId: newExternalId('payment'),
        userId: order.userId,
        provider: order.provider,
        providerOrderId: null,
        providerCaptureId: null,
        amountCnyCents: order.amountCnyCents,
        status: order.status,
        orderKind: order.orderKind,
        idempotencyKey: order.idempotencyKey,
        metadata: null,
      })
      .onDuplicateKeyUpdate({ set: { idempotencyKey: sql`idempotency_key` } });

    const [row] = await this.db
      .select()
      .from(partnerRechargeOrders)
      .where(eq(partnerRechargeOrders.idempotencyKey, order.idempotencyKey))
      .limit(1);

    if (!row) {
      throw new Error('partner recharge order vanished after idempotent insert');
    }

    assertIdempotentOrderPayloadMatches(row, order);
    return row;
  }

  async createLotForCapturedRecharge(input: {
    userId: number;
    rechargeOrderId: number;
    amountCnyCents: number;
    rollingThirtyDayCnyCents: number;
    reviewOverride?: RechargeLotReviewOverride;
    now?: Date;
  }): Promise<PartnerLot> {
    const expected = buildExpectedLotPayload({
      ...input,
      now: input.now ?? new Date(),
    });

    await this.db
      .insert(partnerLots)
      .values({
        externalId: newExternalId('payment'),
        userId: expected.userId,
        rechargeOrderId: expected.rechargeOrderId,
        status: expected.status,
        riskStatus: expected.riskStatus,
        principalCreditCents: expected.principalCreditCents,
        tierMultiplierBps: expected.tierMultiplierBps,
        apiUnits: expected.apiUnits,
        bonusCapCreditCents: expected.bonusCapCreditCents,
        lockedBonusCreditCents: 0,
        releasedPrincipalCreditCents: 0,
        releasedBonusCreditCents: 0,
        carryForwardCreditCents: 0,
        accumulationStartsAt: expected.accumulationStartsAt,
        accumulationEndsAt: expected.accumulationEndsAt,
        releaseStartsAt: expected.releaseStartsAt,
        releaseEndsAt: expected.releaseEndsAt,
        metadata: expected.metadata,
      })
      .onDuplicateKeyUpdate({ set: { rechargeOrderId: sql`recharge_order_id` } });

    const [row] = await this.db
      .select()
      .from(partnerLots)
      .where(eq(partnerLots.rechargeOrderId, expected.rechargeOrderId))
      .limit(1);

    if (!row) {
      throw new Error('partner recharge lot vanished after idempotent insert');
    }

    assertExistingLotPayloadMatches(row, expected);
    return row;
  }
}
