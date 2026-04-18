import { createExpressMiddleware } from '@trpc/server/adapters/express';
import express from 'express';
import { pinoHttp } from 'pino-http';
import { bearerAuth } from './auth/middleware.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { createContext } from './trpc/context.js';
import { appRouter } from './trpc/router.js';

export function createHttpApp() {
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
      createContext,
    }),
  );

  return app;
}
