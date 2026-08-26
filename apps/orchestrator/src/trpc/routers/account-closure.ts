import { createHash } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { AccountClosureChallengeService } from '../../account-closure/challenge-service.js';
import { createDatabaseReceiptService } from '../../account-closure/receipt-service.js';
import {
  type AccountClosureService,
  createAccountClosureService,
  defaultAccountClosureServiceDependencies,
} from '../../account-closure/service.js';
import { SmsGatewayClient } from '../../account-closure/sms-gateway-client.js';
import { ACCOUNT_CLOSURE_REASON_CODES } from '../../account-closure/types.js';
import { privateResendSender } from '../../auth/email-code.js';
import { MfaService } from '../../auth/mfa-service.js';
import { env } from '../../config/env.js';
import { DATA_CATEGORY_IDS } from '../../data-governance/types.js';
import { tryAcquire as rateLimitTryAcquire } from '../../quota/rate-limiter.js';
import type { Context } from '../context.js';
import { protectedProcedure, publicProcedure, router } from '../trpc.js';

export const closureReasonSchema = z.enum(ACCOUNT_CLOSURE_REASON_CODES);

const acknowledgementSchema = z
  .object({
    immediateSignOut: z.literal(true),
    runningWorkStops: z.literal(true),
    noAutomaticRefund: z.literal(true),
  })
  .strict();

export const beginClosureSchema = z
  .object({
    challengeId: z.string().min(1),
    code: z.string().regex(/^\d{6}$/),
    mfaCode: z.string().min(6).max(12).optional(),
    reasonCode: closureReasonSchema.optional(),
    acknowledgements: acknowledgementSchema,
  })
  .strict();

export const recoveryTokenSchema = z
  .object({ recoveryToken: z.string().min(1).max(4096) })
  .strict();

export const cancelClosureSchema = recoveryTokenSchema
  .extend({
    challengeId: z.string().min(1),
    code: z.string().regex(/^\d{6}$/),
    mfaCode: z.string().min(6).max(12).optional(),
  })
  .strict();

const categoryIdSchema = z.enum(DATA_CATEGORY_IDS);
const challengeDeliverySchema = z
  .object({
    challengeId: z.string().min(1),
    channel: z.enum(['email', 'sms']),
    maskedDestination: z.string().min(1),
    expiresAt: z.string().datetime(),
  })
  .strict();

const previewSchema = z
  .object({
    graceEndsAt: z.string().datetime(),
    plan: z.object({ name: z.string(), expiresAt: z.string().datetime().nullable() }).strict(),
    counts: z
      .object({
        activeTasks: z.number().int().nonnegative(),
        futureTasks: z.number().int().nonnegative(),
        files: z.number().int().nonnegative(),
        stockItems: z.number().int().nonnegative(),
        notificationChannels: z.number().int().nonnegative(),
      })
      .strict(),
    retainedCategoryIds: z.array(categoryIdSchema),
    automaticRefund: z.literal(false),
  })
  .strict();

const beginResultSchema = z
  .object({
    recoveryToken: z.string().min(1),
    requestStatus: z.literal('pending_grace'),
    graceEndsAt: z.string().datetime(),
    receipt: z.object({ receiptNumber: z.string().min(1) }).strict(),
  })
  .strict();

const statusResultSchema = z
  .object({
    requestStatus: z.enum(['pending_grace', 'processing', 'needs_attention', 'completed']),
    requestedAt: z.string().datetime(),
    graceEndsAt: z.string().datetime(),
    completedAt: z.string().datetime().nullable(),
    cancelledAt: z.string().datetime().nullable(),
    canCancel: z.boolean(),
    plan: z.object({ name: z.string(), expiresAt: z.string().datetime().nullable() }).strict(),
    mfaRequired: z.boolean(),
  })
  .strict();

const applicationReceiptSchema = z
  .object({
    receiptNumber: z.string().min(1),
    kind: z.literal('application'),
    issuedAt: z.string().datetime(),
    completedCategoryIds: z.array(categoryIdSchema),
    restrictedCategoryIds: z.array(categoryIdSchema),
  })
  .strict();

export interface AccountClosureApi {
  preview(userExternalId: string): ReturnType<AccountClosureService['preview']>;
  requestVerification(
    userExternalId: string,
  ): ReturnType<AccountClosureService['requestVerification']>;
  begin(
    userExternalId: string,
    input: z.infer<typeof beginClosureSchema>,
  ): ReturnType<AccountClosureService['begin']>;
  status(recoveryToken: string): ReturnType<AccountClosureService['status']>;
  requestCancellationVerification(
    recoveryToken: string,
  ): ReturnType<AccountClosureService['requestCancellationVerification']>;
  cancel(
    recoveryToken: string,
    input: Omit<z.infer<typeof cancelClosureSchema>, 'recoveryToken'>,
  ): ReturnType<AccountClosureService['cancel']>;
  applicationReceipt(
    recoveryToken: string,
  ): ReturnType<AccountClosureService['applicationReceipt']>;
}

