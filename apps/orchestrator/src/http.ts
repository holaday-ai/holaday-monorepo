import { randomBytes } from 'node:crypto';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import express from 'express';
import { pinoHttp } from 'pino-http';
import type { Planner } from './agent/planner.js';
import type { VisionLoopCommander } from './agent/vision-loop/commander.js';
import type { PlaywrightExecutor } from './agent/vision-loop/playwright-executor.js';
import { bearerAuth } from './auth/middleware.js';
import { AuthService } from './auth/service.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { db } from './db/client.js';
import { makeCreateContext } from './trpc/context.js';
import { appRouter } from './trpc/router.js';

export interface HttpAppDeps {
  planner: Planner;
  visionCommander?: VisionLoopCommander;
  playwrightExecutor?: PlaywrightExecutor | null;
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
        email?: string;
        email_verified?: boolean;
        name?: string;
      };
      if (!info.email || info.email_verified === false) {
        logger.warn({ email: info.email }, 'google oauth: unverified email');
        res.redirect(302, '/?auth_error=email_unverified');
        return;
      }
      // 3. Upsert + issue our JWT. Reuses the email-code-login path
      //    because both flows "create-if-missing, else log in" by
      //    email — the existing password hash is untouched for
      //    returning users, and new Google users get a random
      //    password-hash sentinel.
      const svc = new AuthService(db);
      const result = await svc.loginOrRegisterByEmail(info.email);
      logger.info(
        { email: info.email, existing: true },
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

  app.use(
    '/trpc',
    createExpressMiddleware({
      router: appRouter,
      createContext: makeCreateContext({
        planner: deps.planner,
        ...(deps.visionCommander ? { visionCommander: deps.visionCommander } : {}),
        ...(deps.playwrightExecutor ? { playwrightExecutor: deps.playwrightExecutor } : {}),
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
