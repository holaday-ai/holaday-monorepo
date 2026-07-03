import { HOLA_CREDIT_CNY_CENTS } from '@holaday/shared-types';
import { and, eq } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { readAffectedRows } from '../db/mysql-result.js';
import {
  partnerRechargeOrders,
  type PartnerRechargeOrder,
} from '../db/schema/partner.js';
import { users } from '../db/schema/users.js';
import { PartnerMembershipService } from './membership-service.js';
import { partnerConfig } from './partner-config.js';
import {
  RechargeLotConflictError,
  RechargeService,
  assertAnnualRechargeCap,
  computeCompletedRechargeTotalCnyCents,
  rechargeAnnualWindowStart,
  rechargeRollingThirtyDayWindowStart,
} from './recharge-service.js';

const ORDER_EXTERNAL_ID_MAX_LENGTH = 32;
const PROVIDER_MAX_LENGTH = 24;
const PROVIDER_CAPTURE_ID_MAX_LENGTH = 128;
const REVIEW_APPROVAL_NOTE_MAX_LENGTH = 1000;

type PartnerPaymentOrderKind = 'membership' | 'recharge';

type MembershipActivator = Pick<PartnerMembershipService, 'activate'>;
type RechargeLotCreator = Pick<RechargeService, 'createLotForCapturedRecharge'>;

export interface PartnerPaymentConfirmServiceDeps {
  membershipService?: (db: DB) => MembershipActivator;
  rechargeService?: (db: DB) => RechargeLotCreator;
}

export interface PartnerPaymentConfirmInput {
  orderExternalId: string;
  provider: string;
  providerCaptureId: string;
  amountCnyCents: number;
  now?: Date;
}

interface NormalizedPartnerPaymentConfirmInput {
  orderExternalId: string;
  provider: string;
  providerCaptureId: string;
  amountCnyCents: number;
  now: Date;
}

export interface PartnerPaymentReviewApprovalInput {
  orderExternalId: string;
  reviewerUserId: number;
  note?: string;
  now?: Date;
}

interface NormalizedPartnerPaymentReviewApprovalInput {
  orderExternalId: string;
  reviewerUserId: number;
  note?: string;
  now: Date;
}

export type PartnerPaymentConfirmResult =
  | {
      ok: true;
      status: 'unknown_order';
      orderExternalId: string;
      deduped: true;
    }
  | {
      ok: true;
      status: 'completed';
      orderExternalId: string;
      orderKind: PartnerPaymentOrderKind;
      deduped: boolean;
    };

export class PartnerPaymentConfirmConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PartnerPaymentConfirmConflictError';
    Object.setPrototypeOf(this, PartnerPaymentConfirmConflictError.prototype);
  }
}

export class PartnerPaymentProviderCaptureConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PartnerPaymentProviderCaptureConflictError';
    Object.setPrototypeOf(this, PartnerPaymentProviderCaptureConflictError.prototype);
  }
}

export class PartnerPaymentConfirmReviewRequiredError extends Error {
  constructor(
    readonly orderExternalId: string,
    readonly orderKind: PartnerPaymentOrderKind,
    readonly providerCaptureId: string,
  ) {
    super(`partner payment confirmation requires manual review: ${orderExternalId}`);
    this.name = 'PartnerPaymentConfirmReviewRequiredError';
    Object.setPrototypeOf(this, PartnerPaymentConfirmReviewRequiredError.prototype);
  }
}

function normalizeBoundedString(value: unknown, fieldName: string, maxLength: number): string {
  if (typeof value !== 'string') {
    throw new RangeError(`${fieldName} must be a non-empty string with length <= ${maxLength}`);
  }
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maxLength) {
    throw new RangeError(`${fieldName} must be a non-empty string with length <= ${maxLength}`);
  }
  return normalized;
}

function normalizeWholeCnyAmount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError('amountCnyCents must be a positive safe integer');
  }
  if (value % HOLA_CREDIT_CNY_CENTS !== 0) {
    throw new RangeError('amountCnyCents must be a whole CNY amount');
  }
  return value;
}

function normalizeDate(value: Date, fieldName: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new RangeError(`${fieldName} must be a valid Date`);
  }
  return new Date(value.getTime());
}

