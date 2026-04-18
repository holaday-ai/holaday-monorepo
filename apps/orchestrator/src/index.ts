import { AnthropicPlanner } from './agent/planners/anthropic.js';
import { StubPlanner } from './agent/planners/stub.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { createHttpApp } from './http.js';
import { createWsServer, loadRehydratedTasks } from './ws/server.js';

async function main() {
  const planner = env.ANTHROPIC_API_KEY ? new AnthropicPlanner() : new StubPlanner();
  if (!env.ANTHROPIC_API_KEY) {
    logger.warn('ANTHROPIC_API_KEY missing — commander is using StubPlanner');
  }

  const app = createHttpApp({ planner });

  const httpServer = app.listen(env.HTTP_PORT, () => {
    logger.info({ port: env.HTTP_PORT }, 'HTTP server listening');
  });

  const recovery = await loadRehydratedTasks();
  logger.info(recovery, 'restart recovery: rehydrated in-flight tasks');

  const ws = createWsServer(env.WS_PORT);
  logger.info({ port: env.WS_PORT }, 'WS server listening');

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutdown requested');
    await ws.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'fatal startup error');
  process.exit(1);
});
