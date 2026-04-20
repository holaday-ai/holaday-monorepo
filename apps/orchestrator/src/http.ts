import { createExpressMiddleware } from '@trpc/server/adapters/express';
import express from 'express';
import { pinoHttp } from 'pino-http';
import type { Planner } from './agent/planner.js';
import type { VisionLoopCommander } from './agent/vision-loop/commander.js';
import { bearerAuth } from './auth/middleware.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { makeCreateContext } from './trpc/context.js';
import { appRouter } from './trpc/router.js';

export interface HttpAppDeps {
  planner: Planner;
  visionCommander?: VisionLoopCommander;
}

export function createHttpApp(deps: HttpAppDeps) {
  const app = express();

  app.use(pinoHttp({ logger }));
  app.use(express.json({ limit: '1mb' }));
  app.use(bearerAuth);

  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok', env: env.NODE_ENV, time: new Date().toISOString() });
  });

  app.use(
    '/trpc',
    createExpressMiddleware({
      router: appRouter,
      createContext: makeCreateContext({
        planner: deps.planner,
        ...(deps.visionCommander ? { visionCommander: deps.visionCommander } : {}),
      }),
    }),
  );

  return app;
}
