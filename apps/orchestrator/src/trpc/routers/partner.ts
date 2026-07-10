import {
  HOLA_CREDIT_CNY_CENTS,
  PARTNER_MEMBERSHIP_PRICE_CNY_CENTS,
} from '@holaday/shared-types';
import { TRPCError } from '@trpc/server';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { users } from '../../db/schema/users.js';
import { partnerLots, partnerRechargeOrders, partnerWithdrawalRequests } from '../../db/schema/partner.js';
import { CreditLedgerService } from '../../partner/credit-ledger-service.js';
import { KycService, canRechargeWithKycStatus, normalizeKycStatus } from '../../partner/kyc-service.js';
import { PartnerMembershipService } from '../../partner/membership-service.js';
import { partnerConfig } from '../../partner/partner-config.js';
import { calculateApiUnits, selectRechargeTier } from '../../partner/partner-rules.js';
import {
  RechargeGateError,
  RechargeOrderIdempotencyConflictError,
  RechargeService,
  computeCompletedRechargeTotalCnyCents,
  rechargeRollingThirtyDayWindowStart,
  validateRechargeAmount,
} from '../../partner/recharge-service.js';
import { PartnerReferralConflictError, ReferralService } from '../../partner/referral-service.js';
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

const recordInviteInput = z.object({
  inviterExternalId: z.string().trim().min(1).max(64),
  assisted: z.boolean().optional(),
});

const submitKycInput = z.object({
  providerRef: z.string().trim().min(1).max(128).optional(),
  bankAccountFingerprint: z.string().trim().min(1).max(128).optional(),
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

const DASHBOARD_ACTIVITY_LIMIT = 10;

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
  const row = await readUserByExternalId(ctx, ctx.userId);
  if (!row) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
  }
  return row.id;
}

async function readUserByExternalId(
  ctx: Context,
  externalId: string,
): Promise<{ id: number } | null> {
  const [row] = await ctx.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.externalId, externalId))
    .limit(1);

  return row ?? null;
}

