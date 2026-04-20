import { ProxyAgent, setGlobalDispatcher } from 'undici';
const _proxy = process.env.HTTPS_PROXY;
if (_proxy) setGlobalDispatcher(new ProxyAgent(_proxy));
import { bootstrap } from 'global-agent';
bootstrap();
import Anthropic from '@anthropic-ai/sdk';
import { DrizzleLlmCallRecorder } from './agent/llm-call-recorder.js';
import { AnthropicPlanner } from './agent/planners/anthropic.js';
import { StubPlanner } from './agent/planners/stub.js';
import {
  AnthropicVisionLoopCommander,
  shouldUseLegacyPlanner,
} from './agent/vision-loop/commander.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { db } from './db/client.js';
import { createHttpApp } from './http.js';
import { createWsServer, loadRehydratedTasks } from './ws/server.js';

async function main() {
  const recorder = new DrizzleLlmCallRecorder(db, {
    onError: (err, call) => {
      logger.warn(
        { err, userExternalId: call.userExternalId, purpose: call.purpose },
        'llm_calls INSERT failed (non-fatal)',
      );
    },
  });
  const planner = env.ANTHROPIC_API_KEY ? new AnthropicPlanner({ recorder }) : new StubPlanner();
  if (!env.ANTHROPIC_API_KEY) {
    logger.warn('ANTHROPIC_API_KEY missing — commander is using StubPlanner');
  }

  // Vision-loop commander (new control plane). Only wired up when the
  // API key is present — without it the vision loop can't call
  // Anthropic anyway. Legacy planner still drives tasks when
  // HOLADAY_USE_LEGACY_PLANNER=1.
  const visionCommander =
    env.ANTHROPIC_API_KEY && !shouldUseLegacyPlanner()
      ? new AnthropicVisionLoopCommander({ client: new Anthropic(), recorder })
      : undefined;
  if (visionCommander) {
    logger.info('vision-loop commander enabled (new control plane)');
  } else if (shouldUseLegacyPlanner()) {
    logger.info('HOLADAY_USE_LEGACY_PLANNER=1 — using legacy plan-once planner');
  }

  const app = createHttpApp({
    planner,
    ...(visionCommander ? { visionCommander } : {}),
  });

  const httpServer = app.listen(env.HTTP_PORT, () => {
    logger.info({ port: env.HTTP_PORT }, 'HTTP server listening');
  });

  const recovery = await loadRehydratedTasks();
  logger.info(recovery, 'restart recovery: rehydrated in-flight tasks');

  // Pass the planner into the WS server so it can call planner.healSelector
  // when a step fails with SELECTOR_NOT_FOUND. StubPlanner's healSelector is
  // a no-op, so when ANTHROPIC_API_KEY is absent we're effectively back to
  // pre-self-heal behaviour (controller's MAX_STEP_RETRIES=1 still retries
  // with the original selector, which is fine for StubPlanner's about:blank
  // smoke).
  const ws = createWsServer(env.WS_PORT, { planner });
  logger.info(
    { port: env.WS_PORT, selfHeal: env.ANTHROPIC_API_KEY ? 'anthropic' : 'stub-noop' },
    'WS server listening',
  );

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
