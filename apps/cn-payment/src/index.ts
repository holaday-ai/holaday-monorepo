/**
 * cn-payment — China-side gateway for WeChat Pay + Alipay.
 *
 * Sits on Aliyun (47.99.169.186) at hd-pay.orangebench.tech. The
 * Vultr orchestrator (holaday.ai) proxies create-order calls here;
 * the providers POST their async notifications back here too. After
 * a verified notification, this service calls Vultr's internal
 * confirm endpoint to flip the user's plan + insert the payments
 * row.
 *
 * Why a separate service: WeChat / Alipay callbacks must reach a
 * mainland China-resolving server. Vultr (US) routes are flaky
 * and orangebench.tech is already ICP-filed, so the gateway lives
 * on the Aliyun box that already exists for that purpose.
 */

import express from 'express';
import { pinoHttp } from 'pino-http';
import {
  newExternalId,
  getPlanPriceCents,
  ADDON_PACK_CATALOGUE,
  getAddonPackPriceCents,
  HOLA_CREDIT_CNY_CENTS,
  type PlanId,
  type BillingCycle,
} from '@holaday/shared-types';
import { z } from 'zod';
import { loadEnv } from './config/env.js';
import { logger } from './config/logger.js';
import { WechatPayAdapter } from './wechat-pay.js';
import { AlipayAdapter } from './alipay.js';
import { SmsAdapter } from './sms.js';
import { VultrSync } from './sync-to-vultr.js';

const WholeCnyCents = z
  .number()
  .int()
  .positive()
  .refine((value) => value % HOLA_CREDIT_CNY_CENTS === 0, 'amount must be whole CNY cents');

const PartnerPurchaseInput = z.object({
  kind: z.enum(['partner_membership', 'partner_recharge']),
  partnerOrderExternalId: z.string().trim().min(1).max(32),
  amountCnyCents: WholeCnyCents,
});

const CreateInput = z.object({
  provider: z.enum(['wechat', 'alipay']),
  userId: z.string().min(1),
  purchase: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('subscription'),
      planId: z.enum(['basic', 'pro']),
      cycle: z.enum(['monthly', 'yearly']),
      isFirstMonth: z.boolean().optional(),
    }),
    z.object({
      kind: z.literal('addon'),
      packId: z.string().min(1),
    }),
    PartnerPurchaseInput.extend({
      kind: z.literal('partner_membership'),
    }),
    PartnerPurchaseInput.extend({
      kind: z.literal('partner_recharge'),
    }),
  ]),
});

type CreatePurchase = z.infer<typeof CreateInput>['purchase'];

function isPartnerPurchase(
  purchase: CreatePurchase,
): purchase is Extract<CreatePurchase, { kind: 'partner_membership' | 'partner_recharge' }> {
  return purchase.kind === 'partner_membership' || purchase.kind === 'partner_recharge';
}

