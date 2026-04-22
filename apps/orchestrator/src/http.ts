import { createExpressMiddleware } from '@trpc/server/adapters/express';
import express from 'express';
import { pinoHttp } from 'pino-http';
import type { Planner } from './agent/planner.js';
import type { VisionLoopCommander } from './agent/vision-loop/commander.js';
import type { PlaywrightExecutor } from './agent/vision-loop/playwright-executor.js';
import { bearerAuth } from './auth/middleware.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
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

  // Google OAuth2 endpoint — placeholder that 501s when the deploy has
  // no GOOGLE_CLIENT_ID configured, and redirects to Google's consent
  // page when it does. The callback + token-swap is TODO (tracked
  // separately); frontend hides the button when `auth.loginOptions`
  // reports `google: false`, so no user should hit this by accident.
  app.get('/api/auth/google', (req, res) => {
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
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      access_type: 'online',
      prompt: 'select_account',
    });
    res.redirect(302, `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
  });

  app.get('/api/auth/google/callback', (_req, res) => {
    // Full token-swap + session cookie lands in a follow-up; for now
    // return a 501 so the 1st-half flow above can be tested without
    // claiming completion.
    res.status(501).json({
      error: 'google_oauth_callback_not_implemented',
      message: 'Google 登录 callback 还在实现中',
    });
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
