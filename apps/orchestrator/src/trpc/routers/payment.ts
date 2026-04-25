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

import { newExternalId } from '@holaday/shared-types';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { describePlanOrder, isPaidPlan, nextExpiryFor } from '../../payment/plans.js';
import { payments } from '../../db/schema/payments.js';
import { users } from '../../db/schema/users.js';
import { protectedProcedure, publicProcedure, router } from '../trpc.js';

const createOrderInput = z.object({
  plan: z.enum(['basic', 'pro']),
});

const captureOrderInput = z.object({
  paymentId: z.string().min(1),
  orderId: z.string().min(1),
});

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
    if (!isPaidPlan(input.plan)) {
      // The zod input narrows to 'basic' | 'pro' already, but keep this
      // defensive in case the enum widens.
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'free 套餐无需支付' });
    }

    const [user] = await ctx.db
      .select()
      .from(users)
      .where(eq(users.externalId, ctx.userId!))
      .limit(1);
    if (!user) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
    }

    const externalId = newExternalId('payment');
    const planDef = await import('@holaday/shared-types').then((m) => m.PLAN_CATALOGUE[input.plan]);
    const origin = ctx.req.protocol + '://' + ctx.req.get('host');

    const order = await ctx.paypalAdapter.createOrder({
      amountCents: planDef.usdAmountCents,
      currency: 'USD',
      referenceId: externalId,
      description: describePlanOrder(input.plan),
      // Approval popup posts back to these URLs. The SPA listens for the
      // popup-close event and triggers captureOrder via tRPC; the
      // return/cancel pages just need to exist + not 404.
      returnUrl: `${origin}/billing/return?payment=${externalId}`,
      cancelUrl: `${origin}/billing/cancel?payment=${externalId}`,
    });

    await ctx.db.insert(payments).values({
      externalId,
      userExternalId: user.externalId,
      provider: 'paypal',
      providerOrderId: order.orderId,
      plan: input.plan,
      amountCents: planDef.usdAmountCents,
      currency: 'USD',
      status: 'pending',
      metadata: { env: ctx.paypalAdapter.env },
    });

    return {
      paymentId: externalId,
      orderId: order.orderId,
      approveUrl: order.approveUrl,
    };
  }),

  captureOrder: protectedProcedure.input(captureOrderInput).mutation(async ({ ctx, input }) => {
    if (!ctx.paypalAdapter) {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'PayPal 未配置' });
    }
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

    // Already finalised (webhook beat us, or user double-clicked)?
    if (row.status === 'completed') {
      return { ok: true as const, plan: row.plan };
    }

    const capture = await ctx.paypalAdapter.captureOrder(input.orderId);
    if (capture.status !== 'COMPLETED') {
      // Only mark failed for terminal capture statuses; PENDING means
      // PayPal still has it under review and the webhook will resolve.
      const nextStatus = capture.status === 'DECLINED' ? 'failed' : 'pending';
      await ctx.db
        .update(payments)
        .set({
          status: nextStatus,
          providerCaptureId: capture.captureId || null,
          metadata: {
            ...(row.metadata as Record<string, unknown> | null),
            lastCaptureStatus: capture.status,
            payerEmail: capture.payerEmail,
          },
        })
        .where(eq(payments.id, row.id));
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `PayPal 状态：${capture.status}`,
      });
    }

    // Capture succeeded — flip the row, extend the user's plan.
    const [planRow] = await ctx.db
      .select({ planExpiresAt: users.planExpiresAt })
      .from(users)
      .where(eq(users.externalId, row.userExternalId))
      .limit(1);
    const nextExpiry = nextExpiryFor(row.plan as 'basic' | 'pro', planRow?.planExpiresAt ?? null);

    await ctx.db.transaction(async (tx) => {
      await tx
        .update(payments)
        .set({
          status: 'completed',
          providerCaptureId: capture.captureId,
          metadata: {
            ...(row.metadata as Record<string, unknown> | null),
            payerEmail: capture.payerEmail,
            captureStatus: capture.status,
          },
        })
        .where(eq(payments.id, row.id));
      await tx
        .update(users)
        .set({ plan: row.plan, planExpiresAt: nextExpiry })
        .where(eq(users.externalId, row.userExternalId));
    });

    return { ok: true as const, plan: row.plan };
  }),
});
