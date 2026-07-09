import { TRPCError } from '@trpc/server';
import { and, desc, eq, inArray, like, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '../../db/client.js';
import {
  partnerKycProfiles,
  partnerLots,
  partnerRechargeOrders,
  partnerWithdrawalRequests,
  type PartnerRechargeOrder,
  type PartnerWithdrawalRequest,
} from '../../db/schema/partner.js';
import { users } from '../../db/schema/users.js';
import { KycService } from '../../partner/kyc-service.js';
import {
  PartnerPaymentConfirmConflictError,
  PartnerPaymentConfirmReviewRequiredError,
  PartnerPaymentProviderCaptureConflictError,
  PartnerPaymentConfirmService,
} from '../../partner/payment-confirm-service.js';
import { WithdrawalService, WithdrawalTransitionError } from '../../partner/withdrawal-service.js';
import { adminProcedure, router } from '../trpc.js';

const OVERVIEW_LIMIT_CAP = 100;

function partnerLedgerEnabled(): boolean {
  return process.env.PARTNER_LEDGER_ENABLED === 'true';
}

function requirePartnerLedgerEnabled(): void {
  if (!partnerLedgerEnabled()) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'partner ledger is disabled' });
  }
}

async function resolveUserByExternalId(db: DB, userExternalId: string) {
  const [row] = await db
    .select({
      id: users.id,
      externalId: users.externalId,
      email: users.email,
      displayName: users.displayName,
      role: users.role,
    })
    .from(users)
    .where(eq(users.externalId, userExternalId))
    .limit(1);
  if (!row) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'user not found' });
  }
  return row;
}

async function readOrderByExternalId(db: DB, orderExternalId: string): Promise<PartnerRechargeOrder> {
  const [row] = await db
    .select()
    .from(partnerRechargeOrders)
    .where(eq(partnerRechargeOrders.externalId, orderExternalId))
    .limit(1);
  if (!row) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'partner order not found' });
  }
  return row;
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

function metadataNumber(metadata: Record<string, unknown>, key: string): number | undefined {
  const value = metadata[key];
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined;
}

function summarizeOrderAudit(metadataValue: unknown) {
  const metadata = metadataRecord(metadataValue);
  return {
    reviewReason: metadataText(metadata, 'reviewReason'),
    reviewErrorName: metadataText(metadata, 'errorName'),
    reviewErrorMessage: metadataText(metadata, 'errorMessage'),
    reviewApprovedByUserId: metadataNumber(metadata, 'reviewApprovedByUserId'),
    reviewApprovedAt: metadataText(metadata, 'reviewApprovedAt'),
    reviewApprovalNote: metadataText(metadata, 'reviewApprovalNote'),
  };
}

function summarizeOrder(order: PartnerRechargeOrder) {
  return {
    orderExternalId: order.externalId,
    provider: order.provider,
    providerCaptureId: order.providerCaptureId,
    amountCnyCents: order.amountCnyCents,
    status: order.status,
    orderKind: order.orderKind,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    ...summarizeOrderAudit(order.metadata),
  };
}

function normalizeOverviewSearchQuery(query: string | undefined): string | undefined {
  const normalized = query?.trim();
  return normalized ? normalized : undefined;
}

function metadataLike(column: unknown, pattern: string) {
  return sql`CAST(${column} AS CHAR) LIKE ${pattern}`;
}

function userSearchCondition(pattern: string) {
  return or(
    like(users.externalId, pattern),
    like(users.email, pattern),
    like(users.displayName, pattern),
  );
}

function orderSearchCondition(pattern: string) {
  return or(
    userSearchCondition(pattern),
    like(partnerRechargeOrders.externalId, pattern),
    like(partnerRechargeOrders.status, pattern),
    like(partnerRechargeOrders.orderKind, pattern),
    like(partnerRechargeOrders.provider, pattern),
    like(partnerRechargeOrders.providerCaptureId, pattern),
    metadataLike(partnerRechargeOrders.metadata, pattern),
  );
}

