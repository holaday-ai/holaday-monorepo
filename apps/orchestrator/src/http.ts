import { randomBytes } from 'node:crypto';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { eq } from 'drizzle-orm';
import express from 'express';
import multer from 'multer';
import { pinoHttp } from 'pino-http';
import type { Planner } from './agent/planner.js';
import type { ExecutionRouter } from './agent/supercar/index.js';
import type { VisionLoopCommander } from './agent/vision-loop/commander.js';
import type { PlaywrightExecutor } from './agent/vision-loop/playwright-executor.js';
import type { BrowserPool } from './browser-pool/index.js';
import { bearerAuth } from './auth/middleware.js';
import { AuthService } from './auth/service.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { db } from './db/client.js';
import { payments } from './db/schema/payments.js';
import { users } from './db/schema/users.js';
import {
  ACCEPTED_EXTENSIONS,
  ACCEPTED_MIMES,
  FileService,
  UPLOAD_BYTE_LIMIT,
} from './files/file-service.js';
import { nextExpiryFor, type PayPalAdapter, type PlanId } from './payment/index.js';
import type { BillingCycle } from '@holaday/shared-types';
import { makeCreateContext } from './trpc/context.js';
import { appRouter } from './trpc/router.js';

export interface HttpAppDeps {
  planner: Planner;
  visionCommander?: VisionLoopCommander;
  playwrightExecutor?: PlaywrightExecutor | null;
  executionRouter?: ExecutionRouter;
  browserPool?: BrowserPool | null;
  paypalAdapter?: PayPalAdapter | null;
}

