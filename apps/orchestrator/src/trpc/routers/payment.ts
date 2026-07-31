/**
 * Payment router — kicks off and finalises PayPal Checkout flows.
 *
 * Two mutations the SPA calls:
 *   - createOrder({ plan }) → { paymentId, orderId, approveUrl }
 *       Inserts a `payments` row in status='pending' so the webhook
 *       and capture can reconcile by externalId regardless of which
 *       arrives first.
 *   - captureOrder({ paymentId, orderId }) → { ok, plan }
 *       Synchronous capture from the SPA after the user approves in
 *       the PayPal popup. Idempotent: a second call returns the same
 *       result without double-charging or stacking expiries.
 *
 * Anything that requires the gateway's word-of-truth (refunds,
 * disputed captures, async settlement) lands via the webhook in
 * http.ts. The two paths agree by keying every write on PayPal's
 * order id + capture id.
 */

import {
  ADDON_PACK_CATALOGUE,
  ADDON_PACK_IDS,
  type AddonPackId,
  type BillingCycle,
  type PlanId,
  getAddonPackPriceCents,
  getPlanPriceCents,
  isAddonPackId,
  newExternalId,
} from '@holaday/shared-types';
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '../../db/client.js';
import { readAffectedRows } from '../../db/mysql-result.js';
import { type Payment, payments } from '../../db/schema/payments.js';
import { users } from '../../db/schema/users.js';
import { describePlanOrder, isPaidPlan, nextExpiryFor } from '../../payment/plans.js';
import { QuotaService } from '../../quota/quota-service.js';
import { protectedProcedure, publicProcedure, router } from '../trpc.js';

const createOrderInput = z.object({
  plan: z.enum(['basic', 'pro']),
  /**
   * Billing cycle. `monthly` is 30 days, `yearly` is 365 with a built-in
   * ~17% discount baked into the catalogue prices. Yearly does not
   * stack with the firstMonth promo (the savings already live in the
   * yearly rate).
   */
  cycle: z.enum(['monthly', 'yearly']).default('monthly'),
});

const captureOrderInput = z.object({
  paymentId: z.string().min(1),
  orderId: z.string().min(1),
});

const createAddonOrderInput = z.object({
  packId: z.enum(ADDON_PACK_IDS),
});

type PaymentTransaction = Parameters<Parameters<DB['transaction']>[0]>[0];

interface SettlementContext {
  readonly user: {
    readonly id: number;
    readonly plan: string;
    readonly planExpiresAt: Date | null;
  };
  readonly cycle: BillingCycle;
  readonly firstMonthRequested: boolean;
  readonly firstMonthEligible: boolean;
}

function paymentMetadata(row: Pick<Payment, 'metadata'>): Record<string, unknown> {
  return (row.metadata as Record<string, unknown> | null) ?? {};
}

function isPendingFirstMonthPayment(row: Payment): boolean {
  const metadata = paymentMetadata(row);
  return (
    row.kind === 'subscription' &&
    row.status === 'pending' &&
    metadata.firstMonth === true &&
    metadata.cycle !== 'yearly'
  );
}

async function lockSubscriptionPayments(
  tx: PaymentTransaction,
  userExternalId: string,
): Promise<Payment[]> {
  return tx
    .select()
    .from(payments)
    .where(and(eq(payments.userExternalId, userExternalId), eq(payments.kind, 'subscription')))
    .for('update');
}