function kycSearchCondition(pattern: string) {
  return or(
    userSearchCondition(pattern),
    like(partnerKycProfiles.externalId, pattern),
    like(partnerKycProfiles.status, pattern),
    like(partnerKycProfiles.country, pattern),
    like(partnerKycProfiles.provider, pattern),
    like(partnerKycProfiles.providerRef, pattern),
    metadataLike(partnerKycProfiles.metadata, pattern),
  );
}

function withdrawalSearchCondition(pattern: string) {
  return or(
    userSearchCondition(pattern),
    like(partnerWithdrawalRequests.externalId, pattern),
    like(partnerWithdrawalRequests.status, pattern),
    like(partnerWithdrawalRequests.bankAccountFingerprint, pattern),
    like(partnerWithdrawalRequests.rejectionReason, pattern),
    metadataLike(partnerWithdrawalRequests.metadata, pattern),
  );
}

function riskLotSearchCondition(pattern: string) {
  return or(
    userSearchCondition(pattern),
    like(partnerLots.externalId, pattern),
    like(partnerLots.status, pattern),
    like(partnerLots.riskStatus, pattern),
  );
}

function summarizeKycAudit(metadataValue: unknown) {
  const metadata = metadataRecord(metadataValue);
  return {
    reviewerUserId: metadataNumber(metadata, 'reviewerUserId'),
    reviewNote: metadataText(metadata, 'note'),
    reviewSource: metadataText(metadata, 'source'),
  };
}

function summarizeKycProfile<T extends { metadata?: unknown }>(profile: T) {
  const { metadata, ...row } = profile;
  return {
    ...row,
    ...summarizeKycAudit(metadata),
  };
}

function summarizeWithdrawalAudit(metadataValue: unknown) {
  const metadata = metadataRecord(metadataValue);
  return {
    approvedByUserId: metadataNumber(metadata, 'approvedByUserId'),
    approvedAt: metadataText(metadata, 'approvedAt'),
    approvalNote: metadataText(metadata, 'approvalNote'),
    rejectedByUserId: metadataNumber(metadata, 'rejectedByUserId'),
    rejectedAt: metadataText(metadata, 'rejectedAt'),
    paidByUserId: metadataNumber(metadata, 'paidByUserId'),
    providerPayoutId: metadataText(metadata, 'providerPayoutId'),
    paidAt: metadataText(metadata, 'paidAt'),
  };
}

function summarizeWithdrawal(withdrawal: PartnerWithdrawalRequest) {
  return {
    withdrawalExternalId: withdrawal.externalId,
    amountCreditCents: withdrawal.amountCreditCents,
    status: withdrawal.status,
    reviewDueAt: withdrawal.reviewDueAt,
    bankAccountFingerprint: withdrawal.bankAccountFingerprint,
    riskScore: withdrawal.riskScore,
    rejectionReason: withdrawal.rejectionReason,
    createdAt: withdrawal.createdAt,
    updatedAt: withdrawal.updatedAt,
    ...summarizeWithdrawalAudit(withdrawal.metadata),
  };
}

function summarizeWithdrawalMetrics(
  rows: Array<{ status: string; reviewDueAt: Date }>,
  now: Date,
) {
  const activeRows = rows.filter((row) => row.status === 'requested' || row.status === 'reviewing');
  return {
    pendingWithdrawalCount: activeRows.length,
    approvedWithdrawalCount: rows.filter((row) => row.status === 'approved').length,
    paidWithdrawalCount: rows.filter((row) => row.status === 'paid').length,
    rejectedWithdrawalCount: rows.filter((row) => row.status === 'rejected').length,
    returnedWithdrawalCount: rows.filter((row) => row.status === 'returned').length,
    overdueWithdrawalCount: activeRows.filter((row) => row.reviewDueAt.getTime() <= now.getTime()).length,
  };
}

function mapPaymentError(error: unknown): never {
  if (
    error instanceof PartnerPaymentConfirmConflictError ||
    error instanceof PartnerPaymentProviderCaptureConflictError
  ) {
    throw new TRPCError({ code: 'CONFLICT', message: error.message });
  }
  if (error instanceof RangeError) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
  }
  throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'partner order confirmation failed' });
}

