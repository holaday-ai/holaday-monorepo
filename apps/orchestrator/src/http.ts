import { randomBytes } from 'node:crypto';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { and, eq, sql } from 'drizzle-orm';
import express from 'express';
import multer from 'multer';
import { pinoHttp } from 'pino-http';
import type { Planner } from './agent/planner.js';
import type { ExecutionRouter } from './agent/supercar/index.js';
import type { VisionLoopCommander } from './agent/vision-loop/commander.js';
import type { PlaywrightExecutor } from './agent/vision-loop/playwright-executor.js';
import type { BrowserPool } from './browser-pool/index.js';
import { bearerAuth } from './auth/middleware.js';
import { signStreamToken } from './auth/jwt.js';
import { AuthService } from './auth/service.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { db } from './db/client.js';
import { payments } from './db/schema/payments.js';
import { users } from './db/schema/users.js';
import {
  injectPendingCookies,
  isAllowedCookieDomain,
  MAX_COOKIES_PER_SYNC,
  syncableCookieSchema,
  type SyncableCookie,
  upsertPendingCookies,
} from './cookies/sync-service.js';
import {
  browsingHistorySchema,
  replaceUserSiteStats,
} from './browsing-history/service.js';
import {
  ACCEPTED_EXTENSIONS,
  ACCEPTED_MIMES,
  FileService,
  UPLOAD_BYTE_LIMIT,
  classifyUpload,
  isMacroOfficeUpload,
  decodeUploadFilename,
  uploadByteLimit,
} from './files/file-service.js';
import { nextExpiryFor, type PayPalAdapter, type PlanId } from './payment/index.js';
import { QuotaService } from './quota/quota-service.js';
import {
  ADDON_PACK_CATALOGUE,
  isAddonPackId,
  newExternalId,
  type AddonPackId,
  type BillingCycle,
} from '@holaday/shared-types';
import { createWebhookTasksHandler } from './api-keys/webhook-handler.js';
import { makeCreateContext } from './trpc/context.js';
import { appRouter } from './trpc/router.js';
import { tasksRouter } from './trpc/routers/tasks.js';

export interface HttpAppDeps {
  planner: Planner;
  visionCommander?: VisionLoopCommander;
  playwrightExecutor?: PlaywrightExecutor | null;
  executionRouter?: ExecutionRouter;
  browserPool?: BrowserPool | null;
  taskQueue?: import('./queue/task-queue.js').TaskQueue | null;
  firecrawl?: import('./firecrawl/firecrawl-lane.js').FirecrawlLane | null;
  paypalAdapter?: PayPalAdapter | null;
  /**
   * Phase 3 R3 — DownloadManager. Optional so integration tests that
   * stand up a partial deps shape don't need to construct the manager;
   * tasks.ts checks for null at the L1 screenshot save site.
   */
  downloadManager?: import('./files/download-manager.js').DownloadManager | null;
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
      //    referrers. Land on `/login` (not `/`) so the SPA's auth
      //    bootstrap is the surface that consumes the hash, instead
      //    of the landing page swallowing it before the SPA mounts.
      const fragment = `#token=${encodeURIComponent(result.accessToken)}`;
      res.redirect(302, `/login${fragment}`);
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