export async function lockSettlementContext(
  tx: PaymentTransaction,
  row: Payment,
): Promise<SettlementContext> {
  const [user] = await tx
    .select({
      id: users.id,
      plan: users.plan,
      planExpiresAt: users.planExpiresAt,
    })
    .from(users)
    .where(eq(users.externalId, row.userExternalId))
    .limit(1)
    .for('update');
  if (!user) {
    throw new TRPCError({ code: 'NOT_FOUND', message: '用户不存在' });
  }

  const metadata = paymentMetadata(row);
  const cycle: BillingCycle = metadata.cycle === 'yearly' ? 'yearly' : 'monthly';
  const firstMonthRequested =
    row.kind === 'subscription' && cycle === 'monthly' && metadata.firstMonth === true;
  let firstMonthEligible = false;
  if (firstMonthRequested) {
    const subscriptionPayments = await lockSubscriptionPayments(tx, row.userExternalId);
    firstMonthEligible =
      user.plan === 'free' &&
      !subscriptionPayments.some(
        (candidate) =>
          candidate.id !== row.id &&
          candidate.kind === 'subscription' &&
          candidate.status === 'completed',
      );
  }

  return {
    user,
    cycle,
    firstMonthRequested,
    firstMonthEligible,
  };
}

export async function completePaymentInTransaction(
  tx: PaymentTransaction,
  row: Payment,
  settlement: SettlementContext,
  capture: {
    readonly captureId: string;
    readonly payerEmail?: string | null;
    readonly captureStatus: string;
    readonly metadata?: Record<string, unknown>;
  },
): Promise<boolean> {
  const metadata = paymentMetadata(row);
  const firstMonthConsumed = settlement.firstMonthRequested && settlement.firstMonthEligible;
  const updateResult = await tx
    .update(payments)
    .set({
      status: 'completed',
      completedAt: new Date(),
      providerCaptureId: capture.captureId,
      metadata: {
        ...metadata,
        ...capture.metadata,
        payerEmail: capture.payerEmail,
        captureStatus: capture.captureStatus,
        firstMonthConsumed,
      },
    })
    .where(and(eq(payments.id, row.id), eq(payments.status, 'pending')));
  if (readAffectedRows(updateResult) !== 1) return false;

  const quotaService = new QuotaService(tx as unknown as DB);
  if (row.kind === 'addon') {
    if (!isAddonPackId(row.plan)) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'addon 订单 plan 字段非法',
      });
    }
    const planId: PlanId =
      settlement.user.plan === 'basic' || settlement.user.plan === 'pro'
        ? settlement.user.plan
        : 'free';
    if (planId === 'free') {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: '当前账户已降级，加量包未生效',
      });
    }
    await quotaService.applyAddonPack(settlement.user.id, planId, row.plan as AddonPackId);
    return true;
  }

  const nextExpiry = nextExpiryFor(
    row.plan as 'basic' | 'pro',
    settlement.cycle,
    settlement.user.planExpiresAt,
  );
  await tx
    .update(users)
    .set({ plan: row.plan, planExpiresAt: nextExpiry })
    .where(eq(users.externalId, row.userExternalId));
  if (firstMonthConsumed) {
    await quotaService.grantFirstMonthBonus(settlement.user.id, row.plan as PlanId);
  }
  return true;
}