interface AccountClosureRouterDeps {
  createService(ctx: Context): AccountClosureApi;
  rateLimit(bucket: string, limit: { readonly windowMs: number; readonly max: number }): boolean;
}

const defaultDeps: AccountClosureRouterDeps = {
  createService(ctx) {
    const challenge = new AccountClosureChallengeService(ctx.db, {
      emailSender: privateResendSender,
      smsGateway: new SmsGatewayClient({
        baseUrl: process.env.ALIYUN_SMS_URL?.trim() || 'http://127.0.0.1:1',
        internalSecret: process.env.INTERNAL_SHARED_SECRET?.trim() || '',
      }),
      logger: ctx.logger,
    });
    return createAccountClosureService(
      defaultAccountClosureServiceDependencies({
        db: ctx.db,
        challenge,
        mfa: new MfaService(ctx.db),
        receipts: createDatabaseReceiptService(ctx.db),
        logger: ctx.logger,
        enabled: env.ACCOUNT_CLOSURE_ENABLED,
        allowlist: env.ACCOUNT_CLOSURE_ALLOWLIST,
      }),
    );
  },
  rateLimit(bucket, limit) {
    return rateLimitTryAcquire(bucket, limit).ok;
  },
};

const VERIFY_RATE = { windowMs: 10 * 60_000, max: 3 } as const;
const SUBMIT_RATE = { windowMs: 10 * 60_000, max: 5 } as const;

export function createAccountClosureRouter(overrides: Partial<AccountClosureRouterDeps> = {}) {
  const deps = { ...defaultDeps, ...overrides };
  return router({
    preview: protectedProcedure
      .input(z.undefined())
      .output(previewSchema)
      .query(({ ctx }) => genericOperation(() => deps.createService(ctx).preview(ctx.userId))),

    requestVerification: protectedProcedure
      .input(z.undefined())
      .output(challengeDeliverySchema)
      .mutation(({ ctx }) => {
        requireRateLimit(deps, `account-closure:begin-code:${ctx.userId}`, VERIFY_RATE);
        return genericOperation(() => deps.createService(ctx).requestVerification(ctx.userId));
      }),

    begin: protectedProcedure
      .input(beginClosureSchema)
      .output(beginResultSchema)
      .mutation(({ ctx, input }) => {
        requireRateLimit(deps, `account-closure:begin:${ctx.userId}`, SUBMIT_RATE);
        return genericOperation(() => deps.createService(ctx).begin(ctx.userId, input));
      }),

    status: publicProcedure
      .input(recoveryTokenSchema)
      .output(statusResultSchema)
      .query(({ ctx, input }) =>
        genericOperation(() => deps.createService(ctx).status(input.recoveryToken)),
      ),

    requestCancellationVerification: publicProcedure
      .input(recoveryTokenSchema)
      .output(challengeDeliverySchema)
      .mutation(({ ctx, input }) => {
        requireRateLimit(
          deps,
          `account-closure:cancel-code:${tokenBucket(input.recoveryToken)}`,
          VERIFY_RATE,
        );
        return genericOperation(() =>
          deps.createService(ctx).requestCancellationVerification(input.recoveryToken),
        );
      }),

    cancel: publicProcedure
      .input(cancelClosureSchema)
      .output(z.object({ cancelled: z.literal(true) }).strict())
      .mutation(({ ctx, input }) => {
        requireRateLimit(
          deps,
          `account-closure:cancel:${tokenBucket(input.recoveryToken)}`,
          SUBMIT_RATE,
        );
        const { recoveryToken, ...verification } = input;
        return genericOperation(() => deps.createService(ctx).cancel(recoveryToken, verification));
      }),

    applicationReceipt: publicProcedure
      .input(recoveryTokenSchema)
      .output(applicationReceiptSchema)
      .query(({ ctx, input }) =>
        genericOperation(() => deps.createService(ctx).applicationReceipt(input.recoveryToken)),
      ),
  });
}

export const accountClosureRouter = createAccountClosureRouter();

function requireRateLimit(
  deps: AccountClosureRouterDeps,
  bucket: string,
  limit: { readonly windowMs: number; readonly max: number },
): void {
  if (deps.rateLimit(bucket, limit)) return;
  throw new TRPCError({
    code: 'TOO_MANY_REQUESTS',
    message: '操作过于频繁，请稍后再试',
  });
}

async function genericOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: '无法完成账号关闭操作',
    });
  }
}

function tokenBucket(token: string): string {
  return createHash('sha256').update(token).digest('base64url').slice(0, 24);
}
