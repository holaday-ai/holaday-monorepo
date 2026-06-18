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
  getAddonPackPriceCents,
  getPlanPriceCents,
  isAddonPackId,
  newExternalId,
  type AddonPackId,
  type BillingCycle,
  type PlanId,
} from '@holaday/shared-types';
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { describePlanOrder, isPaidPlan, nextExpiryFor } from '../../payment/plans.js';
import { readAffectedRows } from '../../db/mysql-result.js';
import { payments } from '../../db/schema/payments.js';
import { users } from '../../db/schema/users.js';
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

    // First-month promo eligibility: only when the user has never
    // had a paid plan (i.e. still on free). Returning customers
    // resubscribing after a lapse pay the regular monthly rate.
    // Yearly cycle skips the promo regardless — discount is in the
    // catalogue's yearly column itself.
    const isFirstMonth = user.plan === 'free';
    const amountCents = getPlanPriceCents(input.plan, input.cycle, 'usd', isFirstMonth);

    const externalId = newExternalId('payment');
    const origin = ctx.req.protocol + '://' + ctx.req.get('host');

    const order = await ctx.paypalAdapter.createOrder({
      amountCents,
      currency: 'USD',
      referenceId: externalId,
      description: describePlanOrder(input.plan, input.cycle),
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
      kind: 'subscription',
      amountCents,
      currency: 'USD',
      status: 'pending',
      // Stash cycle + firstMonth flag in metadata so captureOrder /
      // the webhook can pick the right expiry math without a schema
      // migration. `cycle` is always present; `firstMonth` is only
      // true on the promo path.
      metadata: { env: ctx.paypalAdapter.env, cycle: input.cycle, firstMonth: isFirstMonth },
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

    // Capture succeeded. Two flavours of capture follow-up depending
    // on what was bought:
    //
    //   - kind='subscription' → flip status, extend planExpiresAt,
    //                            and (when this is the user's first
    //                            paid month) seed bonus_tasks via
    //                            QuotaService.grantFirstMonthBonus.
    //   - kind='addon'        → flip status, top up bonus on the
    //                            active task_quotas row. No plan
    //                            change.
    const meta = (row.metadata as Record<string, unknown> | null) ?? {};

    if (row.kind === 'addon') {
      const [userRow] = await ctx.db
        .select({ id: users.id, plan: users.plan })
        .from(users)
        .where(eq(users.externalId, row.userExternalId))
        .limit(1);
      if (!userRow) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '用户不存在' });
      }
      if (!isAddonPackId(row.plan)) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'addon 订单 plan 字段非法',
        });
      }
      const planId: PlanId =
        userRow.plan === 'basic' || userRow.plan === 'pro' ? userRow.plan : 'free';
      if (planId === 'free') {
        // Edge case: user downgraded mid-checkout. Refuse to apply
        // (would credit a free user with paid bonus). Mark the
        // payment failed so the SPA can refund manually.
        await ctx.db
          .update(payments)
          .set({ status: 'failed', metadata: { ...meta, captureStatus: capture.status, reason: 'plan_downgraded' } })
          .where(eq(payments.id, row.id));
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: '当前账户已降级，加量包未生效',
        });
      }
      const quotaService = new QuotaService(ctx.db);
      // Conditional pending→completed transition. Only the writer
      // that flips the row applies the entitlement. A retry that
      // races with this one (or arrives after a successful run)
      // sees status='completed' already, affectedRows=0, and
      // skips applyAddonPack — preventing a double bonus grant.
      const updateResult = await ctx.db
        .update(payments)
        .set({
          status: 'completed',
          providerCaptureId: capture.captureId,
          metadata: {
            ...meta,
            payerEmail: capture.payerEmail,
            captureStatus: capture.status,
          },
        })
        .where(and(eq(payments.id, row.id), eq(payments.status, 'pending')));
      const transitioned = readAffectedRows(updateResult) === 1;
      if (transitioned) {
        await quotaService.applyAddonPack(userRow.id, planId, row.plan as AddonPackId);
      }
      return { ok: true as const, plan: row.plan };
    }

    const [planRow] = await ctx.db
      .select({ id: users.id, plan: users.plan, planExpiresAt: users.planExpiresAt })
      .from(users)
      .where(eq(users.externalId, row.userExternalId))
      .limit(1);
    if (!planRow) {
      throw new TRPCError({ code: 'NOT_FOUND', message: '用户不存在' });
    }
    // First-month bonus: only when the user was on free at order
    // creation time AND the catalogue defines a bonus AND the cycle
    // is monthly. The createOrder flow stamps `firstMonth: true` in
    // metadata, so we reuse that — easier than re-deriving from a
    // race-prone read of the user's current plan.
    const firstMonthFlag = meta.firstMonth === true;
    // Pull cycle from metadata stamped at createOrder time; default to
    // monthly for legacy rows that pre-date the cycle field.
    const cycle: BillingCycle = meta.cycle === 'yearly' ? 'yearly' : 'monthly';
    const nextExpiry = nextExpiryFor(row.plan as 'basic' | 'pro', cycle, planRow?.planExpiresAt ?? null);

    // Same single-finalize-per-payment guard as the addon branch:
    // condition the UPDATE on status='pending' so a concurrent
    // capture (or a retry after a network blip) becomes a noop. We
    // only extend the user's plan / grant the first-month bonus
    // when this call is the one that flipped the row.
    const transitioned = await ctx.db.transaction(async (tx) => {
      const updateResult = await tx
        .update(payments)
        .set({
          status: 'completed',
          providerCaptureId: capture.captureId,
          metadata: {
            ...meta,
            payerEmail: capture.payerEmail,
            captureStatus: capture.status,
          },
        })
        .where(and(eq(payments.id, row.id), eq(payments.status, 'pending')));
      const affected = readAffectedRows(updateResult);
      if (affected !== 1) return false;
      await tx
        .update(users)
        .set({ plan: row.plan, planExpiresAt: nextExpiry })
        .where(eq(users.externalId, row.userExternalId));
      return true;
    });

    if (transitioned && firstMonthFlag && cycle === 'monthly') {
      const quotaService = new QuotaService(ctx.db);
      await quotaService.grantFirstMonthBonus(planRow.id, row.plan as PlanId);
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
      const pack = ADDON_PACK_CATALOGUE[input.packId];
      if (!pack) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: '加量包不存在' });
      }

      const [user] = await ctx.db
        .select()
        .from(users)
        .where(eq(users.externalId, ctx.userId!))
        .limit(1);
      if (!user) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
      }
      const planId: PlanId =
        user.plan === 'basic' || user.plan === 'pro' ? user.plan : 'free';
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
      const origin = ctx.req.protocol + '://' + ctx.req.get('host');

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
      const [user] = await ctx.db
        .select()
        .from(users)
        .where(eq(users.externalId, ctx.userId!))
        .limit(1);
      if (!user) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
      }
      const purchase =
        input.purchase.kind === 'subscription'
          ? {
              kind: 'subscription' as const,
              planId: input.purchase.planId,
              cycle: input.purchase.cycle,
              isFirstMonth: user.plan === 'free',
            }
          : { kind: 'addon' as const, packId: input.purchase.packId };
      const res = await fetch(`${cnUrl.replace(/\/$/, '')}/payment/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-secret': secret },
        body: JSON.stringify({
          provider: input.provider,
          userId: ctx.userId,
          purchase,
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        ctx.logger.warn(
          { status: res.status, body: body.slice(0, 400) },
          'cn-payment: create call failed',
        );
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `cn-payment ${res.status}: ${body.slice(0, 200)}`,
        });
      }
      // The gateway's create response shape:
      //   wechat → { provider: 'wechat', outTradeNo, codeUrl, amountCents, description }
      //   alipay → { provider: 'alipay', outTradeNo, payUrl,  amountCents, description }
      // The SPA uses outTradeNo as the polling key.
      const data = (await res.json()) as Record<string, unknown>;
      return data;
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
        })
        .from(payments)
        .where(eq(payments.providerOrderId, input.outTradeNo))
        .limit(1);
      // Until the cn-payment gateway POSTs to /api/internal/payment/
      // confirm, no row exists for this outTradeNo. Surface 'pending'
      // so the SPA keeps polling.
      if (!row) return { status: 'pending' as const };
      return {
        status: row.status as 'pending' | 'completed' | 'failed',
        plan: row.plan,
        kind: row.kind ?? 'subscription',
      };
    }),
});