export const paymentRouter = router({
  /**
   * Tells the SPA whether the PayPal lane is wired this deploy. The
   * frontend hides the PayPal button when the answer is false, the
   * same way auth.loginOptions hides the Google button.
   *
   * `paypalClientId` is intentionally exposed — it goes into the
   * PayPal JS SDK URL, which is public-facing by design (the secret
   * is the *client secret*, which never leaves the server).
   */
  options: publicProcedure.query(({ ctx }) => ({
    paypal: Boolean(ctx.paypalAdapter),
    paypalEnv: ctx.paypalAdapter?.env ?? null,
    paypalClientId: ctx.paypalAdapter ? (process.env.PAYPAL_CLIENT_ID ?? null) : null,
  })),

  createOrder: protectedProcedure.input(createOrderInput).mutation(async ({ ctx, input }) => {
    if (!ctx.paypalAdapter) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'PayPal 暂未配置（PAYPAL_CLIENT_ID / _SECRET 未设置）',
      });
    }
    const paypalAdapter = ctx.paypalAdapter;
    const userExternalId = ctx.userId;
    if (!userExternalId) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
    }
    if (!isPaidPlan(input.plan)) {
      // The zod input narrows to 'basic' | 'pro' already, but keep this
      // defensive in case the enum widens.
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'free 套餐无需支付' });
    }

    return ctx.db.transaction(async (tx) => {
      const [user] = await tx
        .select()
        .from(users)
        .where(eq(users.externalId, userExternalId))
        .limit(1)
        .for('update');
      if (!user) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
      }
      const subscriptionPayments = await lockSubscriptionPayments(tx, user.externalId);
      const isFirstMonth =
        input.cycle === 'monthly' &&
        user.plan === 'free' &&
        !subscriptionPayments.some((row) => row.status === 'completed');

      if (isFirstMonth) {
        const pending = subscriptionPayments.find(isPendingFirstMonthPayment);
        if (pending) {
          const metadata = paymentMetadata(pending);
          if (
            pending.provider === 'paypal' &&
            pending.plan === input.plan &&
            metadata.cycle === input.cycle &&
            typeof metadata.approveUrl === 'string' &&
            pending.providerOrderId
          ) {
            return {
              paymentId: pending.externalId,
              orderId: pending.providerOrderId,
              approveUrl: metadata.approveUrl,
            };
          }
          throw new TRPCError({
            code: 'CONFLICT',
            message: '已有首月优惠订单待支付，请先完成或取消该订单',
          });
        }
      }

      const amountCents = getPlanPriceCents(input.plan, input.cycle, 'usd', isFirstMonth);
      const externalId = newExternalId('payment');
      const origin = `${ctx.req.protocol}://${ctx.req.get('host')}`;
      const order = await paypalAdapter.createOrder({
        amountCents,
        currency: 'USD',
        referenceId: externalId,
        description: describePlanOrder(input.plan, input.cycle),
        returnUrl: `${origin}/billing/return?payment=${externalId}`,
        cancelUrl: `${origin}/billing/cancel?payment=${externalId}`,
      });

      await tx.insert(payments).values({
        externalId,
        userExternalId: user.externalId,
        provider: 'paypal',
        providerOrderId: order.orderId,
        plan: input.plan,
        kind: 'subscription',
        amountCents,
        currency: 'USD',
        status: 'pending',
        metadata: {
          env: paypalAdapter.env,
          cycle: input.cycle,
          firstMonth: isFirstMonth,
          approveUrl: order.approveUrl,
        },
      });

      return {
        paymentId: externalId,
        orderId: order.orderId,
        approveUrl: order.approveUrl,
      };
    });
  }),

  captureOrder: protectedProcedure.input(captureOrderInput).mutation(async ({ ctx, input }) => {
    if (!ctx.paypalAdapter) {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'PayPal 未配置' });
    }
    const paypalAdapter = ctx.paypalAdapter;
    const [row] = await ctx.db
      .select()
      .from(payments)
      .where(eq(payments.externalId, input.paymentId))
      .limit(1);
    if (!row) {
      throw new TRPCError({ code: 'NOT_FOUND', message: '支付订单不存在' });
    }
    if (row.userExternalId !== ctx.userId) {
      // Returning 404 on purpose: don't tell a probing user that this
      // payment id belongs to someone else.
      throw new TRPCError({ code: 'NOT_FOUND', message: '支付订单不存在' });
    }
    if (row.providerOrderId !== input.orderId) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: '订单号不匹配' });
    }

    const result = await ctx.db.transaction(async (tx) => {
      // Lock order is always user -> payment(s), matching createOrder /
      // createCnOrder and the HTTP callback paths. Keeping one global
      // order avoids a create-vs-capture deadlock under concurrency.
      const settlement = await lockSettlementContext(tx, row);
      const [lockedRow] = await tx
        .select()
        .from(payments)
        .where(eq(payments.id, row.id))
        .limit(1)
        .for('update');
      if (!lockedRow) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '支付订单不存在' });
      }
      if (lockedRow.status === 'completed') {
        return { kind: 'completed' as const };
      }
      if (lockedRow.status !== 'pending') {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `支付订单当前状态不可结算：${lockedRow.status}`,
        });
      }
      if (settlement.firstMonthRequested && !settlement.firstMonthEligible) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: '首月优惠资格已被其他订单使用，请重新下单',
        });
      }
      if (
        lockedRow.kind === 'addon' &&
        settlement.user.plan !== 'basic' &&
        settlement.user.plan !== 'pro'
      ) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: '当前账户已降级，加量包未生效',
        });
      }

      const capture = await paypalAdapter.captureOrder(input.orderId);
      if (capture.status !== 'COMPLETED') {
        const nextStatus = capture.status === 'DECLINED' ? 'failed' : 'pending';
        await tx
          .update(payments)
          .set({
            status: nextStatus,
            providerCaptureId: capture.captureId || null,
            metadata: {
              ...paymentMetadata(lockedRow),
              lastCaptureStatus: capture.status,
              payerEmail: capture.payerEmail,
            },
          })
          .where(eq(payments.id, lockedRow.id));
        return { kind: 'incomplete' as const, status: capture.status };
      }
      if (
        capture.amountCents !== lockedRow.amountCents ||
        capture.currency.toUpperCase() !== lockedRow.currency.toUpperCase()
      ) {
        ctx.logger.error(
          {
            paymentId: lockedRow.externalId,
            expectedAmountCents: lockedRow.amountCents,
            capturedAmountCents: capture.amountCents,
            expectedCurrency: lockedRow.currency,
            capturedCurrency: capture.currency,
          },
          'paypal capture settlement mismatch',
        );
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'PayPal 结算金额或币种与订单不一致，请联系客服核查',
        });
      }

      const completed = await completePaymentInTransaction(tx, lockedRow, settlement, {
        captureId: capture.captureId,
        payerEmail: capture.payerEmail,
        captureStatus: capture.status,
      });
      return { kind: completed ? ('completed' as const) : ('deduped' as const) };
    });

    if (result.kind === 'incomplete') {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `PayPal 状态：${result.status}`,
      });
    }
    return { ok: true as const, plan: row.plan };
  }),

  /**
   * Add-on pack order — one-time purchase that tops up the active
   * billing period's bonus quota. Only valid for users on a paid
   * plan; `pack-50-opus` further requires Pro since Basic has no
   * Opus quota at all.
   *
   * Reuses captureOrder (above) for finalisation — that procedure
   * branches on `row.kind` and routes addon captures into
   * QuotaService.applyAddonPack instead of the plan-extension path.
   */
  createAddonOrder: protectedProcedure
    .input(createAddonOrderInput)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.paypalAdapter) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'PayPal 暂未配置（PAYPAL_CLIENT_ID / _SECRET 未设置）',
        });
      }
      const userExternalId = ctx.userId;
      if (!userExternalId) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
      }
      const pack = ADDON_PACK_CATALOGUE[input.packId];
      if (!pack) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: '加量包不存在' });
      }

      const [user] = await ctx.db
        .select()
        .from(users)
        .where(eq(users.externalId, userExternalId))
        .limit(1);
      if (!user) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
      }
      const planId: PlanId = user.plan === 'basic' || user.plan === 'pro' ? user.plan : 'free';
      if (planId === 'free') {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: '加量包仅对付费用户开放，请先升级到基础版',
        });
      }
      if (!pack.availableTo.includes(planId)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Opus 加量包仅专业版可购买',
        });
      }

      const amountCents = getAddonPackPriceCents(input.packId, 'usd');
      const externalId = newExternalId('payment');
      const origin = `${ctx.req.protocol}://${ctx.req.get('host')}`;

      const order = await ctx.paypalAdapter.createOrder({
        amountCents,
        currency: 'USD',
        referenceId: externalId,
        description: pack.nameEn,
        returnUrl: `${origin}/billing/return?payment=${externalId}`,
        cancelUrl: `${origin}/billing/cancel?payment=${externalId}`,
      });

      await ctx.db.insert(payments).values({
        externalId,
        userExternalId: user.externalId,
        provider: 'paypal',
        providerOrderId: order.orderId,
        // Reuse the `plan` column to carry the pack id — the `kind`
        // discriminator below tells captureOrder how to interpret it.
        // Saves a schema migration for a single id column.
        plan: input.packId,
        kind: 'addon',
        amountCents,
        currency: 'USD',
        status: 'pending',
        metadata: { env: ctx.paypalAdapter.env, packId: input.packId },
      });

      return {
        paymentId: externalId,
        orderId: order.orderId,
        approveUrl: order.approveUrl,
      };
    }),

  // ----------------------------------------------------------------
  // Phase 11 — China gateway proxies. The actual WX/Alipay calls
  // happen on hd-pay.orangebench.tech (Aliyun); this router just
  // forwards the click event with the user id derived from the
  // bearer token, then polls the local payments table for status.
  //
  // All three procs gracefully no-op when the gateway URL or
  // shared secret aren't configured (CN_PAYMENT_URL /
  // INTERNAL_SHARED_SECRET unset). cnOptions.enabled drives the
  // SPA's "show 微信/支付宝 buttons or not" decision; mirrors the
  // existing payment.options shape for PayPal.
  // ----------------------------------------------------------------
  cnOptions: publicProcedure.query(() => ({
    enabled: Boolean(process.env.CN_PAYMENT_URL && process.env.INTERNAL_SHARED_SECRET),
  })),
  createCnOrder: protectedProcedure
    .input(
      z.object({
        provider: z.enum(['wechat', 'alipay']),
        purchase: z.discriminatedUnion('kind', [
          z.object({
            kind: z.literal('subscription'),
            planId: z.enum(['basic', 'pro']),
            cycle: z.enum(['monthly', 'yearly']).default('monthly'),
          }),
          z.object({ kind: z.literal('addon'), packId: z.enum(ADDON_PACK_IDS) }),
        ]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const cnUrl = process.env.CN_PAYMENT_URL;
      const secret = process.env.INTERNAL_SHARED_SECRET;
      if (!cnUrl || !secret) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: '微信/支付宝 暂未配置（CN_PAYMENT_URL / INTERNAL_SHARED_SECRET 未设置）',
        });
      }
      const userExternalId = ctx.userId;
      if (!userExternalId) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
      }
      return ctx.db.transaction(async (tx) => {
        const [user] = await tx
          .select()
          .from(users)
          .where(eq(users.externalId, userExternalId))
          .limit(1)
          .for('update');
        if (!user) {
          throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
        }

        let isFirstMonth = false;
        if (input.purchase.kind === 'subscription') {
          const subscriptionPayments = await lockSubscriptionPayments(tx, user.externalId);
          isFirstMonth =
            input.purchase.cycle === 'monthly' &&
            user.plan === 'free' &&
            !subscriptionPayments.some((row) => row.status === 'completed');
          if (isFirstMonth) {
            const pending = subscriptionPayments.find(isPendingFirstMonthPayment);
            if (pending) {
              const metadata = paymentMetadata(pending);
              if (
                pending.provider === input.provider &&
                pending.plan === input.purchase.planId &&
                metadata.cycle === input.purchase.cycle &&
                metadata.checkout &&
                typeof metadata.checkout === 'object'
              ) {
                return metadata.checkout as Record<string, unknown>;
              }
              throw new TRPCError({
                code: 'CONFLICT',
                message: '已有首月优惠订单待支付，请先完成或取消该订单',
              });
            }
          }
        } else {
          const planId: PlanId = user.plan === 'basic' || user.plan === 'pro' ? user.plan : 'free';
          const pack = ADDON_PACK_CATALOGUE[input.purchase.packId];
          if (planId === 'free') {
            throw new TRPCError({
              code: 'PRECONDITION_FAILED',
              message: '加量包仅对付费用户开放，请先升级到基础版',
            });
          }
          if (!pack.availableTo.includes(planId)) {
            throw new TRPCError({
              code: 'FORBIDDEN',
              message: 'Opus 加量包仅专业版可购买',
            });
          }
        }

        const purchase =
          input.purchase.kind === 'subscription'
            ? {
                kind: 'subscription' as const,
                planId: input.purchase.planId,
                cycle: input.purchase.cycle,
                isFirstMonth,
              }
            : {
                kind: 'addon' as const,
                packId: input.purchase.packId,
              };
        const response = await fetch(`${cnUrl.replace(/\/$/, '')}/payment/create`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-internal-secret': secret,
          },
          body: JSON.stringify({
            provider: input.provider,
            userId: userExternalId,
            purchase,
          }),
        });
        if (!response.ok) {
          const body = await response.text();
          ctx.logger.warn(
            { status: response.status, body: body.slice(0, 400) },
            'cn-payment: create call failed',
          );
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: `cn-payment ${response.status}: ${body.slice(0, 200)}`,
          });
        }

        const data = (await response.json()) as Record<string, unknown>;
        const outTradeNo = data.outTradeNo;
        const amountCents = data.amountCents;
        const expectedAmount =
          input.purchase.kind === 'subscription'
            ? getPlanPriceCents(input.purchase.planId, input.purchase.cycle, 'cny', isFirstMonth)
            : getAddonPackPriceCents(input.purchase.packId, 'cny');
        if (
          data.provider !== input.provider ||
          typeof outTradeNo !== 'string' ||
          !outTradeNo ||
          amountCents !== expectedAmount
        ) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'cn-payment 返回了不匹配的订单',
          });
        }

        await tx.insert(payments).values({
          externalId: outTradeNo,
          userExternalId: user.externalId,
          provider: input.provider,
          providerOrderId: outTradeNo,
          plan:
            input.purchase.kind === 'subscription' ? input.purchase.planId : input.purchase.packId,
          kind: input.purchase.kind,
          amountCents: expectedAmount,
          currency: 'CNY',
          status: 'pending',
          metadata:
            input.purchase.kind === 'subscription'
              ? {
                  cycle: input.purchase.cycle,
                  firstMonth: isFirstMonth,
                  checkout: data,
                  source: 'cn-payment-create',
                }
              : {
                  packId: input.purchase.packId,
                  checkout: data,
                  source: 'cn-payment-create',
                },
        });
        return data;
      });
    }),
  /**
   * Polled by the SPA after the user scans / pays. Returns 'pending'
   * until the gateway calls back to /api/internal/payment/confirm
   * (which writes the payments row), then 'completed' / 'failed'.
   *
   * The SPA polls every 3s for up to ~10min, then gives up — long
   * enough for slow wallets and bank confirmations.
   */
  cnStatus: protectedProcedure
    .input(z.object({ outTradeNo: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      // outTradeNo is the per-order id we generate at create-time;
      // /internal/payment/confirm stores it to provider_order_id, so
      // that's the column we look up here. (The capture-id column
      // holds the gateway's transactionId, used for idempotency on
      // confirm retries — different concern.)
      const [row] = await ctx.db
        .select({
          status: payments.status,
          plan: payments.plan,
          kind: payments.kind,
          userExternalId: payments.userExternalId,
        })
        .from(payments)
        .where(
          and(
            eq(payments.providerOrderId, input.outTradeNo),
            eq(payments.userExternalId, ctx.userId),
          ),
        )
        .limit(1);
      // Until the cn-payment gateway POSTs to /api/internal/payment/
      // confirm, no row exists for this outTradeNo. Surface 'pending'
      // so the SPA keeps polling.
      if (!row || row.userExternalId !== ctx.userId) return { status: 'pending' as const };
      return {
        status: row.status as 'pending' | 'completed' | 'failed',
        plan: row.plan,
        kind: row.kind ?? 'subscription',
      };
    }),
});