async function main(): Promise<void> {
  const env = loadEnv();
  const app = express();

  // Two parsers, one route each:
  //   - express.json() for our own /payment/create endpoints (called
  //     from the Vultr orchestrator) and Alipay's notify (sent as
  //     URL-encoded — different parser; see below).
  //   - express.text() at /payment/wechat/notify so we can verify
  //     WX's signature over the LITERAL body bytes. WX signs the
  //     raw JSON; parsing through express.json() would round-trip
  //     it through a JSON serializer with different whitespace,
  //     breaking the signature.
  app.use(pinoHttp({ logger }));
  app.use('/payment/wechat/notify', express.text({ type: '*/*', limit: '64kb' }));
  app.use('/payment/alipay/notify', express.urlencoded({ extended: true, limit: '64kb' }));
  app.use(express.json({ limit: '64kb' }));

  const wx = new WechatPayAdapter(env, logger);
  await wx.init();
  const alipay = new AlipayAdapter(env, logger);
  alipay.init();
  const sms = new SmsAdapter(env, logger);
  const sync = new VultrSync(env, logger);

  app.get('/healthz', (_req, res) => {
    res.json({
      status: 'ok',
      env: env.NODE_ENV,
      time: new Date().toISOString(),
      providers: {
        wechat: wx.isReady() ? 'ready' : `unconfigured: ${wx.why()}`,
        alipay: alipay.isReady() ? 'ready' : `unconfigured: ${alipay.why()}`,
        sms: sms.isReady() ? 'ready' : 'unconfigured: missing one or more aliyun sms credentials',
      },
    });
  });

  // ------------------------------------------------------------------
  // /payment/create — called by the Vultr orchestrator's tRPC layer
  // (which proxies user clicks). Single endpoint, branches on
  // provider; reduces the proxy permutation matrix on Vultr.
  // ------------------------------------------------------------------
  app.post('/payment/create', async (req, res) => {
    // Authentication: same shared secret as the confirm side. The
    // Vultr orchestrator forwards user clicks here and tags them
    // with X-Internal-Secret; nothing else should reach this route.
    if (req.headers['x-internal-secret'] !== env.INTERNAL_SHARED_SECRET) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const parse = CreateInput.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: 'bad_request', issues: parse.error.issues });
      return;
    }
    const { provider, userId, purchase } = parse.data;

    // Compute amount + descriptor up-front so the provider call has
    // everything it needs.
    let amountCents = 0;
    let description = '';
    let attach = '';
    if (purchase.kind === 'subscription') {
      amountCents = getPlanPriceCents(
        purchase.planId,
        purchase.cycle,
        'cny',
        Boolean(purchase.isFirstMonth),
      );
      description = `HOLA DAY ${purchase.planId === 'basic' ? '基础版' : '专业版'}（${purchase.cycle === 'yearly' ? '年付' : '月付'}）`;
      attach = JSON.stringify({
        kind: 'subscription' as const,
        userId,
        planId: purchase.planId,
        cycle: purchase.cycle,
      });
    } else if (purchase.kind === 'addon') {
      const pack = ADDON_PACK_CATALOGUE[purchase.packId as keyof typeof ADDON_PACK_CATALOGUE];
      if (!pack) {
        res.status(400).json({ error: 'unknown_pack' });
        return;
      }
      amountCents = getAddonPackPriceCents(purchase.packId as keyof typeof ADDON_PACK_CATALOGUE, 'cny');
      description = `HOLA DAY ${pack.nameZh}`;
      attach = JSON.stringify({
        kind: 'addon' as const,
        userId,
        packId: purchase.packId,
      });
    } else {
      amountCents = purchase.amountCnyCents;
      description =
        purchase.kind === 'partner_membership'
          ? 'HOLA DAY 合伙人年费'
          : 'HOLA DAY 合伙人充值';
      attach = JSON.stringify({
        kind: purchase.kind,
        userId,
        partnerOrderExternalId: purchase.partnerOrderExternalId,
      });
    }
    if (amountCents <= 0) {
      res.status(400).json({ error: 'amount_must_be_positive' });
      return;
    }

    // Per-call out_trade_no. WX max 32 chars, Alipay max 64. Our
    // newExternalId('payment') is 25 chars (4-char prefix + 21-char
    // nanoid), well within both caps.
    const outTradeNo = isPartnerPurchase(purchase)
      ? purchase.partnerOrderExternalId
      : newExternalId('payment');

    try {
      if (provider === 'wechat') {
        if (!wx.isReady()) {
          res.status(503).json({ error: 'wechat_not_configured', reason: wx.why() });
          return;
        }
        const result = await wx.createNativeOrder({
          outTradeNo,
          description,
          amountCents,
          attach,
          notifyUrl: `${env.PUBLIC_ORIGIN}/payment/wechat/notify`,
        });
        res.json({
          provider: 'wechat',
          outTradeNo: result.outTradeNo,
          codeUrl: result.codeUrl,
          amountCents,
          description,
        });
        return;
      }

      if (!alipay.isReady()) {
        res.status(503).json({ error: 'alipay_not_configured', reason: alipay.why() });
        return;
      }
      const result = await alipay.createPagePayUrl({
        outTradeNo,
        subject: description,
        amountCents,
        passback: attach,
        notifyUrl: `${env.PUBLIC_ORIGIN}/payment/alipay/notify`,
        // The user lands here after Alipay closes; we just need a
        // page that exists. The SPA polls for status separately.
        returnUrl: isPartnerPurchase(purchase)
          ? `https://holaday.ai/partner?payment=${outTradeNo}`
          : `https://holaday.ai/billing/return?payment=${outTradeNo}`,
      });
      res.json({
        provider: 'alipay',
        outTradeNo: result.outTradeNo,
        payUrl: result.payUrl,
        amountCents,
        description,
      });
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err), outTradeNo, provider },
        '/payment/create: provider call threw',
      );
      res.status(502).json({ error: 'provider_call_failed' });
    }
  });

  // ------------------------------------------------------------------
  // /payment/wechat/notify — WX async webhook. Body is the literal
  // bytes WX signed (text middleware above). We verify, decrypt,
  // then bridge to Vultr.
  // ------------------------------------------------------------------
  app.post('/payment/wechat/notify', async (req, res) => {
    const rawBody = (req.body as string) ?? '';
    try {
      const payload = await wx.verifyAndDecryptNotify(req.headers, rawBody);
      logger.info({ outTradeNo: payload.outTradeNo, tradeState: payload.tradeState }, 'wx notify: verified');
      if (payload.tradeState !== 'SUCCESS') {
        res.json({ code: 'SUCCESS', message: 'ack non-success state' });
        return;
      }
      await handleSuccessfulPayment(sync, 'wechat', payload.outTradeNo, payload.transactionId, payload.amountCents, payload.attach);
      res.json({ code: 'SUCCESS' });
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err), bodyPreview: rawBody.slice(0, 200) },
        'wx notify: verification or sync failed',
      );
      // Return non-success so WX retries with backoff. Truly malformed
      // notifications don't loop forever — WX gives up after 8 retries
      // over 24h.
      res.status(401).json({ code: 'FAIL', message: 'verification failed' });
    }
  });

  // ------------------------------------------------------------------
  // /payment/alipay/notify — Alipay POSTs URL-encoded form. SDK
  // verifies signature against alipay public key.
  // ------------------------------------------------------------------
  app.post('/payment/alipay/notify', async (req, res) => {
    const body = (req.body as Record<string, string>) ?? {};
    try {
      const ok = alipay.verifyNotify(body);
      if (!ok) {
        logger.warn({ bodyKeys: Object.keys(body) }, 'alipay notify: signature mismatch');
        res.send('fail');
        return;
      }
      const payload = alipay.parseNotifyBody(body);
      logger.info(
        { outTradeNo: payload.outTradeNo, tradeStatus: payload.tradeStatus },
        'alipay notify: verified',
      );
      // Alipay states: WAIT_BUYER_PAY / TRADE_CLOSED / TRADE_SUCCESS / TRADE_FINISHED.
      if (payload.tradeStatus !== 'TRADE_SUCCESS' && payload.tradeStatus !== 'TRADE_FINISHED') {
        res.send('success');
        return;
      }
      await handleSuccessfulPayment(sync, 'alipay', payload.outTradeNo, payload.transactionId, payload.amountCents, payload.passback);
      res.send('success');
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'alipay notify: verification or sync failed',
      );
      // Per Alipay docs, return 'fail' to trigger retry.
      res.send('fail');
    }
  });

  // ------------------------------------------------------------------
  // Phase 12 — SMS login (Aliyun SMS).
  //
  // The SPA → Vultr → here flow:
  //   POST /api/sms/send   { phone }                   → { ok, cooldownMs }
  //   POST /api/sms/verify { phone, code }             → { user, accessToken }
  //
  // Both endpoints are open to the Vultr orchestrator (the only
  // public client). The same nginx vhost can serve them at both
  // hd-pay.orangebench.tech (legacy alias) and hd-auth.orangebench.tech
  // (the spec'd hostname); a single Node process handles both.
  //
  // Verify path bridges to Vultr's /api/internal/auth/sms-login via
  // VultrSync.smsLogin so the JWT signing stays on the orchestrator
  // (single source of truth for users + plan + token signing key).
  // ------------------------------------------------------------------
  const SmsSendInput = z.object({
    phone: z.string().regex(/^1[3-9]\d{9}$/),
  });
  const SmsVerifyInput = z.object({
    phone: z.string().regex(/^1[3-9]\d{9}$/),
    code: z.string().regex(/^\d{6}$/),
  });

  app.post('/api/sms/send', async (req, res) => {
    const parse = SmsSendInput.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: 'invalid_phone' });
      return;
    }
    const result = await sms.sendCode(parse.data.phone);
    if (!result.ok) {
      const status =
        result.error === 'too_frequent'
          ? 429
          : result.error === 'sms_not_configured'
            ? 503
            : result.error === 'aliyun_error'
              ? 502
              : 400;
      res.status(status).json(result);
      return;
    }
    res.status(200).json({ ok: true, cooldownMs: result.cooldownMs });
  });

  app.post('/api/sms/verify', async (req, res) => {
    const parse = SmsVerifyInput.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: 'bad_request' });
      return;
    }
    const verify = sms.verifyCode(parse.data.phone, parse.data.code);
    if (!verify.ok) {
      const status = verify.error === 'expired' ? 401 : 400;
      res.status(status).json({ error: verify.error });
      return;
    }
    const bridge = await sync.smsLogin(verify.phone);
    if (!bridge.ok) {
      logger.error(
        { reason: bridge.reason },
        'sms verify: Vultr bridge failed — user phone OK but token unissued',
      );
      res.status(502).json({ error: 'bridge_failed', reason: bridge.reason });
      return;
    }
    res.status(200).json(bridge.result);
  });

  app.listen(env.PORT, () => {
    logger.info(
      { port: env.PORT, publicOrigin: env.PUBLIC_ORIGIN },
      'cn-payment: HTTP server listening',
    );
  });
}