function mapWithdrawalError(error: unknown): never {
  if (error instanceof WithdrawalTransitionError) {
    if (error.reason === 'not_found') {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'withdrawal request not found' });
    }
    if (error.reason === 'update_conflict') {
      throw new TRPCError({ code: 'CONFLICT', message: 'withdrawal request changed while reviewing' });
    }
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: error.message });
  }
  if (error instanceof RangeError) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
  }
  throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'withdrawal review failed' });
}

export const adminPartnerRouter = router({
  overview: adminProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(OVERVIEW_LIMIT_CAP).default(50),
          query: z.string().trim().max(100).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      if (!partnerLedgerEnabled()) {
        return { enabled: false as const };
      }

      const limit = input?.limit ?? 50;
      const query = normalizeOverviewSearchQuery(input?.query);
      const searchPattern = query ? `%${query}%` : undefined;
      const now = new Date();
      const [orderRows, kycRows, withdrawalRows, withdrawalHistoryRows, riskLotRows] = await Promise.all([
        ctx.db
          .select({
            orderExternalId: partnerRechargeOrders.externalId,
            userExternalId: users.externalId,
            email: users.email,
            displayName: users.displayName,
            provider: partnerRechargeOrders.provider,
            providerCaptureId: partnerRechargeOrders.providerCaptureId,
            amountCnyCents: partnerRechargeOrders.amountCnyCents,
            status: partnerRechargeOrders.status,
            orderKind: partnerRechargeOrders.orderKind,
            metadata: partnerRechargeOrders.metadata,
            createdAt: partnerRechargeOrders.createdAt,
            updatedAt: partnerRechargeOrders.updatedAt,
          })
          .from(partnerRechargeOrders)
          .innerJoin(users, eq(users.id, partnerRechargeOrders.userId))
          .where(
            and(
              inArray(partnerRechargeOrders.status, ['pending', 'review_required']),
              searchPattern ? orderSearchCondition(searchPattern) : undefined,
            ),
          )
          .orderBy(desc(partnerRechargeOrders.createdAt))
          .limit(limit),
        ctx.db
          .select({
            kycExternalId: partnerKycProfiles.externalId,
            userExternalId: users.externalId,
            email: users.email,
            displayName: users.displayName,
            status: partnerKycProfiles.status,
            country: partnerKycProfiles.country,
            provider: partnerKycProfiles.provider,
            providerRef: partnerKycProfiles.providerRef,
            reviewedAt: partnerKycProfiles.reviewedAt,
            metadata: partnerKycProfiles.metadata,
            updatedAt: partnerKycProfiles.updatedAt,
          })
          .from(partnerKycProfiles)
          .innerJoin(users, eq(users.id, partnerKycProfiles.userId))
          .where(
            and(
              inArray(partnerKycProfiles.status, ['pending', 'review_required']),
              searchPattern ? kycSearchCondition(searchPattern) : undefined,
            ),
          )
          .orderBy(desc(partnerKycProfiles.updatedAt))
          .limit(limit),
        ctx.db
          .select({
            withdrawalExternalId: partnerWithdrawalRequests.externalId,
            userExternalId: users.externalId,
            email: users.email,
            displayName: users.displayName,
            amountCreditCents: partnerWithdrawalRequests.amountCreditCents,
            status: partnerWithdrawalRequests.status,
            reviewDueAt: partnerWithdrawalRequests.reviewDueAt,
            bankAccountFingerprint: partnerWithdrawalRequests.bankAccountFingerprint,
            riskScore: partnerWithdrawalRequests.riskScore,
            rejectionReason: partnerWithdrawalRequests.rejectionReason,
            metadata: partnerWithdrawalRequests.metadata,
            createdAt: partnerWithdrawalRequests.createdAt,
            updatedAt: partnerWithdrawalRequests.updatedAt,
          })
          .from(partnerWithdrawalRequests)
          .innerJoin(users, eq(users.id, partnerWithdrawalRequests.userId))
          .where(
            and(
              inArray(partnerWithdrawalRequests.status, ['requested', 'reviewing', 'approved']),
              searchPattern ? withdrawalSearchCondition(searchPattern) : undefined,
            ),
          )
          .orderBy(desc(partnerWithdrawalRequests.reviewDueAt))
          .limit(limit),
        ctx.db
          .select({
            withdrawalExternalId: partnerWithdrawalRequests.externalId,
            userExternalId: users.externalId,
            email: users.email,
            displayName: users.displayName,
            amountCreditCents: partnerWithdrawalRequests.amountCreditCents,
            status: partnerWithdrawalRequests.status,
            reviewDueAt: partnerWithdrawalRequests.reviewDueAt,
            bankAccountFingerprint: partnerWithdrawalRequests.bankAccountFingerprint,
            riskScore: partnerWithdrawalRequests.riskScore,
            rejectionReason: partnerWithdrawalRequests.rejectionReason,
            metadata: partnerWithdrawalRequests.metadata,
            createdAt: partnerWithdrawalRequests.createdAt,
            updatedAt: partnerWithdrawalRequests.updatedAt,
          })
          .from(partnerWithdrawalRequests)
          .innerJoin(users, eq(users.id, partnerWithdrawalRequests.userId))
          .where(
            and(
              inArray(partnerWithdrawalRequests.status, ['paid', 'rejected', 'returned']),
              searchPattern ? withdrawalSearchCondition(searchPattern) : undefined,
            ),
          )
          .orderBy(desc(partnerWithdrawalRequests.updatedAt))
          .limit(limit),
        ctx.db
          .select({
            lotExternalId: partnerLots.externalId,
            userExternalId: users.externalId,
            email: users.email,
            displayName: users.displayName,
            status: partnerLots.status,
            riskStatus: partnerLots.riskStatus,
            principalCreditCents: partnerLots.principalCreditCents,
            apiUnits: partnerLots.apiUnits,
            accumulationEndsAt: partnerLots.accumulationEndsAt,
            releaseStartsAt: partnerLots.releaseStartsAt,
            updatedAt: partnerLots.updatedAt,
          })
          .from(partnerLots)
          .innerJoin(users, eq(users.id, partnerLots.userId))
          .where(
            and(
              or(inArray(partnerLots.riskStatus, ['review', 'review_required', 'frozen']), eq(partnerLots.status, 'frozen')),
              searchPattern ? riskLotSearchCondition(searchPattern) : undefined,
            ),
          )
          .orderBy(desc(partnerLots.updatedAt))
          .limit(limit),
      ]);

      const withdrawalMetrics = summarizeWithdrawalMetrics(
        [...withdrawalRows, ...withdrawalHistoryRows],
        now,
      );

      return {
        enabled: true as const,
        metrics: {
          pendingKycCount: kycRows.length,
          pendingOrderCount: orderRows.filter((row) => row.status === 'pending').length,
          reviewRequiredOrderCount: orderRows.filter((row) => row.status === 'review_required').length,
          ...withdrawalMetrics,
          riskLotCount: riskLotRows.length,
        },
        orders: orderRows.map(({ metadata, ...row }) => ({
          ...row,
          ...summarizeOrderAudit(metadata),
        })),
        kycProfiles: kycRows.map(summarizeKycProfile),
        withdrawals: withdrawalRows.map(({ metadata, ...row }) => ({
          ...row,
          ...summarizeWithdrawalAudit(metadata),
        })),
        withdrawalHistory: withdrawalHistoryRows.map(({ metadata, ...row }) => ({
          ...row,
          ...summarizeWithdrawalAudit(metadata),
        })),
        riskLots: riskLotRows,
      };
    }),

  setKycStatus: adminProcedure
    .input(
      z.object({
        userExternalId: z.string().trim().min(1).max(32),
        status: z.enum(['pending', 'passed', 'review_required', 'rejected']),
        provider: z.string().trim().min(1).max(32).default('manual'),
        providerRef: z.string().trim().min(1).max(128).optional(),
        note: z.string().trim().min(1).max(1000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requirePartnerLedgerEnabled();
      const [adminUser, targetUser] = await Promise.all([
        resolveUserByExternalId(ctx.db, ctx.userId),
        resolveUserByExternalId(ctx.db, input.userExternalId),
      ]);
      try {
        const row = await new KycService(ctx.db).upsertStatus({
          userId: targetUser.id,
          status: input.status,
          provider: input.provider,
          providerRef: input.providerRef,
          reviewerUserId: adminUser.id,
          note: input.note,
        });
        return {
          kycExternalId: row.externalId,
          userExternalId: targetUser.externalId,
          status: row.status,
          country: row.country,
          provider: row.provider,
          providerRef: row.providerRef,
          reviewedAt: row.reviewedAt,
        };
      } catch (error) {
        if (error instanceof RangeError) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
        }
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'KYC status update failed' });
      }
    }),

  confirmOrder: adminProcedure
    .input(
      z.object({
        orderExternalId: z.string().trim().min(1).max(32),
        providerCaptureId: z.string().trim().min(1).max(128).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requirePartnerLedgerEnabled();
      const order = await readOrderByExternalId(ctx.db, input.orderExternalId);
      try {
        const result = await new PartnerPaymentConfirmService(ctx.db).confirmCapturedOrder({
          orderExternalId: order.externalId,
          provider: order.provider,
          providerCaptureId: input.providerCaptureId ?? `manual:${order.externalId}`,
          amountCnyCents: order.amountCnyCents,
        });
        return result;
      } catch (error) {
        if (error instanceof PartnerPaymentConfirmReviewRequiredError) {
          return {
            ok: false as const,
            status: 'review_required' as const,
            orderExternalId: error.orderExternalId,
            orderKind: error.orderKind,
            providerCaptureId: error.providerCaptureId,
          };
        }
        return mapPaymentError(error);
      }
    }),

  approveReviewRequiredOrder: adminProcedure
    .input(
      z.object({
        orderExternalId: z.string().trim().min(1).max(32),
        note: z.string().trim().min(1).max(1000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requirePartnerLedgerEnabled();
      const adminUser = await resolveUserByExternalId(ctx.db, ctx.userId);
      try {
        return await new PartnerPaymentConfirmService(ctx.db).approveReviewRequiredOrder({
          orderExternalId: input.orderExternalId,
          reviewerUserId: adminUser.id,
          note: input.note,
        });
      } catch (error) {
        return mapPaymentError(error);
      }
    }),

  approveWithdrawal: adminProcedure
    .input(
      z.object({
        withdrawalExternalId: z.string().trim().min(1).max(32),
        note: z.string().trim().min(1).max(1000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requirePartnerLedgerEnabled();
      const adminUser = await resolveUserByExternalId(ctx.db, ctx.userId);
      try {
        const row = await new WithdrawalService(ctx.db).approveWithdrawal({
          withdrawalExternalId: input.withdrawalExternalId,
          reviewerUserId: adminUser.id,
          note: input.note,
        });
        return summarizeWithdrawal(row);
      } catch (error) {
        return mapWithdrawalError(error);
      }
    }),

  rejectWithdrawal: adminProcedure
    .input(
      z.object({
        withdrawalExternalId: z.string().trim().min(1).max(32),
        reason: z.string().trim().min(1).max(1000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requirePartnerLedgerEnabled();
      const adminUser = await resolveUserByExternalId(ctx.db, ctx.userId);
      try {
        const row = await new WithdrawalService(ctx.db).rejectWithdrawal({
          withdrawalExternalId: input.withdrawalExternalId,
          reviewerUserId: adminUser.id,
          reason: input.reason,
        });
        return summarizeWithdrawal(row);
      } catch (error) {
        return mapWithdrawalError(error);
      }
    }),

  markWithdrawalPaid: adminProcedure
    .input(
      z.object({
        withdrawalExternalId: z.string().trim().min(1).max(32),
        providerPayoutId: z.string().trim().min(1).max(128),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requirePartnerLedgerEnabled();
      const adminUser = await resolveUserByExternalId(ctx.db, ctx.userId);
      try {
        const row = await new WithdrawalService(ctx.db).markWithdrawalPaid({
          withdrawalExternalId: input.withdrawalExternalId,
          reviewerUserId: adminUser.id,
          providerPayoutId: input.providerPayoutId,
        });
        return summarizeWithdrawal(row);
      } catch (error) {
        return mapWithdrawalError(error);
      }
    }),
});

export const __adminPartnerInternals = {
  summarizeKycProfile,
  summarizeOrder,
  summarizeWithdrawal,
  summarizeWithdrawalMetrics,
};
