import {
  HOLA_CREDIT_CNY_CENTS,
  PARTNER_MEMBERSHIP_PRICE_CNY_CENTS,
  PARTNER_RECHARGE_MAX_MONTHLY_CNY_CENTS,
} from '@holaday/shared-types';
import { TRPCError } from '@trpc/server';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { users } from '../../db/schema/users.js';
import { partnerLots } from '../../db/schema/partner.js';
import { CreditLedgerService } from '../../partner/credit-ledger-service.js';
import { KycService, canRechargeWithKycStatus } from '../../partner/kyc-service.js';
import { PartnerMembershipService } from '../../partner/membership-service.js';
import { calculateApiUnits, selectRechargeTier } from '../../partner/partner-rules.js';
import {
  RechargeGateError,
  RechargeOrderIdempotencyConflictError,
  RechargeService,
  computeCompletedRechargeTotalCnyCents,
  rechargeRollingThirtyDayWindowStart,
  validateRechargeAmount,
} from '../../partner/recharge-service.js';
import { evaluatePartnerRisk } from '../../partner/risk-service.js';
import {
  WithdrawalGateError,
  WithdrawalRequestIdempotencyConflictError,
  WithdrawalService,
  WithdrawalValidationError,
} from '../../partner/withdrawal-service.js';
import { protectedProcedure, publicProcedure, router } from '../trpc.js';
import type { Context } from '../context.js';

const paymentProviderInput = z.enum(['wechat', 'alipay', 'manual']);
const moneyCentsInput = z.number().int().safe();
const idempotencyKeyInput = z.string().trim().min(1).max(128);

const createMembershipOrderInput = z.object({
  provider: paymentProviderInput.optional(),
  idempotencyKey: idempotencyKeyInput,
});

const createRechargeOrderInput = z.object({
  amountCnyCents: moneyCentsInput,
  provider: paymentProviderInput.optional(),
  idempotencyKey: idempotencyKeyInput,
});

const requestWithdrawalInput = z.object({
  amountCreditCents: moneyCentsInput,
  bankAccountFingerprint: z.string().trim().min(1).max(128),
  idempotencyKey: idempotencyKeyInput,
});

const rechargePreviewInput = z.object({
  amountCnyCents: moneyCentsInput,
  rollingThirtyDayCnyCents: moneyCentsInput.optional(),
});

function partnerLedgerEnabled(): boolean {
  return process.env.PARTNER_LEDGER_ENABLED === 'true';
}

function requirePartnerLedgerEnabled(): void {
  if (!partnerLedgerEnabled()) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'partner ledger is disabled',
    });
  }
}

async function requireInternalUserId(ctx: Context & { userId: string }): Promise<number> {
  const [row] = await ctx.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.externalId, ctx.userId))
    .limit(1);

  if (!row) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
  }
  return row.id;
}

function badRequest(message: string): never {
  throw new TRPCError({ code: 'BAD_REQUEST', message });
}

function summarizePartnerOrder(order: {
  externalId: string;
  provider: string;
  orderKind: string;
  amountCnyCents: number;
  status: string;
}) {
  return {
    orderExternalId: order.externalId,
    provider: order.provider,
    orderKind: order.orderKind,
    amountCnyCents: order.amountCnyCents,
    status: order.status,
  };
}

function summarizePartnerWithdrawal(withdrawal: {
  externalId: string;
  amountCreditCents: number;
  status: string;
  reviewDueAt: Date;
  riskScore: number;
}) {
  return {
    withdrawalExternalId: withdrawal.externalId,
    amountCreditCents: withdrawal.amountCreditCents,
    status: withdrawal.status,
    reviewDueAt: withdrawal.reviewDueAt,
    riskScore: withdrawal.riskScore,
  };
}