/**
 * Shared post-verification path: parse the attach blob, coerce to
 * the Vultr confirm shape, fire the bridge call. Wrapped here so
 * both notify handlers share one source of truth for the field
 * mapping; if the schema changes we touch one place.
 */
async function handleSuccessfulPayment(
  sync: VultrSync,
  provider: 'wechat' | 'alipay',
  outTradeNo: string,
  transactionId: string,
  amountCents: number,
  attachJson: string,
): Promise<void> {
  let attach:
    | { kind: 'subscription'; userId: string; planId: PlanId; cycle: BillingCycle }
    | { kind: 'addon'; userId: string; packId: string }
    | { kind: 'partner_membership'; userId: string; partnerOrderExternalId: string }
    | { kind: 'partner_recharge'; userId: string; partnerOrderExternalId: string }
    | null = null;
  try {
    attach = JSON.parse(attachJson);
  } catch {
    throw new Error(`malformed attach: ${attachJson.slice(0, 80)}`);
  }
  if (!attach) throw new Error('empty attach');
  if (attach.kind === 'partner_membership' || attach.kind === 'partner_recharge') {
    const result = await sync.confirmPartner({
      provider,
      orderExternalId: attach.partnerOrderExternalId,
      providerCaptureId: transactionId,
      amountCnyCents: amountCents,
    });
    if (!result.ok) {
      throw new Error(`partner confirm failed: ${result.reason}`);
    }
    return;
  }
  if (attach.kind === 'subscription') {
    if (attach.planId !== 'basic' && attach.planId !== 'pro') {
      throw new Error(`bad planId: ${attach.planId}`);
    }
    await sync.confirm({
      provider,
      userId: attach.userId,
      planId: attach.planId,
      cycle: attach.cycle,
      outTradeNo,
      transactionId,
      amountCents,
      kind: 'subscription',
    });
    return;
  }
  await sync.confirm({
    provider,
    userId: attach.userId,
    planId: 'basic', // ignored on the Vultr side for kind='addon'
    cycle: 'monthly',
    outTradeNo,
    transactionId,
    amountCents,
    kind: 'addon',
    addonPackId: attach.packId,
  });
}

main().catch((err) => {
  logger.error({ err: err instanceof Error ? err.message : String(err) }, 'cn-payment: boot failed');
  process.exit(1);
});