  // Item 6 — short-lived JWT for screencast / VNC WS connections.
  // The SPA fetches one of these per connect, swaps it into the
  // WS URL, and discards it. Keeps the long-lived workbench JWT
  // out of WS error logs (browsers print failed-WS URLs verbatim
  // including the query token), shrinking the leak surface from
  // 7 days to 60 seconds. Auth is the regular bearer middleware
  // — caller proves identity with the long-lived token; the
  // returned stream token is scoped to the streaming audience
  // and can't be replayed against tRPC.
  app.post('/stream-token', async (req, res) => {
    const userExternalId = (req as express.Request & { userId?: string }).userId;
    if (!userExternalId) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    try {
      const { token, expiresIn } = await signStreamToken(userExternalId);
      res.json({ token, expiresIn });
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'stream-token: sign failed',
      );
      res.status(500).json({ error: 'sign_failed' });
    }
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
      // P2 — multer hands us the multipart filename decoded as latin1;
      // recover the UTF-8 so Chinese template names aren't mojibake in the
      // stored file + task summary.
      const filename = decodeUploadFilename(req.file.originalname || 'upload');
      const dotIdx = filename.lastIndexOf('.');
      const ext = dotIdx >= 0 ? filename.slice(dotIdx).toLowerCase() : '';
      // Phase 1 #1 — reject macro-enabled Office (.docm/.xlsm/…) with a
      // clear message before the generic 415; template-safety also blocks
      // them at fill time via vbaProject.bin detection (a renamed .docm).
      if (isMacroOfficeUpload(filename, req.file.mimetype || '')) {
        res.status(415).json({
          error: 'macro_office_unsupported',
          message:
            '出于安全考虑，暂不支持含宏的 Office 文件（.docm/.xlsm 等）。请上传不含宏的 .docx / .xlsx 文件。',
        });
        return;
      }
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

  // ---------------------------------------------------------------------
  // Phase 1 (video) — direct-to-R2 presigned PUT upload (two-phase).
  //
  //   POST /files/upload-url      body { filename, mimetype, sizeBytes }
  //                               → { fileId, uploadUrl, method:'PUT',
  //                                   requiredHeaders, expiresInSeconds }
  //                               Validates plan / mime / declared size,
  //                               writes a status='pending' row, issues a
  //                               presigned R2 PUT URL. The browser PUTs
  //                               the bytes straight to R2, bypassing this
  //                               process (no multer / memoryStorage), so
  //                               a 200MB base video never sits in RAM.
  //   POST /files/upload-confirm  body { fileId }
  //                               → { fileId, filename, mimetype, size }
  //                               HEADs the object, enforces the REAL size
  //                               against the plan cap, flips to 'active'.
  //
  // Requires STORAGE_PROVIDER=r2 + bucket CORS allowing PUT from the SPA
  // origin. On local dev the provider can't presign → 501 and the SPA
  // falls back to the multipart /files/upload path.
  // ---------------------------------------------------------------------
  app.post('/files/upload-url', async (req, res) => {
    const userExternalId = (req as express.Request & { userId?: string }).userId;
    if (!userExternalId) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const body = req.body as { filename?: unknown; mimetype?: unknown; sizeBytes?: unknown };
    const filename = typeof body.filename === 'string' ? decodeUploadFilename(body.filename) : '';
    const mimetype = typeof body.mimetype === 'string' ? body.mimetype : '';
    const declaredSize =
      typeof body.sizeBytes === 'number' && Number.isInteger(body.sizeBytes) ? body.sizeBytes : -1;
    if (!filename || !mimetype || declaredSize <= 0) {
      res
        .status(400)
        .json({ error: 'bad_request', message: 'filename, mimetype, sizeBytes required' });
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
      const planId: PlanId = user.plan === 'basic' || user.plan === 'pro' ? user.plan : 'free';
      if (isMacroOfficeUpload(filename, mimetype)) {
        res.status(415).json({
          error: 'macro_office_not_supported',
          message:
            '出于安全考虑，暂不支持含宏的 Office 文件（.docm/.xlsm 等）。请上传不含宏的 .docx / .xlsx 文件。',
        });
        return;
      }
      const cls = classifyUpload(filename, mimetype);
      if (!cls) {
        res.status(415).json({
          error: 'unsupported_file_type',
          message: `不支持的文件类型：${mimetype || '未知'}`,
        });
        return;
      }
      const cap = uploadByteLimit(cls, planId);
      if (cap === 0) {
        res.status(403).json({
          error: 'plan_does_not_allow_uploads',
          message: '免费版不支持文件上传，升级到基础版即可使用',
        });
        return;
      }
      if (declaredSize > cap) {
        res.status(413).json({
          error: 'file_too_large',
          message: `文件超过当前套餐限制（${Math.floor(cap / (1024 * 1024))}MB）`,
        });
        return;
      }
      const pending = await fileService.createPendingUpload({
        userIdInternal: user.id,
        userExternalId,
        filename,
        mimetype,
        declaredSize,
      });
      if (!pending) {
        res.status(501).json({
          error: 'presigned_unavailable',
          message: '当前环境不支持直传，请使用普通上传',
        });
        return;
      }
      res.status(200).json({
        fileId: pending.fileId,
        uploadUrl: pending.uploadUrl,
        method: 'PUT',
        requiredHeaders: { 'Content-Type': mimetype },
        expiresInSeconds: 900,
      });
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'files/upload-url route crashed',
      );
      res.status(500).json({ error: 'upload_url_failed' });
    }
  });