function mapRechargeOrderError(error: unknown): never {
  if (error instanceof TRPCError) {
    throw error;
  }

  if (error instanceof RechargeGateError) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message:
        error.reason === 'membership_required'
          ? 'partner membership required'
          : 'partner KYC must be passed before recharge',
    });
  }

  if (error instanceof RechargeOrderIdempotencyConflictError) {
    throw new TRPCError({
      code: 'CONFLICT',
      message: 'partner recharge order idempotency conflict',
    });
  }

  if (error instanceof RangeError) {
    badRequest(error.message);
  }

  throw new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message: 'failed to create partner recharge order',
  });
}

function mapWithdrawalError(error: unknown): never {
  if (error instanceof TRPCError) {
    throw error;
  }

  if (error instanceof WithdrawalGateError) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'partner KYC must be passed before withdrawal',
    });
  }

  if (error instanceof WithdrawalValidationError) {
    badRequest(error.reason);
  }

  if (error instanceof WithdrawalRequestIdempotencyConflictError) {
    throw new TRPCError({
      code: 'CONFLICT',
      message: 'partner withdrawal request idempotency conflict',
    });
  }

  if (error instanceof RangeError) {
    badRequest(error.message);
  }

  throw new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message: 'failed to request partner withdrawal',
  });
}

function assertRollingThirtyDayAmount(rolling: number): void {
  if (!Number.isSafeInteger(rolling) || rolling < 0) {
    badRequest('rollingThirtyDayCnyCents must be a non-negative safe integer');
  }
  if (rolling % HOLA_CREDIT_CNY_CENTS !== 0) {
    badRequest('rollingThirtyDayCnyCents must be a whole CNY amount');
  }
  if (rolling > PARTNER_RECHARGE_MAX_MONTHLY_CNY_CENTS) {
    badRequest('rollingThirtyDayCnyCents must not exceed the monthly maximum');
  }
}

