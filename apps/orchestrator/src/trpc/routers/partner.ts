import { HOLA_CREDIT_CNY_CENTS, PARTNER_RECHARGE_MAX_MONTHLY_CNY_CENTS } from '@holaday/shared-types';
import { TRPCError } from '@trpc/server';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { users } from '../../db/schema/users.js';
import { partnerLots } from '../../db/schema/partner.js';
import { CreditLedgerService } from '../../partner/credit-ledger-service.js';
import { KycService, canRechargeWithKycStatus } from '../../partner/kyc-service.js';
import { PartnerMembershipService } from '../../partner/membership-service.js';
import { calculateApiUnits, selectRechargeTier } from '../../partner/partner-rules.js';
import { validateRechargeAmount } from '../../partner/recharge-service.js';
import { protectedProcedure, publicProcedure, router } from '../trpc.js';
import type { Context } from '../context.js';

const rechargePreviewInput = z.object({
  amountCnyCents: z.number(),
  rollingThirtyDayCnyCents: z.number().optional(),
});

function partnerLedgerEnabled(): boolean {
  return process.env.PARTNER_LEDGER_ENABLED === 'true';
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

function normalizeRollingThirtyDayAmount(
  amountCnyCents: number,
  rollingThirtyDayCnyCents?: number,
): number {
  const rolling = rollingThirtyDayCnyCents ?? amountCnyCents;

  if (!Number.isSafeInteger(rolling) || rolling < 0) {
    badRequest('rollingThirtyDayCnyCents must be a non-negative safe integer');
  }
  if (rolling % HOLA_CREDIT_CNY_CENTS !== 0) {
    badRequest('rollingThirtyDayCnyCents must be a whole CNY amount');
  }
  if (rolling < amountCnyCents) {
    badRequest('rollingThirtyDayCnyCents must include the current recharge amount');
  }
  if (rolling > PARTNER_RECHARGE_MAX_MONTHLY_CNY_CENTS) {
    badRequest('rollingThirtyDayCnyCents must not exceed the monthly maximum');
  }

  return rolling;
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

    return {
      enabled: true as const,
      membership: membership
        ? {
            status: membership.status,
            expiresAt: membership.expiresAt,
          }
        : null,
      kycStatus,
      ledger,
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

  rechargePreview: protectedProcedure.input(rechargePreviewInput).query(async ({ ctx, input }) => {
    if (!partnerLedgerEnabled()) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'partner ledger is disabled',
      });
    }

    const validation = validateRechargeAmount(input.amountCnyCents);
    if (!validation.ok) {
      badRequest(validation.reason);
    }
    const amountCnyCents = input.amountCnyCents;
    const rollingThirtyDayCnyCents = normalizeRollingThirtyDayAmount(
      amountCnyCents,
      input.rollingThirtyDayCnyCents,
    );

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

    const tier = selectRechargeTier(rollingThirtyDayCnyCents);

    return {
      amountCnyCents,
      rollingThirtyDayCnyCents,
      tier,
      apiUnits: calculateApiUnits(amountCnyCents, tier.multiplierBps),
    };
  }),
});