  app.post('/files/upload-confirm', async (req, res) => {
    const userExternalId = (req as express.Request & { userId?: string }).userId;
    if (!userExternalId) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const body = req.body as { fileId?: unknown };
    const fileId = typeof body.fileId === 'string' ? body.fileId : '';
    if (!fileId) {
      res.status(400).json({ error: 'bad_request', message: 'fileId required' });
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
      const planId: PlanId = user.plan === 'basic' || user.plan === 'pro' ? user.plan : 'free';
      const result = await fileService.confirmUpload({
        userIdInternal: user.id,
        fileExternalId: fileId,
        plan: planId,
      });
      if (!result.ok) {
        if (result.reason === 'not_found') {
          res.status(404).json({ error: 'file_not_found' });
        } else if (result.reason === 'not_uploaded') {
          res.status(409).json({ error: 'not_uploaded', message: '文件尚未上传完成，请重试' });
        } else {
          res.status(413).json({ error: 'file_too_large', message: '文件超过当前套餐限制' });
        }
        return;
      }
      res.status(200).json({
        fileId: result.row.externalId,
        filename: result.row.filename,
        mimetype: result.row.mimetype,
        size: result.row.sizeBytes,
      });
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'files/upload-confirm route crashed',
      );
      res.status(500).json({ error: 'upload_confirm_failed' });
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

  // ---------------------------------------------------------------------
  // Phase 17 — extension cookie sync.
  //
  //   POST /cookies/sync
  //   Headers: Authorization: Bearer <jwt>
  //   Body: { cookies: SyncableCookie[] }
  //
  // Two paths from receipt: if the user has a live Brave instance,
  // inject immediately so the next agent task is already logged in.
  // Otherwise upsert into pending_cookies and let BrowserPool's
  // onInstanceReady hook drain on the next allocate.
  //
  // Per-route json parser bumps the limit to 5MB — power users can
  // legitimately ship a few hundred KB of cookies across the
  // curated domain list, comfortably above the global 1MB cap.
  // ---------------------------------------------------------------------
  app.post(
    '/cookies/sync',
    express.json({ limit: '5mb' }),
    async (req, res) => {
      const userExternalId = (req as express.Request & { userId?: string }).userId;
      if (!userExternalId) {
        res.status(401).json({ error: 'unauthorized' });
        return;
      }
      const body = (req.body ?? {}) as { cookies?: unknown };
      if (!Array.isArray(body.cookies)) {
        res.status(400).json({ error: 'body.cookies must be an array' });
        return;
      }
      if (body.cookies.length === 0) {
        res.json({ synced: 0, domains: [], deferred: false });
        return;
      }
      if (body.cookies.length > MAX_COOKIES_PER_SYNC) {
        res.status(400).json({
          error: 'too_many_cookies',
          message: `最多同步 ${MAX_COOKIES_PER_SYNC} 条`,
        });
        return;
      }
      // zod-validate + domain-whitelist server-side. The extension's
      // own TRACKED_DOMAINS gate is enforced HERE too so a tampered
      // or repurposed extension can't widen the scope to arbitrary
      // sites. Off-list cookies and malformed entries get dropped
      // silently (logged) — never cause a 4xx, since users blame
      // "the cookie sync broke" not "site X isn't tracked".
      const validated: SyncableCookie[] = [];
      let skippedSchema = 0;
      let skippedDomain = 0;
      for (const raw of body.cookies) {
        const parsed = syncableCookieSchema.safeParse(raw);
        if (!parsed.success) {
          skippedSchema += 1;
          continue;
        }
        if (!isAllowedCookieDomain(parsed.data.domain)) {
          skippedDomain += 1;
          continue;
        }
        validated.push(parsed.data);
      }
      if (skippedSchema > 0 || skippedDomain > 0) {
        logger.warn(
          { userExternalId, skippedSchema, skippedDomain, kept: validated.length },
          'cookie-sync: dropped entries failing schema or domain whitelist',
        );
      }
      const cookies = validated;
      if (cookies.length === 0) {
        res.json({ synced: 0, domains: [], deferred: false, dropped: { schema: skippedSchema, domain: skippedDomain } });
        return;
      }
      const [user] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.externalId, userExternalId))
        .limit(1);
      if (!user) {
        res.status(401).json({ error: 'unknown user' });
        return;
      }
      const domains = Array.from(
        new Set(cookies.map((c) => c.domain).filter((d): d is string => typeof d === 'string')),
      );
      // Upsert into pending_cookies first — that way even if the
      // immediate-inject path throws (transient executor death),
      // the next allocate still drains them.
      await upsertPendingCookies(db, user.id, cookies);

      // Try the immediate inject when the user has a live executor.
      // Phase 24 — peekActiveForUser finds whichever active task
      // instance the user currently has (if any). Cookies get
      // injected into that task's context immediately; if no task
      // is active, deferred=true means the next task spawn will
      // pick them up via onInstanceReady.
      let deferred = true;
      const live = deps.browserPool?.peekActiveForUser(userExternalId);
      if (live && live.status === 'ready') {
        try {
          const page = await live.executor.getPage();
          const ctx = page.context();
          await injectPendingCookies({ db, context: ctx, userExternalId });
          deferred = false;
        } catch (err) {
          logger.warn(
            {
              err: err instanceof Error ? err.message : String(err),
              userExternalId,
            },
            'cookie-sync: immediate inject failed; will retry on next allocate',
          );
        }
      }
      res.json({
        synced: cookies.length,
        domains,
        deferred,
      });
    },
  );

