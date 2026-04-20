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
import { PlaywrightExecutor } from './agent/vision-loop/playwright-executor.js';
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

  // Phase D Step 3: try to connect PlaywrightExecutor to the user's
  // Chrome if EXECUTOR_MODE allows it. On success, VisionLoopRunner
  // will drive the browser directly via Playwright and skip the WS
  // → SW → CDP round-trip. On failure (Chrome not running with
  // --remote-debugging-port, wrong port, etc.) we log a warning
  // and leave the executor unset — task-runner falls back to the
  // legacy WS path automatically.
  let playwrightExecutor: PlaywrightExecutor | null = null;
  if (env.EXECUTOR_MODE !== 'legacy') {
    const candidate = new PlaywrightExecutor();
    const connectResult = await candidate.connect(env.CDP_ENDPOINT);
    if (connectResult.ok) {
      playwrightExecutor = candidate;
      logger.info(
        { cdpEndpoint: env.CDP_ENDPOINT, mode: env.EXECUTOR_MODE },
        'PlaywrightExecutor connected — vision loop will bypass WS/SW',
      );
    } else if (env.EXECUTOR_MODE === 'playwright') {
      // Hard mode: the operator asked for playwright but we can't
      // connect. Don't silently degrade — boot fails loudly so the
      // operator fixes their Chrome launch.
      logger.fatal(
        { cdpEndpoint: env.CDP_ENDPOINT, error: connectResult.error },
        'EXECUTOR_MODE=playwright requested but connectOverCDP failed — is Chrome running with --remote-debugging-port?',
      );
      process.exit(1);
    } else {
      logger.warn(
        { cdpEndpoint: env.CDP_ENDPOINT, error: connectResult.error },
        'PlaywrightExecutor connect failed — falling back to legacy WS/SW path (EXECUTOR_MODE=auto)',
      );
    }
  } else {
    logger.info('EXECUTOR_MODE=legacy — skipping Playwright init');
  }

  const app = createHttpApp({
    planner,
    ...(visionCommander ? { visionCommander } : {}),
    ...(playwrightExecutor ? { playwrightExecutor } : {}),
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
    if (playwrightExecutor) {
      await playwrightExecutor.disconnect().catch(() => {});
    }
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'fatal startup error');
  process.exit(1);
});