function badRequest(message: string): never {
  throw new TRPCError({ code: 'BAD_REQUEST', message });
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function metadataText(metadata: Record<string, unknown>, key: string): string | undefined {
  const value = metadata[key];
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function summarizePartnerOrder(order: {
  externalId: string;
  provider: string;
  orderKind: string;
  amountCnyCents: number;
  status: string;
  createdAt: Date;
  metadata?: unknown;
}) {
  const metadata = metadataRecord(order.metadata);
  const reviewReason = metadataText(metadata, 'reviewReason');
  const reviewErrorMessage = metadataText(metadata, 'errorMessage');
  return {
    orderExternalId: order.externalId,
    provider: order.provider,
    orderKind: order.orderKind,
    amountCnyCents: order.amountCnyCents,
    status: order.status,
    ...(reviewReason ? { reviewReason } : {}),
    ...(reviewErrorMessage ? { reviewErrorMessage } : {}),
    createdAt: order.createdAt,
  };
}

function summarizePartnerWithdrawal(withdrawal: {
  externalId: string;
  amountCreditCents: number;
  status: string;
  reviewDueAt: Date;
  bankAccountFingerprint: string;
  riskScore: number;
  rejectionReason?: string | null;
  metadata?: unknown;
}) {
  const metadata = metadataRecord(withdrawal.metadata);
  const rejectionReason = typeof withdrawal.rejectionReason === 'string' && withdrawal.rejectionReason.trim()
    ? withdrawal.rejectionReason.trim()
    : undefined;
  const providerPayoutId = metadataText(metadata, 'providerPayoutId');
  const paidAt = metadataText(metadata, 'paidAt');
  const rejectedAt = metadataText(metadata, 'rejectedAt');
  return {
    withdrawalExternalId: withdrawal.externalId,
    amountCreditCents: withdrawal.amountCreditCents,
    status: withdrawal.status,
    reviewDueAt: withdrawal.reviewDueAt,
    bankAccountFingerprint: withdrawal.bankAccountFingerprint,
    riskScore: withdrawal.riskScore,
    ...(rejectionReason ? { rejectionReason } : {}),
    ...(providerPayoutId ? { providerPayoutId } : {}),
    ...(paidAt ? { paidAt } : {}),
    ...(rejectedAt ? { rejectedAt } : {}),
  };
}

function summarizePartnerReferral(
  referral: {
    externalId: string;
    status: string;
    assisted: number;
  },
  input: {
    inviterExternalId: string;
    inviteeExternalId: string;
  },
) {
  return {
    referralExternalId: referral.externalId,
    inviterExternalId: input.inviterExternalId,
    inviteeExternalId: input.inviteeExternalId,
    status: referral.status,
    assisted: referral.assisted === 1,
  };
}

function summarizePartnerKyc(profile: {
  externalId: string;
  status: string;
  country: string;
  provider: string | null;
  providerRef: string | null;
  reviewedAt: Date | null;
}) {
  return {
    kycExternalId: profile.externalId,
    status: profile.status,
    country: profile.country,
    provider: profile.provider ?? 'manual',
    providerRef: profile.providerRef,
    reviewedAt: profile.reviewedAt,
  };
}

function summarizeDashboardLedger(ledger: {
  availableCreditCents: number;
  lockedCreditCents: number;
  withdrawableCreditCents: number;
  pendingWithdrawalCreditCents: number;
  frozenCreditCents: number;
}) {
  return ledger;
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
    const message = {
      membership_required: 'partner membership required',
      kyc_required: 'partner KYC must be passed before withdrawal',
      bank_account_required: 'partner withdrawal requires a verified bank account',
      bank_account_mismatch: 'partner withdrawal bank account must match KYC bank card',
      bank_card_cooling_down: 'partner withdrawal bank account is cooling down',
      risk_frozen: 'partner withdrawal is frozen by risk control',
    }[error.reason];

    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message,
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

function mapKycSubmissionError(error: unknown): never {
  if (error instanceof TRPCError) {
    throw error;
  }

  if (error instanceof RangeError) {
    badRequest(error.message);
  }

  throw new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message: 'failed to submit partner KYC',
  });
}

function mapReferralError(error: unknown): never {
  if (error instanceof TRPCError) {
    throw error;
  }

  if (error instanceof PartnerReferralConflictError) {
    throw new TRPCError({
      code: 'CONFLICT',
      message: 'partner referral attribution conflict',
    });
  }

  if (error instanceof RangeError) {
    badRequest(error.message);
  }

  throw new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message: 'failed to record partner invite',
  });
}