  // ---------------------------------------------------------------------
  // Phase 25 — extension browsing-history sync.
  //
  //   POST /extension/browsing-history
  //   Headers: Authorization: Bearer <jwt>
  //   Body: { domains: [{ domain, visitCount, lastVisitAt? }, ...] }
  //
  // The Chrome extension reads `chrome.history.search` for the last
  // 30 days, groups by host client-side, and POSTs the resulting
  // tuples here. The orchestrator does an atomic replace on
  // `user_site_stats` for this user — the extension always sends a
  // full snapshot so per-row upsert + conflict resolution isn't
  // needed.
  //
  // Privacy contract: ONLY host + visit count + last visit timestamp
  // are accepted. Full URLs, query strings, and page titles never
  // touch our backend. The service-side filter additionally drops
  // chrome:// / about: / IP literals (see browsing-history/service.ts).
  //
  // Per-route json parser bumps to 1mb — payloads are typically tens
  // of KB but we let the headroom accommodate users with very wide
  // browsing footprints.
  // ---------------------------------------------------------------------
  app.post(
    '/extension/browsing-history',
    express.json({ limit: '1mb' }),
    async (req, res) => {
      const userExternalId = (req as express.Request & { userId?: string }).userId;
      if (!userExternalId) {
        res.status(401).json({ error: 'unauthorized' });
        return;
      }
      const parsed = browsingHistorySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({
          error: 'invalid_payload',
          // Zod's flatten() is plenty informative for an internal
          // client we control; no need to ship its full issue tree.
          message: parsed.error.issues[0]?.message ?? 'invalid body',
        });
        return;
      }
      const [user] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.externalId, userExternalId))
        .limit(1);
      if (!user) {
        res.status(401).json({ error: 'unknown_user' });
        return;
      }
      try {
        const result = await replaceUserSiteStats(db, user.id, parsed.data);
        logger.info(
          {
            userExternalId,
            ingested: result.ingested,
            rejected: result.rejected,
          },
          'extension: browsing-history sync',
        );
        res.json(result);
      } catch (err) {
        logger.error(
          {
            err: err instanceof Error ? err.message : String(err),
            userExternalId,
          },
          'extension: browsing-history sync failed',
        );
        res.status(500).json({ error: 'sync_failed' });
      }
    },
  );

  // ---------------------------------------------------------------------
  // Phase 11 — internal bridge from the Aliyun cn-payment gateway.
  //
  //   POST /api/internal/payment/confirm
  //   Headers: x-internal-secret = INTERNAL_SHARED_SECRET (env)
  //   Body: { userId, planId, cycle, provider, transactionId,
  //           amountCents, kind, addonPackId? }
  //
  // Idempotent: keys on (provider, transactionId). Duplicate POSTs
  // (cn-payment retries on Vultr 5xx) return ok: true without
  // double-charging or stacking expiries / addon grants.
  //
  // The shared secret lives in BOTH .env files (Vultr +
  // hd-pay.orangebench.tech). Mismatch → 401 + payment stuck pending
  // (cn-payment will retry from logs).
  // ---------------------------------------------------------------------
  const internalConfirmService = new QuotaService(db);
  // NB: route registered WITHOUT the `/api/` prefix because nginx
  // strips it (location /api/ → proxy_pass http://127.0.0.1:4001/;
  // — the trailing slash on the upstream URL is what strips it).
  // External callers still hit https://holaday.ai/api/internal/...,
  // and the gateway's `VULTR_INTERNAL_URL` keeps that public form.
  app.post('/internal/payment/confirm', async (req, res) => {
    const expectedSecret = process.env.INTERNAL_SHARED_SECRET;
    if (!expectedSecret) {
      logger.error('internal-confirm: INTERNAL_SHARED_SECRET unset — refusing all calls');
      res.status(503).json({ error: 'internal_secret_not_configured' });
      return;
    }
    const provided = req.headers['x-internal-secret'];
    if (provided !== expectedSecret) {
      logger.warn(
        { presentedLength: typeof provided === 'string' ? provided.length : -1 },
        'internal-confirm: shared-secret mismatch',
      );
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const body = (req.body ?? {}) as {
      userId?: string;
      planId?: string;
      cycle?: string;
      provider?: string;
      outTradeNo?: string;
      transactionId?: string;
      amountCents?: number;
      kind?: string;
      addonPackId?: string;
    };
    const required: Array<keyof typeof body> = ['userId', 'transactionId', 'amountCents', 'kind', 'provider'];
    for (const k of required) {
      if (body[k] == null) {
        res.status(400).json({ error: `missing field: ${String(k)}` });
        return;
      }
    }
    const provider = body.provider as 'wechat' | 'alipay';
    const transactionId = body.transactionId!;
    const outTradeNo = body.outTradeNo ?? null;
    const amountCents = Number(body.amountCents);
    const kind = body.kind as 'subscription' | 'addon';

    try {
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.externalId, body.userId!))
        .limit(1);
      if (!user) {
        res.status(404).json({ error: 'unknown_user' });
        return;
      }

      const externalId = newExternalId('payment');

      if (kind === 'subscription') {
        const planId = body.planId as PlanId;
        const cycle = body.cycle as BillingCycle;
        if (planId !== 'basic' && planId !== 'pro') {
          res.status(400).json({ error: 'bad_plan' });
          return;
        }
        if (cycle !== 'monthly' && cycle !== 'yearly') {
          res.status(400).json({ error: 'bad_cycle' });
          return;
        }
        const expiry = nextExpiryFor(planId, cycle, user.planExpiresAt ?? null);
        // Insert-or-noop on the (provider, capture_id) unique key.
        // If a concurrent retry already wrote this transactionId, the
        // INSERT noops via ON DUPLICATE KEY UPDATE and the subsequent
        // SELECT shows that retry's externalId — we treat that as a
        // dedup and skip the user-plan extension. Only the writer
        // whose externalId actually landed extends the plan.
        const deduped = await db.transaction(async (tx) => {
          await tx
            .insert(payments)
            .values({
              externalId,
              userExternalId: user.externalId,
              provider,
              providerOrderId: outTradeNo,
              providerCaptureId: transactionId,
              plan: planId,
              amountCents,
              currency: 'CNY',
              status: 'completed',
              kind: 'subscription',
              metadata: { cycle, source: 'cn-payment-gateway' },
            })
            .onDuplicateKeyUpdate({
              set: { externalId: sql`external_id` },
            });
          const [winner] = await tx
            .select({ externalId: payments.externalId })
            .from(payments)
            .where(
              and(
                eq(payments.provider, provider),
                eq(payments.providerCaptureId, transactionId),
              ),
            )
            .limit(1);
          if (!winner) {
            throw new Error('payments row vanished after upsert');
          }
          if (winner.externalId !== externalId) return true;
          await tx
            .update(users)
            .set({ plan: planId, planExpiresAt: expiry })
            .where(eq(users.externalId, user.externalId));
          return false;
        });
        logger.info(
          { userId: user.externalId, planId, cycle, provider, transactionId, deduped },
          deduped ? 'internal-confirm: subscription deduped' : 'internal-confirm: subscription completed',
        );
        res.status(200).json({ ok: true, deduped });
        return;
      }

      if (kind === 'addon') {
        const packId = body.addonPackId;
        if (!packId || !isAddonPackId(packId)) {
          res.status(400).json({ error: 'bad_addon_pack' });
          return;
        }
        const pack = ADDON_PACK_CATALOGUE[packId as AddonPackId];
        // Same insert-or-noop pattern as the subscription path. The
        // applyAddonPack call lives outside the transaction because
        // task_quotas upserts use their own onDuplicateKeyUpdate that
        // doesn't compose with Drizzle's tx wrapper — so the txn is
        // just the row insert + winner check, and we only fire the
        // entitlement when we actually inserted (i.e. not a dup).
        const deduped = await db.transaction(async (tx) => {
          await tx
            .insert(payments)
            .values({
              externalId,
              userExternalId: user.externalId,
              provider,
              providerOrderId: outTradeNo,
              providerCaptureId: transactionId,
              plan: packId,
              amountCents,
              currency: 'CNY',
              status: 'completed',
              kind: 'addon',
              metadata: { source: 'cn-payment-gateway', tasks: pack.tasks, opus: pack.opus },
            })
            .onDuplicateKeyUpdate({
              set: { externalId: sql`external_id` },
            });
          const [winner] = await tx
            .select({ externalId: payments.externalId })
            .from(payments)
            .where(
              and(
                eq(payments.provider, provider),
                eq(payments.providerCaptureId, transactionId),
              ),
            )
            .limit(1);
          if (!winner) {
            throw new Error('payments row vanished after upsert');
          }
          return winner.externalId !== externalId;
        });
        if (!deduped) {
          await internalConfirmService.applyAddonPack(
            user.id,
            (user.plan === 'pro' ? 'pro' : 'basic'),
            packId as AddonPackId,
          );
        }
        logger.info(
          { userId: user.externalId, packId, provider, transactionId, deduped },
          deduped ? 'internal-confirm: addon deduped' : 'internal-confirm: addon pack applied',
        );
        res.status(200).json({ ok: true, deduped });
        return;
      }

      res.status(400).json({ error: 'bad_kind' });
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err), provider, transactionId },
        'internal-confirm: handler crashed',
      );
      // 500 invites cn-payment to retry, which is the right behaviour
      // for transient DB failures. The idempotency check above keeps
      // a successful retry from double-applying.
      res.status(500).json({ error: 'internal_error' });
    }
  });

  // ---------------------------------------------------------------------
  // Phase 12 — internal bridge from the hd-auth gateway for SMS login.
  //
  //   POST /api/internal/auth/sms-login
  //   Headers: x-internal-secret = INTERNAL_SHARED_SECRET (env)
  //   Body: { phone: '13800138000' }
  //   Returns: { user: PublicUser, accessToken: string }
  //
  // The gateway has already verified the SMS code; this endpoint
  // upserts by phone via AuthService.loginOrRegisterByPhone and
  // hands back a freshly-signed JWT for the gateway to relay back
  // to the SPA. Same shared-secret guard as the payment-confirm path.
  // ---------------------------------------------------------------------
  // Same nginx-strip note as /internal/payment/confirm above.
  app.post('/internal/auth/sms-login', async (req, res) => {
    const expectedSecret = process.env.INTERNAL_SHARED_SECRET;
    if (!expectedSecret) {
      logger.error('sms-login: INTERNAL_SHARED_SECRET unset — refusing all calls');
      res.status(503).json({ error: 'internal_secret_not_configured' });
      return;
    }
    if (req.headers['x-internal-secret'] !== expectedSecret) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const body = (req.body ?? {}) as { phone?: string };
    const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      res.status(400).json({ error: 'invalid_phone' });
      return;
    }
    try {
      const svc = new AuthService(db);
      const result = await svc.loginOrRegisterByPhone(phone);
      logger.info(
        { userId: result.user.externalId, plan: result.user.plan },
        'sms-login: user authenticated via gateway',
      );
      res.status(200).json(result);
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err), phone: phone.slice(0, 3) + '****' },
        'sms-login: handler crashed',
      );
      res.status(500).json({ error: 'internal_error' });
    }
  });

  // Phase 5d — webhook route. Nginx strips `/api/` so we mount at
  // `/webhooks/tasks`. The handler does its own bearer auth (API
  // key, not JWT) — the upstream bearerAuth silently no-ops on
  // `hd_live_…` tokens because they don't verify as JWTs.
  const buildContextForUser = (
    userExternalId: string,
  ): import('./trpc/context.js').Context => ({
    db,
    logger,
    // Express req/res stubs — tasks.create doesn't read them; the
    // protected-procedure middleware only gates on ctx.userId.
    req: {} as import('express').Request,
    res: {} as import('express').Response,
    planner: deps.planner,
    visionCommander: deps.visionCommander,
    playwrightExecutor: deps.playwrightExecutor ?? null,
    executionRouter: deps.executionRouter ?? null,
    browserPool: deps.browserPool ?? null,
    taskQueue: deps.taskQueue ?? null,
    firecrawl: deps.firecrawl ?? null,
    paypalAdapter: deps.paypalAdapter ?? null,
    downloadManager: deps.downloadManager ?? null,
    userId: userExternalId,
  });
  const webhookHandler = createWebhookTasksHandler({
    db,
    logger,
    buildContextForUser,
    dispatch: async (ctx, input) => {
      const result = await tasksRouter
        .createCaller(ctx)
        .create({ intent: input.intent });
      return { taskId: result.taskId, status: result.status };
    },
  });
  app.post('/webhooks/tasks', (req, res) => {
    void webhookHandler(req, res);
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
        ...(deps.taskQueue ? { taskQueue: deps.taskQueue } : {}),
        ...(deps.firecrawl ? { firecrawl: deps.firecrawl } : {}),
        ...(deps.paypalAdapter ? { paypalAdapter: deps.paypalAdapter } : {}),
        ...(deps.downloadManager ? { downloadManager: deps.downloadManager } : {}),
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
