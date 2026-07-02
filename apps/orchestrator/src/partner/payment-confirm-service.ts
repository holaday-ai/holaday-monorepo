import { HOLA_CREDIT_CNY_CENTS } from '@holaday/shared-types';
import { and, eq, gte } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { readAffectedRows } from '../db/mysql-result.js';
import {
  partnerRechargeOrders,
  type PartnerRechargeOrder,
} from '../db/schema/partner.js';
import { PartnerMembershipService } from './membership-service.js';
import { RechargeService } from './recharge-service.js';

const ORDER_EXTERNAL_ID_MAX_LENGTH = 32;
const PROVIDER_MAX_LENGTH = 24;
const PROVIDER_CAPTURE_ID_MAX_LENGTH = 128;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

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

    return this.db.transaction((tx) =>
      this.confirmPendingOrderInTransaction(tx as unknown as DB, order, orderKind, confirm),
    );
  }

  private async confirmPendingOrderInTransaction(
    tx: DB,
    order: PartnerRechargeOrder,
    orderKind: PartnerPaymentOrderKind,
    confirm: NormalizedPartnerPaymentConfirmInput,
  ): Promise<PartnerPaymentConfirmResult> {
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
      const rollingThirtyDayCnyCents = await this.computeRollingThirtyDayCnyCents(tx, {
        userId: order.userId,
        now: confirm.now,
      });
      await this.rechargeService(tx).createLotForCapturedRecharge({
        userId: order.userId,
        rechargeOrderId: order.id,
        amountCnyCents: order.amountCnyCents,
        rollingThirtyDayCnyCents,
        now: confirm.now,
      });
    }

    return partnerOrderCompletedResult(completedOrder, false);
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

  private async computeRollingThirtyDayCnyCents(
    db: DB,
    input: { userId: number; now: Date },
  ): Promise<number> {
    const windowStart = new Date(input.now.getTime() - THIRTY_DAYS_MS);
    const rows = await db
      .select()
      .from(partnerRechargeOrders)
      .where(
        and(
          eq(partnerRechargeOrders.userId, input.userId),
          eq(partnerRechargeOrders.status, 'completed'),
          eq(partnerRechargeOrders.orderKind, 'recharge'),
          gte(partnerRechargeOrders.updatedAt, windowStart),
        ),
      );

    return rows
      .filter((row) => {
        if (row.userId !== input.userId || row.status !== 'completed' || row.orderKind !== 'recharge') {
          return false;
        }
        const effectiveAt = row.updatedAt ?? row.createdAt;
        return effectiveAt.getTime() >= windowStart.getTime() && effectiveAt.getTime() <= input.now.getTime();
      })
      .reduce((sum, row) => sum + row.amountCnyCents, 0);
  }
}