export function createHttpApp(deps: HttpAppDeps) {
  const app = express();

  app.use(pinoHttp({ logger }));
  app.use(express.json({ limit: '1mb' }));
  app.use(bearerAuth);

  app.get('/healthz', (_req, res) => {
    res.json({
      status: 'ok',
      env: env.NODE_ENV,
      time: new Date().toISOString(),
      executor: deps.playwrightExecutor ? 'playwright' : 'legacy',
    });
  });

  // ---------------------------------------------------------------------
  // Google OAuth2. Two endpoints:
  //   /api/auth/google           → kicks off consent flow
  //   /api/auth/google/callback  → receives `code`, swaps for tokens,
  //                                 upserts user by email, redirects to
  //                                 `/#token=<JWT>` so the SPA's
  //                                 lib/auth.ts hash consumer picks it up.
  //
  // The `state` param is a random token we stash in a signed, HTTP-only
  // cookie at /google kickoff and verify on callback. Mitigates the
  // login-CSRF class where an attacker tricks a signed-in victim into
  // completing the attacker's OAuth flow.
  // ---------------------------------------------------------------------
  // Nginx strips `/api/` via the trailing-slash proxy_pass, so the
  // route we register here is `/auth/google`. The redirect_uri we
  // hand to Google (and the <a href> in the SPA) is the browser-
  // facing `/api/auth/google[/callback]` — nginx maps that to the
  // backend route below.
  app.get('/auth/google', (req, res) => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      res.status(501).json({
        error: 'google_oauth_not_configured',
        message: 'Google 登录未配置（GOOGLE_CLIENT_ID / _SECRET 未设置）',
      });
      return;
    }
    const host = req.get('host');
    const redirectUri = `https://${host}/api/auth/google/callback`;
    const state = randomState();
    // HttpOnly + Secure + SameSite=Lax: Lax (not Strict) because the
    // callback is a top-level nav from Google, and Strict would drop
    // the cookie on that cross-site redirect.
    res.cookie('holaday_oauth_state', state, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 10 * 60 * 1000,
      path: '/api/auth/google',
    });
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      access_type: 'online',
      prompt: 'select_account',
      state,
    });
    res.redirect(302, `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
  });

  app.get('/auth/google/callback', async (req, res) => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      res.status(501).json({ error: 'google_oauth_not_configured' });
      return;
    }
    const code = String(req.query.code ?? '');
    const returnedState = String(req.query.state ?? '');
    const error = String(req.query.error ?? '');
    if (error) {
      logger.warn({ error }, 'google oauth: Google returned error');
      res.redirect(302, `/?auth_error=${encodeURIComponent(error)}`);
      return;
    }
    if (!code || !returnedState) {
      res.redirect(302, '/?auth_error=missing_code');
      return;
    }
    // Parse the state cookie manually; adding cookie-parser middleware
    // would be global and we only need it here.
    const cookieState = parseCookie(req.headers.cookie ?? '', 'holaday_oauth_state');
    if (!cookieState || cookieState !== returnedState) {
      logger.warn({ cookiePresent: !!cookieState }, 'google oauth: state mismatch');
      res.redirect(302, '/?auth_error=state_mismatch');
      return;
    }
    // Clear the single-use state cookie immediately.
    res.clearCookie('holaday_oauth_state', { path: '/api/auth/google' });
    const host = req.get('host');
    const redirectUri = `https://${host}/api/auth/google/callback`;
    try {
      // 1. Token swap.
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }).toString(),
      });
      if (!tokenRes.ok) {
        const body = await tokenRes.text();
        logger.error({ status: tokenRes.status, body: body.slice(0, 400) }, 'google token swap failed');
        res.redirect(302, '/?auth_error=token_swap_failed');
        return;
      }
      const tokenJson = (await tokenRes.json()) as {
        access_token?: string;
        id_token?: string;
      };
      const accessToken = tokenJson.access_token;
      if (!accessToken) {
        res.redirect(302, '/?auth_error=no_access_token');
        return;
      }
      // 2. Fetch the verified email from the userinfo endpoint. This
      //    avoids having to verify id_token JWT signatures against
      //    Google's JWKS — we trust the TLS channel we just opened to
      //    accounts.google.com, the access_token we got back, and the
      //    `email_verified` flag Google sets.
      const infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      if (!infoRes.ok) {
        logger.error({ status: infoRes.status }, 'google userinfo failed');
        res.redirect(302, '/?auth_error=userinfo_failed');
        return;
      }
      const info = (await infoRes.json()) as {
        sub?: string;
        email?: string;
        email_verified?: boolean;
        name?: string;
        picture?: string;
      };
      if (!info.email || info.email_verified === false) {
        logger.warn({ email: info.email }, 'google oauth: unverified email');
        res.redirect(302, '/?auth_error=email_unverified');
        return;
      }
      if (!info.sub) {
        // OpenID userinfo always returns `sub`; bailing here means
        // Google's response shape changed and we'd silently lose the
        // identity link. Fail loud so we notice in logs.
        logger.error({ info }, 'google oauth: userinfo missing sub');
        res.redirect(302, '/?auth_error=missing_sub');
        return;
      }
      // 3. Upsert + issue our JWT. The Google-aware path links the
      //    `sub` so subsequent logins resolve by ID even if the user
      //    later changes their primary email on Google's side.
      const svc = new AuthService(db);
      const result = await svc.loginOrRegisterByGoogle({
        email: info.email,
        googleId: info.sub,
        name: info.name ?? null,
        avatarUrl: info.picture ?? null,
      });
      logger.info(
        { email: info.email, sub: info.sub.slice(0, 6) },
        'google oauth: issued access token',
      );
      // 4. Hand the token back via URL fragment — the SPA's lib/auth
      //    picks it out at load, persists to localStorage, then scrubs
      //    the hash via history.replaceState so it doesn't leak into
      //    referrers.
      const fragment = `#token=${encodeURIComponent(result.accessToken)}`;
      res.redirect(302, `/${fragment}`);
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'google oauth callback crashed',
      );
      res.redirect(302, '/?auth_error=callback_exception');
    }
  });

  // ---------------------------------------------------------------------
  // PayPal webhook. Public endpoint — must be reachable by PayPal's
  // event servers, so it lives outside any bearer-auth guard. Two
  // safeguards keep the surface tight:
  //   1. Signature verification via the verify-webhook-signature API
  //      (only when PAYPAL_WEBHOOK_ID is configured).
  //   2. We only ACT on PAYMENT.CAPTURE.COMPLETED events whose
  //      reference_id matches a payments row we created — the rest
  //      get a 200 (acknowledged) so PayPal stops retrying.
  // ---------------------------------------------------------------------
  app.post('/payment/paypal/webhook', async (req, res) => {
    if (!deps.paypalAdapter) {
      // Adapter not wired this deploy — return 200 so PayPal doesn't
      // retry forever, but log loudly so ops notices the misroute.
      logger.warn('paypal webhook hit but adapter not configured');
      res.status(200).send('ok');
      return;
    }
    const webhookId = process.env.PAYPAL_WEBHOOK_ID;
    if (webhookId) {
      const ok = await deps.paypalAdapter.verifyWebhookSignature({
        headers: req.headers,
        body: req.body,
        webhookId,
      });
      if (!ok) {
        logger.warn(
          { transmissionId: req.headers['paypal-transmission-id'] },
          'paypal webhook: signature verification FAILED — rejecting',
        );
        res.status(400).send('signature invalid');
        return;
      }
    } else {
      logger.warn('paypal webhook: PAYPAL_WEBHOOK_ID unset — accepting without signature check (dev only)');
    }
    const event = req.body as {
      event_type?: string;
      resource?: {
        id?: string;
        supplementary_data?: { related_ids?: { order_id?: string } };
      };
    };
    if (event.event_type !== 'PAYMENT.CAPTURE.COMPLETED') {
      // Acknowledge other event types so PayPal moves on, but don't
      // act on them.
      res.status(200).send('ignored');
      return;
    }
    const captureId = event.resource?.id ?? null;
    const orderId = event.resource?.supplementary_data?.related_ids?.order_id ?? null;
    if (!captureId || !orderId) {
      logger.warn({ event }, 'paypal webhook: missing capture/order id');
      res.status(200).send('skipped');
      return;
    }
    try {
      const [row] = await db
        .select()
        .from(payments)
        .where(eq(payments.providerOrderId, orderId))
        .limit(1);
      if (!row) {
        logger.warn({ orderId }, 'paypal webhook: no matching payments row');
        res.status(200).send('unknown order');
        return;
      }
      if (row.status === 'completed') {
        // Already finalised by tRPC capture or a prior webhook — idempotent.
        res.status(200).send('already completed');
        return;
      }
      // Pull cycle from the metadata stamped at createOrder time;
      // legacy rows pre-dating the field default to monthly.
      const meta = (row.metadata as Record<string, unknown> | null) ?? {};
      const cycle: BillingCycle = meta.cycle === 'yearly' ? 'yearly' : 'monthly';
      const expiry = nextExpiryFor(row.plan as PlanId, cycle, null);
      await db.transaction(async (tx) => {
        await tx
          .update(payments)
          .set({
            status: 'completed',
            providerCaptureId: captureId,
            metadata: {
              ...(row.metadata as Record<string, unknown> | null),
              webhookEventType: event.event_type,
            },
          })
          .where(eq(payments.id, row.id));
        await tx
          .update(users)
          .set({ plan: row.plan, planExpiresAt: expiry })
          .where(eq(users.externalId, row.userExternalId));
      });
      logger.info(
        { paymentId: row.externalId, plan: row.plan, captureId },
        'paypal webhook: capture completed → plan upgraded',
      );
      res.status(200).send('ok');
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err), orderId, captureId },
        'paypal webhook: handler crashed',
      );
      // 500 invites PayPal retry, which is what we want when the DB
      // is transiently down. Pure programming bugs will retry too,
      // but the DB writes are idempotent.
      res.status(500).send('internal');
    }
  });

  // ---------------------------------------------------------------------
  // Phase 10 Tier 3 — Files API.
  //
  //   POST /files/upload    multipart/form-data  → { fileId, filename, size, mimetype }
  //                         body field: `file`
  //                         auth: bearer (uses bearerAuth middleware that
  //                               populated req.userId above).
  //                         Per-plan size cap enforced server-side; SPA
  //                         hides the button entirely on free.
  //   GET  /files/:id/download                  → file bytes
  //                         auth: bearer; verifies the file's user_id
  //                               matches req.userId.
  //                         Output kind enforces a 24h expires_at; reads
  //                         past that 404.
  //
  // multer's memoryStorage keeps the buffer in process for the duration
  // of the request — fine for the 10MB cap. Disk-storage would race
  // with FileService.storeUpload's directory layout, and the buffer
  // copy cost at 10MB is negligible.
  // ---------------------------------------------------------------------
  const fileService = new FileService(db, logger);
  // Use the most permissive cap (Pro: 10MB) at the multer layer; the
  // service layer re-validates against the caller's specific plan,
  // so a Basic user uploading 8MB still 403s with the right message.
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: Math.max(...Object.values(UPLOAD_BYTE_LIMIT)),
      files: 1,
    },
  });

  app.post('/files/upload', upload.single('file'), async (req, res) => {
    const userExternalId = (req as express.Request & { userId?: string }).userId;
    if (!userExternalId) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: 'no file in upload' });
      return;
    }
    try {
      const [user] = await db
        .select({ id: users.id, plan: users.plan })
        .from(users)
        .where(eq(users.externalId, userExternalId))
        .limit(1);
      if (!user) {
        res.status(401).json({ error: 'unknown user' });
        return;
      }
      const planId: PlanId =
        user.plan === 'basic' || user.plan === 'pro' ? user.plan : 'free';
      const cap = UPLOAD_BYTE_LIMIT[planId];
      if (cap === 0) {
        res.status(403).json({
          error: 'plan_does_not_allow_uploads',
          message: '免费版不支持文件上传，升级到基础版即可使用',
        });
        return;
      }
      if (req.file.size > cap) {
        res.status(413).json({
          error: 'file_too_large',
          message: `文件超过当前套餐限制（${planId === 'basic' ? '5MB' : '10MB'}）`,
        });
        return;
      }
      // Validate mimetype OR fallback by file extension. Some browsers
      // send 'application/octet-stream' for less common formats; the
      // extension whitelist catches the legitimate cases without
      // turning the door wide open.
      const filename = req.file.originalname || 'upload';
      const dotIdx = filename.lastIndexOf('.');
      const ext = dotIdx >= 0 ? filename.slice(dotIdx).toLowerCase() : '';
      const mimeOk = ACCEPTED_MIMES.has(req.file.mimetype.toLowerCase());
      const extOk = ext.length > 0 && ACCEPTED_EXTENSIONS.has(ext);
      if (!mimeOk && !extOk) {
        res.status(415).json({
          error: 'unsupported_file_type',
          message: `不支持的文件类型：${req.file.mimetype || '未知'}`,
        });
        return;
      }
      const stored = await fileService.storeUpload({
        userIdInternal: user.id,
        userExternalId,
        filename,
        mimetype: req.file.mimetype || 'application/octet-stream',
        buffer: req.file.buffer,
      });
      res.status(200).json({
        fileId: stored.externalId,
        filename: stored.filename,
        mimetype: stored.mimetype,
        size: stored.sizeBytes,
      });
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'file upload route crashed',
      );
      res.status(500).json({ error: 'upload_failed' });
    }
  });

  app.get('/files/:id/download', async (req, res) => {
    const userExternalId = (req as express.Request & { userId?: string }).userId;
    if (!userExternalId) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const fileId = String(req.params.id ?? '');
    try {
      const [user] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.externalId, userExternalId))
        .limit(1);
      if (!user) {
        res.status(401).json({ error: 'unknown user' });
        return;
      }
      const loaded = await fileService.loadForUser(fileId, userExternalId);
      if (!loaded || loaded.row.userId !== user.id) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      res.setHeader('content-type', loaded.row.mimetype);
      res.setHeader(
        'content-disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(loaded.row.filename)}`,
      );
      res.setHeader('content-length', loaded.buffer.length.toString());
      res.status(200).send(loaded.buffer);
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err), fileId },
        'file download route crashed',
      );
      res.status(500).json({ error: 'download_failed' });
    }
  });

  app.use(
    '/trpc',
    createExpressMiddleware({
      router: appRouter,
      createContext: makeCreateContext({
        planner: deps.planner,
        ...(deps.visionCommander ? { visionCommander: deps.visionCommander } : {}),
        ...(deps.playwrightExecutor ? { playwrightExecutor: deps.playwrightExecutor } : {}),
        ...(deps.executionRouter ? { executionRouter: deps.executionRouter } : {}),
        ...(deps.browserPool ? { browserPool: deps.browserPool } : {}),
        ...(deps.paypalAdapter ? { paypalAdapter: deps.paypalAdapter } : {}),
      }),
    }),
  );

  return app;
}

/**
 * Minimal cookie parser. Avoids pulling in the `cookie-parser`
 * middleware when only one route needs a single cookie. Returns
 * `null` when the named cookie is absent or malformed.
 */
function parseCookie(header: string, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

/**
 * Cryptographically-strong 32-byte random token, base64url-safe.
 * Used as the OAuth `state` param (CSRF guard) and written to a
 * short-lived cookie for the callback to cross-check.
 */
function randomState(): string {
  return randomBytes(32).toString('base64url');
}