function assertRollingThirtyDayAmount(rolling: number, monthlyRechargeCapCnyCents: number): void {
  if (!Number.isSafeInteger(rolling) || rolling < 0) {
    badRequest('rollingThirtyDayCnyCents must be a non-negative safe integer');
  }
  if (rolling % HOLA_CREDIT_CNY_CENTS !== 0) {
    badRequest('rollingThirtyDayCnyCents must be a whole CNY amount');
  }
  if (rolling > monthlyRechargeCapCnyCents) {
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

    const [membership, kycProfile, ledger, lots, orders, withdrawals] = await Promise.all([
      membershipService.getActiveMembership(userId),
      kycService.getProfile(userId),
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
      ctx.db
        .select({
          externalId: partnerRechargeOrders.externalId,
          provider: partnerRechargeOrders.provider,
          orderKind: partnerRechargeOrders.orderKind,
          amountCnyCents: partnerRechargeOrders.amountCnyCents,
          status: partnerRechargeOrders.status,
          metadata: partnerRechargeOrders.metadata,
          createdAt: partnerRechargeOrders.createdAt,
        })
        .from(partnerRechargeOrders)
        .where(eq(partnerRechargeOrders.userId, userId))
        .orderBy(desc(partnerRechargeOrders.createdAt))
        .limit(DASHBOARD_ACTIVITY_LIMIT),
      ctx.db
        .select({
          externalId: partnerWithdrawalRequests.externalId,
          amountCreditCents: partnerWithdrawalRequests.amountCreditCents,
          status: partnerWithdrawalRequests.status,
          reviewDueAt: partnerWithdrawalRequests.reviewDueAt,
          bankAccountFingerprint: partnerWithdrawalRequests.bankAccountFingerprint,
          riskScore: partnerWithdrawalRequests.riskScore,
          rejectionReason: partnerWithdrawalRequests.rejectionReason,
          metadata: partnerWithdrawalRequests.metadata,
        })
        .from(partnerWithdrawalRequests)
        .where(eq(partnerWithdrawalRequests.userId, userId))
        .orderBy(desc(partnerWithdrawalRequests.createdAt))
        .limit(DASHBOARD_ACTIVITY_LIMIT),
    ]);

    const dashboardLedger = summarizeDashboardLedger(ledger);
    const kycStatus = kycProfile ? normalizeKycStatus(kycProfile.status) : 'not_started';
    const config = partnerConfig();

    return {
      enabled: true as const,
      limits: {
        withdrawalMinCreditCents: config.withdrawalMinCreditCents,
      },
      membership: membership
        ? {
            status: membership.status,
            expiresAt: membership.expiresAt,
          }
        : null,
      kycStatus,
      kycProfile: kycProfile ? summarizePartnerKyc(kycProfile) : null,
      inviteCode: ctx.userId,
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
      orders: orders.map(summarizePartnerOrder),
      withdrawals: withdrawals.map(summarizePartnerWithdrawal),
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

  recordInvite: protectedProcedure.input(recordInviteInput).mutation(async ({ ctx, input }) => {
    requirePartnerLedgerEnabled();

    const inviteeUserId = await requireInternalUserId(ctx);
    const inviter = await readUserByExternalId(ctx, input.inviterExternalId);
    if (!inviter) {
      badRequest('inviter user was not found');
    }

    try {
      const referral = await new ReferralService(ctx.db).recordInvite({
        inviterUserId: inviter.id,
        inviteeUserId,
        assisted: input.assisted,
      });
      return summarizePartnerReferral(referral, {
        inviterExternalId: input.inviterExternalId,
        inviteeExternalId: ctx.userId,
      });
    } catch (error) {
      mapReferralError(error);
    }
  }),

  submitKyc: protectedProcedure.input(submitKycInput).mutation(async ({ ctx, input }) => {
    requirePartnerLedgerEnabled();

    const userId = await requireInternalUserId(ctx);
    const membership = await new PartnerMembershipService(ctx.db).getActiveMembership(userId);
    if (!membership) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'partner membership required',
      });
    }

    const kycService = new KycService(ctx.db);
    const currentStatus = await kycService.getStatus(userId);
    if (currentStatus === 'passed') {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'partner KYC already passed',
      });
    }

    try {
      const profile = await kycService.upsertStatus({
        userId,
        status: 'pending',
        provider: 'manual',
        providerRef: input.providerRef,
        bankCardHash: input.bankAccountFingerprint,
        note: 'partner user submitted KYC review',
      });
      return summarizePartnerKyc(profile);
    } catch (error) {
      mapKycSubmissionError(error);
    }
  }),

  requestWithdrawal: protectedProcedure.input(requestWithdrawalInput).mutation(async ({ ctx, input }) => {
    requirePartnerLedgerEnabled();

    const userId = await requireInternalUserId(ctx);
    try {
      const kycProfile = await new KycService(ctx.db).getProfile(userId);
      const kycStatus = kycProfile ? normalizeKycStatus(kycProfile.status) : 'not_started';
      const sameNameBank =
        typeof kycProfile?.bankCardHash === 'string' &&
        kycProfile.bankCardHash.trim() === input.bankAccountFingerprint;
      const risk = evaluatePartnerRisk({
        kycPassed: kycStatus === 'passed',
        sameNameBank,
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

    const config = partnerConfig();
    const validation = validateRechargeAmount(input.amountCnyCents, config);
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
    assertRollingThirtyDayAmount(rollingThirtyDayCnyCents, config.monthlyRechargeCapCnyCents);
    const tier = selectRechargeTier(rollingThirtyDayCnyCents);

    return {
      amountCnyCents,
      rollingThirtyDayCnyCents,
      tier,
      apiUnits: calculateApiUnits(amountCnyCents, tier.multiplierBps),
    };
  }),
});
