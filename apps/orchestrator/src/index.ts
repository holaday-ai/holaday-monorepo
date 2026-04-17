import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { createHttpApp } from './http.js';
import { createWsServer } from './ws/server.js';

async function main() {
  const app = createHttpApp();

  const httpServer = app.listen(env.HTTP_PORT, () => {
    logger.info({ port: env.HTTP_PORT }, 'HTTP server listening');
  });

  const ws = createWsServer(env.WS_PORT);
  logger.info({ port: env.WS_PORT }, 'WS server listening');

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutdown requested');
    await ws.close();
    httpServer.close();
    setTimeout(() => process.exit(0), 2000).unref();
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'fatal startup error');
  process.exit(1);
});