export const partnerRouter = router({
  options: publicProcedure.query(() => ({
    enabled: partnerLedgerEnabled(),
  })),

  dashboard: protectedProcedure.query(async ({ ctx }) => {
    if (!partnerLedgerEnabled()) {
      return { enabled: false as const };
    }

    const userId = await requireInternalUserId(ctx);
    const membershipService = new PartnerMembershipService(ctx.db);
    const kycService = new KycService(ctx.db);
    const ledgerService = new CreditLedgerService(ctx.db);

    const [membership, kycStatus, ledger, lots] = await Promise.all([
      membershipService.getActiveMembership(userId),
      kycService.getStatus(userId),
      ledgerService.summarizeUser(userId),
      ctx.db
        .select({
          id: partnerLots.id,
          externalId: partnerLots.externalId,
          status: partnerLots.status,
          riskStatus: partnerLots.riskStatus,
          principalCreditCents: partnerLots.principalCreditCents,
          lockedBonusCreditCents: partnerLots.lockedBonusCreditCents,
          releasedPrincipalCreditCents: partnerLots.releasedPrincipalCreditCents,
          releasedBonusCreditCents: partnerLots.releasedBonusCreditCents,
          carryForwardCreditCents: partnerLots.carryForwardCreditCents,
          releaseStartsAt: partnerLots.releaseStartsAt,
          releaseEndsAt: partnerLots.releaseEndsAt,
        })
        .from(partnerLots)
        .where(eq(partnerLots.userId, userId))
        .orderBy(desc(partnerLots.createdAt))
        .limit(20),
    ]);

    const dashboardLedger = {
      ...ledger,
      withdrawableCreditCents: ledger.availableCreditCents,
    };

    return {
      enabled: true as const,
      membership: membership
        ? {
            status: membership.status,
            expiresAt: membership.expiresAt,
          }
        : null,
      kycStatus,
      ledger: dashboardLedger,
      lots: lots.map((lot) => ({
        id: lot.id,
        externalId: lot.externalId,
        status: lot.status,
        riskStatus: lot.riskStatus,
        principalCreditCents: lot.principalCreditCents,
        lockedBonusCreditCents: lot.lockedBonusCreditCents,
        releasedPrincipalCreditCents: lot.releasedPrincipalCreditCents,
        releasedBonusCreditCents: lot.releasedBonusCreditCents,
        carryForwardCreditCents: lot.carryForwardCreditCents,
        releaseStartsAt: lot.releaseStartsAt,
        releaseEndsAt: lot.releaseEndsAt,
      })),
    };
  }),

  createMembershipOrder: protectedProcedure.input(createMembershipOrderInput).mutation(async ({ ctx, input }) => {
    requirePartnerLedgerEnabled();

    const userId = await requireInternalUserId(ctx);
    try {
      const order = await new RechargeService(ctx.db).createPendingOrder({
        userId,
        provider: input.provider ?? 'manual',
        orderKind: 'membership',
        amountCnyCents: PARTNER_MEMBERSHIP_PRICE_CNY_CENTS,
        idempotencyKey: input.idempotencyKey,
      });
      return summarizePartnerOrder(order);
    } catch (error) {
      mapRechargeOrderError(error);
    }
  }),

  createRechargeOrder: protectedProcedure.input(createRechargeOrderInput).mutation(async ({ ctx, input }) => {
    requirePartnerLedgerEnabled();

    const userId = await requireInternalUserId(ctx);
    try {
      const order = await new RechargeService(ctx.db).createPendingOrder({
        userId,
        provider: input.provider ?? 'manual',
        orderKind: 'recharge',
        amountCnyCents: input.amountCnyCents,
        idempotencyKey: input.idempotencyKey,
      });
      return summarizePartnerOrder(order);
    } catch (error) {
      mapRechargeOrderError(error);
    }
  }),

  requestWithdrawal: protectedProcedure.input(requestWithdrawalInput).mutation(async ({ ctx, input }) => {
    requirePartnerLedgerEnabled();

    const userId = await requireInternalUserId(ctx);
    try {
      const kycStatus = await new KycService(ctx.db).getStatus(userId);
      const risk = evaluatePartnerRisk({
        kycPassed: kycStatus === 'passed',
        sameNameBank: false,
        amountCreditCents: input.amountCreditCents,
        referralConcentration: false,
        accountFrozen: false,
      });
      const withdrawal = await new WithdrawalService(ctx.db).requestWithdrawal({
        userId,
        amountCreditCents: input.amountCreditCents,
        bankAccountFingerprint: input.bankAccountFingerprint,
        highRisk: risk.status !== 'normal',
        riskScore: risk.score,
        idempotencyKey: input.idempotencyKey,
      });
      return summarizePartnerWithdrawal(withdrawal);
    } catch (error) {
      mapWithdrawalError(error);
    }
  }),

  rechargePreview: protectedProcedure.input(rechargePreviewInput).query(async ({ ctx, input }) => {
    requirePartnerLedgerEnabled();

    const validation = validateRechargeAmount(input.amountCnyCents);
    if (!validation.ok) {
      badRequest(validation.reason);
    }
    const amountCnyCents = input.amountCnyCents;

    const userId = await requireInternalUserId(ctx);
    const membership = await new PartnerMembershipService(ctx.db).getActiveMembership(userId);
    if (!membership) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'partner membership required',
      });
    }

    const kycStatus = await new KycService(ctx.db).getStatus(userId);
    if (!canRechargeWithKycStatus(kycStatus)) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'partner KYC must be passed before recharge',
      });
    }

    const previewNow = new Date();
    const rollingThirtyDayCnyCents =
      amountCnyCents +
      (await computeCompletedRechargeTotalCnyCents(ctx.db, {
        userId,
        windowStart: rechargeRollingThirtyDayWindowStart(previewNow),
        now: previewNow,
      }));
    assertRollingThirtyDayAmount(rollingThirtyDayCnyCents);
    const tier = selectRechargeTier(rollingThirtyDayCnyCents);

    return {
      amountCnyCents,
      rollingThirtyDayCnyCents,
      tier,
      apiUnits: calculateApiUnits(amountCnyCents, tier.multiplierBps),
    };
  }),
});