function normalizePositiveSafeInteger(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${fieldName} must be a positive safe integer`);
  }
  return value;
}

function normalizeConfirmInput(input: PartnerPaymentConfirmInput): NormalizedPartnerPaymentConfirmInput {
  return {
    orderExternalId: normalizeBoundedString(
      input.orderExternalId,
      'orderExternalId',
      ORDER_EXTERNAL_ID_MAX_LENGTH,
    ),
    provider: normalizeBoundedString(input.provider, 'provider', PROVIDER_MAX_LENGTH),
    providerCaptureId: normalizeBoundedString(
      input.providerCaptureId,
      'providerCaptureId',
      PROVIDER_CAPTURE_ID_MAX_LENGTH,
    ),
    amountCnyCents: normalizeWholeCnyAmount(input.amountCnyCents),
    now: normalizeDate(input.now ?? new Date(), 'now'),
  };
}

function normalizeReviewApprovalInput(
  input: PartnerPaymentReviewApprovalInput,
): NormalizedPartnerPaymentReviewApprovalInput {
  const note =
    input.note === undefined
      ? undefined
      : normalizeBoundedString(input.note, 'note', REVIEW_APPROVAL_NOTE_MAX_LENGTH);

  return {
    orderExternalId: normalizeBoundedString(
      input.orderExternalId,
      'orderExternalId',
      ORDER_EXTERNAL_ID_MAX_LENGTH,
    ),
    reviewerUserId: normalizePositiveSafeInteger(input.reviewerUserId, 'reviewerUserId'),
    note,
    now: normalizeDate(input.now ?? new Date(), 'now'),
  };
}

function normalizeOrderKind(value: string): PartnerPaymentOrderKind {
  if (value === 'membership' || value === 'recharge') {
    return value;
  }
  throw new PartnerPaymentConfirmConflictError(`unknown partner order kind: ${value}`);
}

function partnerOrderCompletedResult(
  order: PartnerRechargeOrder,
  deduped: boolean,
): PartnerPaymentConfirmResult {
  return {
    ok: true,
    status: 'completed',
    orderExternalId: order.externalId,
    orderKind: normalizeOrderKind(order.orderKind),
    deduped,
  };
}

function isSameCapturedOrder(
  order: PartnerRechargeOrder,
  input: NormalizedPartnerPaymentConfirmInput,
): boolean {
  return (
    order.provider === input.provider &&
    order.providerCaptureId === input.providerCaptureId &&
    order.amountCnyCents === input.amountCnyCents
  );
}

function assertOrderPayloadMatches(
  order: PartnerRechargeOrder,
  input: NormalizedPartnerPaymentConfirmInput,
): void {
  if (order.provider !== input.provider) {
    throw new PartnerPaymentConfirmConflictError(
      `partner payment provider mismatch for ${order.externalId}`,
    );
  }
  if (order.amountCnyCents !== input.amountCnyCents) {
    throw new PartnerPaymentConfirmConflictError(
      `partner payment amount mismatch for ${order.externalId}`,
    );
  }
}

function isDuplicateKeyError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'ER_DUP_ENTRY') return true;
  const message = error instanceof Error ? error.message : String(error);
  return /duplicate/i.test(message);
}

function isRechargeLotCreationBusinessError(error: unknown): boolean {
  return error instanceof RangeError || error instanceof RechargeLotConflictError;
}

function safeErrorName(error: unknown): string {
  if (error instanceof Error && error.name.trim().length > 0) {
    return error.name.slice(0, 128);
  }
  return 'Error';
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 512);
}

function reviewMetadata(existing: unknown, error: unknown): Record<string, unknown> {
  const base =
    existing !== null && typeof existing === 'object' && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {};
  return {
    ...base,
    reviewReason: 'lot_creation_failed',
    errorName: safeErrorName(error),
    errorMessage: safeErrorMessage(error),
  };
}

function annualCapReviewMetadata(input: {
  existing: unknown;
  annualRechargeCapCnyCents: number;
  annualRechargeTotalCnyCents: number;
}): Record<string, unknown> {
  const base =
    input.existing !== null && typeof input.existing === 'object' && !Array.isArray(input.existing)
      ? (input.existing as Record<string, unknown>)
      : {};
  return {
    ...base,
    reviewReason: 'annual_recharge_cap_exceeded',
    annualRechargeCapCnyCents: input.annualRechargeCapCnyCents,
    annualRechargeTotalCnyCents: input.annualRechargeTotalCnyCents,
  };
}

function approvalMetadata(
  existing: unknown,
  approval: NormalizedPartnerPaymentReviewApprovalInput,
): Record<string, unknown> {
  const base =
    existing !== null && typeof existing === 'object' && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {};
  return {
    ...base,
    reviewApprovedByUserId: approval.reviewerUserId,
    reviewApprovedAt: approval.now.toISOString(),
    ...(approval.note ? { reviewApprovalNote: approval.note } : {}),
  };
}

function hasReviewApprovalMetadata(order: PartnerRechargeOrder): boolean {
  return (
    order.metadata !== null &&
    typeof order.metadata === 'object' &&
    !Array.isArray(order.metadata) &&
    typeof (order.metadata as Record<string, unknown>).reviewApprovedByUserId === 'number'
  );
}

export function partnerPaymentIdempotencyKey(input: {
  provider: string;
  providerCaptureId: string;
}): string {
  const provider = normalizeBoundedString(input.provider, 'provider', PROVIDER_MAX_LENGTH);
  const providerCaptureId = normalizeBoundedString(
    input.providerCaptureId,
    'providerCaptureId',
    PROVIDER_CAPTURE_ID_MAX_LENGTH,
  );
  return `partner-payment:${provider}:${providerCaptureId}`;
}

export class PartnerPaymentConfirmService {
  private readonly membershipService: (db: DB) => MembershipActivator;
  private readonly rechargeService: (db: DB) => RechargeLotCreator;

  constructor(private readonly db: DB, deps: PartnerPaymentConfirmServiceDeps = {}) {
    this.membershipService = deps.membershipService ?? ((db) => new PartnerMembershipService(db));
    this.rechargeService = deps.rechargeService ?? ((db) => new RechargeService(db));
  }

  async confirmCapturedOrder(input: PartnerPaymentConfirmInput): Promise<PartnerPaymentConfirmResult> {
    const confirm = normalizeConfirmInput(input);
    const order = await this.readOrderByExternalId(this.db, confirm.orderExternalId);

    if (!order) {
      return {
        ok: true,
        status: 'unknown_order',
        orderExternalId: confirm.orderExternalId,
        deduped: true,
      };
    }

    assertOrderPayloadMatches(order, confirm);
    const orderKind = normalizeOrderKind(order.orderKind);

    if (order.status === 'completed') {
      if (isSameCapturedOrder(order, confirm)) {
        return partnerOrderCompletedResult(order, true);
      }
      throw new PartnerPaymentConfirmConflictError(
        `partner order ${order.externalId} is already completed with a different capture payload`,
      );
    }

    if (order.status === 'review_required') {
      if (isSameCapturedOrder(order, confirm)) {
        throw new PartnerPaymentConfirmReviewRequiredError(
          order.externalId,
          orderKind,
          confirm.providerCaptureId,
        );
      }
      throw new PartnerPaymentConfirmConflictError(
        `partner order ${order.externalId} is already in review with a different capture payload`,
      );
    }

    if (order.status !== 'pending') {
      throw new PartnerPaymentConfirmConflictError(
        `partner order ${order.externalId} cannot be confirmed from status ${order.status}`,
      );
    }

    const existingCapture = await this.readOrderByProviderCapture(
      this.db,
      confirm.provider,
      confirm.providerCaptureId,
    );
    if (existingCapture && existingCapture.externalId !== order.externalId) {
      throw new PartnerPaymentProviderCaptureConflictError(
        `provider capture ${confirm.provider}:${confirm.providerCaptureId} is already attached to another partner order`,
      );
    }

    const result = await this.db.transaction((tx) =>
      this.confirmPendingOrderInTransaction(tx as unknown as DB, order, orderKind, confirm),
    );
    if (result instanceof PartnerPaymentConfirmReviewRequiredError) {
      throw result;
    }
    return result;
  }

  async approveReviewRequiredOrder(
    input: PartnerPaymentReviewApprovalInput,
  ): Promise<PartnerPaymentConfirmResult> {
    const approval = normalizeReviewApprovalInput(input);
    const order = await this.readOrderByExternalId(this.db, approval.orderExternalId);

    if (!order) {
      throw new PartnerPaymentConfirmConflictError(
        `partner order ${approval.orderExternalId} was not found for review approval`,
      );
    }

    const orderKind = normalizeOrderKind(order.orderKind);
    if (orderKind !== 'recharge') {
      throw new PartnerPaymentConfirmConflictError(
        `partner order ${order.externalId} cannot be review-approved because it is not a recharge order`,
      );
    }

    if (order.status === 'completed') {
      if (hasReviewApprovalMetadata(order)) {
        return partnerOrderCompletedResult(order, true);
      }
      throw new PartnerPaymentConfirmConflictError(
        `partner order ${order.externalId} is already completed outside review approval`,
      );
    }

    if (order.status !== 'review_required') {
      throw new PartnerPaymentConfirmConflictError(
        `partner order ${order.externalId} cannot be review-approved from status ${order.status}`,
      );
    }

    if (order.providerCaptureId === null || order.providerCaptureId.trim().length === 0) {
      throw new PartnerPaymentConfirmConflictError(
        `partner order ${order.externalId} has no captured provider id to review-approve`,
      );
    }

    return this.db.transaction((tx) =>
      this.approveReviewRequiredOrderInTransaction(tx as unknown as DB, order, approval),
    );
  }

  private async confirmPendingOrderInTransaction(
    tx: DB,
    order: PartnerRechargeOrder,
    orderKind: PartnerPaymentOrderKind,
    confirm: NormalizedPartnerPaymentConfirmInput,
  ): Promise<PartnerPaymentConfirmResult | PartnerPaymentConfirmReviewRequiredError> {
    await this.lockUserForConfirmation(tx, order.userId);

    let updateResult: unknown;
    try {
      updateResult = await tx
        .update(partnerRechargeOrders)
        .set({
          status: 'completed',
          providerCaptureId: confirm.providerCaptureId,
          updatedAt: confirm.now,
        })
        .where(
          and(
            eq(partnerRechargeOrders.externalId, order.externalId),
            eq(partnerRechargeOrders.status, 'pending'),
          ),
        );
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new PartnerPaymentProviderCaptureConflictError(
          `provider capture ${confirm.provider}:${confirm.providerCaptureId} is already attached to another partner order`,
        );
      }
      throw error;
    }

    if (readAffectedRows(updateResult) !== 1) {
      const readback = await this.readOrderByExternalId(tx, order.externalId);
      if (readback?.status === 'completed' && isSameCapturedOrder(readback, confirm)) {
        return partnerOrderCompletedResult(readback, true);
      }
      if (readback?.status === 'review_required' && isSameCapturedOrder(readback, confirm)) {
        return new PartnerPaymentConfirmReviewRequiredError(
          readback.externalId,
          normalizeOrderKind(readback.orderKind),
          confirm.providerCaptureId,
        );
      }
      throw new PartnerPaymentConfirmConflictError(
        `partner order ${order.externalId} was not completed by this confirmation attempt`,
      );
    }

    const completedOrder = {
      ...order,
      status: 'completed',
      providerCaptureId: confirm.providerCaptureId,
      updatedAt: confirm.now,
    };

    if (orderKind === 'membership') {
      await this.membershipService(tx).activate({
        userId: order.userId,
        sourcePaymentExternalId: order.externalId,
        now: confirm.now,
      });
    } else {
      const annualRechargeTotalCnyCents = await computeCompletedRechargeTotalCnyCents(tx, {
        userId: order.userId,
        windowStart: rechargeAnnualWindowStart(confirm.now),
        now: confirm.now,
      });
      const annualRechargeCapCnyCents = partnerConfig().annualRechargeCapCnyCents;
      try {
        assertAnnualRechargeCap({
          annualRechargeTotalCnyCents,
          annualRechargeCapCnyCents,
        });
      } catch (error) {
        if (!(error instanceof RangeError)) {
          throw error;
        }
        await this.markOrderReviewRequired(
          tx,
          completedOrder,
          confirm,
          annualCapReviewMetadata({
            existing: completedOrder.metadata,
            annualRechargeCapCnyCents,
            annualRechargeTotalCnyCents,
          }),
        );
        return new PartnerPaymentConfirmReviewRequiredError(
          order.externalId,
          orderKind,
          confirm.providerCaptureId,
        );
      }

      const rollingThirtyDayCnyCents = await computeCompletedRechargeTotalCnyCents(tx, {
        userId: order.userId,
        windowStart: rechargeRollingThirtyDayWindowStart(confirm.now),
        now: confirm.now,
      });
      try {
        await this.rechargeService(tx).createLotForCapturedRecharge({
          userId: order.userId,
          rechargeOrderId: order.id,
          amountCnyCents: order.amountCnyCents,
          rollingThirtyDayCnyCents,
          now: confirm.now,
        });
      } catch (error) {
        if (!isRechargeLotCreationBusinessError(error)) {
          throw error;
        }
        await this.markOrderReviewRequired(tx, completedOrder, confirm, reviewMetadata(completedOrder.metadata, error));
        return new PartnerPaymentConfirmReviewRequiredError(
          order.externalId,
          orderKind,
          confirm.providerCaptureId,
        );
      }
    }

    return partnerOrderCompletedResult(completedOrder, false);
  }

  private async approveReviewRequiredOrderInTransaction(
    tx: DB,
    order: PartnerRechargeOrder,
    approval: NormalizedPartnerPaymentReviewApprovalInput,
  ): Promise<PartnerPaymentConfirmResult> {
    await this.lockUserForConfirmation(tx, order.userId);

    const metadata = approvalMetadata(order.metadata, approval);
    const updateResult = await tx
      .update(partnerRechargeOrders)
      .set({
        status: 'completed',
        metadata,
        updatedAt: approval.now,
      })
      .where(
        and(
          eq(partnerRechargeOrders.externalId, order.externalId),
          eq(partnerRechargeOrders.status, 'review_required'),
        ),
      );

    if (readAffectedRows(updateResult) !== 1) {
      const readback = await this.readOrderByExternalId(tx, order.externalId);
      if (readback?.status === 'completed' && hasReviewApprovalMetadata(readback)) {
        return partnerOrderCompletedResult(readback, true);
      }
      throw new PartnerPaymentConfirmConflictError(
        `partner order ${order.externalId} was not completed by this review approval`,
      );
    }

    const completedOrder = {
      ...order,
      status: 'completed',
      metadata,
      updatedAt: approval.now,
    };

    const rollingThirtyDayCnyCents = await computeCompletedRechargeTotalCnyCents(tx, {
      userId: order.userId,
      windowStart: rechargeRollingThirtyDayWindowStart(approval.now),
      now: approval.now,
    });
    await this.rechargeService(tx).createLotForCapturedRecharge({
      userId: order.userId,
      rechargeOrderId: order.id,
      amountCnyCents: order.amountCnyCents,
      rollingThirtyDayCnyCents,
      reviewOverride: {
        reviewerUserId: approval.reviewerUserId,
        approvedAt: approval.now,
        ...(approval.note ? { note: approval.note } : {}),
      },
      now: approval.now,
    });

    return partnerOrderCompletedResult(completedOrder, false);
  }

  private async lockUserForConfirmation(db: DB, userId: number): Promise<void> {
    const [row] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .for('update')
      .limit(1);
    if (!row) {
      throw new PartnerPaymentConfirmConflictError(`partner payment user ${userId} was not found`);
    }
  }

  private async readOrderByExternalId(db: DB, externalId: string): Promise<PartnerRechargeOrder | null> {
    const [row] = await db
      .select()
      .from(partnerRechargeOrders)
      .where(eq(partnerRechargeOrders.externalId, externalId))
      .limit(1);
    return row ?? null;
  }

  private async readOrderByProviderCapture(
    db: DB,
    provider: string,
    providerCaptureId: string,
  ): Promise<PartnerRechargeOrder | null> {
    const [row] = await db
      .select()
      .from(partnerRechargeOrders)
      .where(
        and(
          eq(partnerRechargeOrders.provider, provider),
          eq(partnerRechargeOrders.providerCaptureId, providerCaptureId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  private async markOrderReviewRequired(
    db: DB,
    order: PartnerRechargeOrder,
    confirm: NormalizedPartnerPaymentConfirmInput,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    const result = await db
      .update(partnerRechargeOrders)
      .set({
        status: 'review_required',
        providerCaptureId: confirm.providerCaptureId,
        metadata,
        updatedAt: confirm.now,
      })
      .where(eq(partnerRechargeOrders.externalId, order.externalId));
    if (readAffectedRows(result) !== 1) {
      throw new PartnerPaymentConfirmConflictError(
        `partner order ${order.externalId} could not be moved to review_required`,
      );
    }
  }

}
