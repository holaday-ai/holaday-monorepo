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
  type PlanId,
  type BillingCycle,
} from '@holaday/shared-types';
import { z } from 'zod';
import { loadEnv } from './config/env.js';
import { logger } from './config/logger.js';
import { WechatPayAdapter } from './wechat-pay.js';
import { AlipayAdapter } from './alipay.js';
import { VultrSync } from './sync-to-vultr.js';

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
  const sync = new VultrSync(env, logger);

  app.get('/healthz', (_req, res) => {
    res.json({
      status: 'ok',
      env: env.NODE_ENV,
      time: new Date().toISOString(),
      providers: {
        wechat: wx.isReady() ? 'ready' : `unconfigured: ${wx.why()}`,
        alipay: alipay.isReady() ? 'ready' : `unconfigured: ${alipay.why()}`,
      },
    });
  });

  // ------------------------------------------------------------------
  // /payment/create — called by the Vultr orchestrator's tRPC layer
  // (which proxies user clicks). Single endpoint, branches on
  // provider; reduces the proxy permutation matrix on Vultr.
  // ------------------------------------------------------------------
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
    ]),
  });

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
    } else {
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
    }
    if (amountCents <= 0) {
      res.status(400).json({ error: 'amount_must_be_positive' });
      return;
    }

    // Per-call out_trade_no. WX max 32 chars, Alipay max 64. Our
    // newExternalId('payment') is 25 chars (4-char prefix + 21-char
    // nanoid), well within both caps.
    const outTradeNo = newExternalId('payment');

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
        returnUrl: `https://holaday.ai/billing/return?payment=${outTradeNo}`,
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
  let attach: { kind: 'subscription'; userId: string; planId: PlanId; cycle: BillingCycle } | { kind: 'addon'; userId: string; packId: string } | null = null;
  try {
    attach = JSON.parse(attachJson);
  } catch {
    throw new Error(`malformed attach: ${attachJson.slice(0, 80)}`);
  }
  if (!attach) throw new Error('empty attach');
  if (attach.kind === 'subscription') {
    if (attach.planId !== 'basic' && attach.planId !== 'pro') {
      throw new Error(`bad planId: ${attach.planId}`);
    }
    await sync.confirm({
      provider,
      userId: attach.userId,
      planId: attach.planId,
      cycle: attach.cycle,
      transactionId,
      amountCents,
      kind: 'subscription',
    });
    void outTradeNo;
    return;
  }
  await sync.confirm({
    provider,
    userId: attach.userId,
    planId: 'basic', // ignored on the Vultr side for kind='addon'
    cycle: 'monthly',
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
