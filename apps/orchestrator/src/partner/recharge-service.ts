import {
  HOLA_CREDIT_CNY_CENTS,
  PARTNER_ACCUMULATION_DAYS,
  PARTNER_RECHARGE_MAX_MONTHLY_CNY_CENTS,
  PARTNER_RECHARGE_MAX_SINGLE_CNY_CENTS,
  PARTNER_RECHARGE_MIN_CNY_CENTS,
  PARTNER_RELEASE_MONTHS,
  newExternalId,
} from '@holaday/shared-types';
import { eq, sql } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import {
  partnerLots,
  partnerRechargeOrders,
  type PartnerLot,
  type PartnerRechargeOrder,
} from '../db/schema/partner.js';
import { KycService, canRechargeWithKycStatus } from './kyc-service.js';
import { PartnerMembershipService } from './membership-service.js';
import { calculateApiUnits, calculateLotCaps, selectRechargeTier } from './partner-rules.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export type RechargeAmountValidationResult =
  | { ok: true }
  | { ok: false; reason: 'invalid_amount' | 'not_whole_cny' | 'below_minimum' | 'above_single_maximum' };

export type RechargeOrderKind = 'membership' | 'recharge';
export type RechargeGateReason = 'membership_required' | 'kyc_required';

export interface RechargeServiceDeps {
  membership?: Pick<PartnerMembershipService, 'getActiveMembership'>;
  kyc?: Pick<KycService, 'getStatus'>;
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
  principalCreditCents: number;
  tierMultiplierBps: number;
  apiUnits: number;
  bonusCapCreditCents: number;
  accumulationStartsAt: Date;
  accumulationEndsAt: Date;
  releaseStartsAt: Date;
  releaseEndsAt: Date;
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

function normalizeRechargeAmountOrThrow(amountCnyCents: number): number {
  const validation = validateRechargeAmount(amountCnyCents);
  if (!validation.ok) {
    throw new RangeError(validation.reason);
  }
  return amountCnyCents;
}

function normalizeRollingThirtyDayAmount(rollingThirtyDayCnyCents: number, amountCnyCents: number): number {
  if (!Number.isSafeInteger(rollingThirtyDayCnyCents) || rollingThirtyDayCnyCents < 0) {
    throw new RangeError('rollingThirtyDayCnyCents must be a non-negative safe integer');
  }
  if (rollingThirtyDayCnyCents % HOLA_CREDIT_CNY_CENTS !== 0) {
    throw new RangeError('rollingThirtyDayCnyCents must be a whole CNY amount');
  }
  if (rollingThirtyDayCnyCents < amountCnyCents) {
    throw new RangeError('rollingThirtyDayCnyCents must include the current recharge amount');
  }
  if (rollingThirtyDayCnyCents > PARTNER_RECHARGE_MAX_MONTHLY_CNY_CENTS) {
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
}): ExpectedLotPayload {
  const userId = normalizePositiveSafeInteger(input.userId, 'userId');
  const rechargeOrderId = normalizePositiveSafeInteger(input.rechargeOrderId, 'rechargeOrderId');
  const amountCnyCents = normalizeRechargeAmountOrThrow(input.amountCnyCents);
  const rollingThirtyDayCnyCents = normalizeRollingThirtyDayAmount(
    input.rollingThirtyDayCnyCents,
    amountCnyCents,
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
    principalCreditCents: caps.principalCreditCents,
    tierMultiplierBps: tier.multiplierBps,
    apiUnits: calculateApiUnits(amountCnyCents, tier.multiplierBps),
    bonusCapCreditCents: caps.bonusCapCreditCents,
    accumulationStartsAt,
    accumulationEndsAt,
    releaseStartsAt,
    releaseEndsAt,
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
        riskStatus: 'normal',
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
        metadata: null,
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
