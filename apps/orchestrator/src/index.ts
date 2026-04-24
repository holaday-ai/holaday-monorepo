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
  createApifyAdapter,
  createBraveSearchAdapter,
  createExecutionRouter,
  createZapierAdapter,
  type ExecutionRouter,
} from './agent/supercar/index.js';
import { BrowserPool, reapOrphans } from './browser-pool/index.js';
import { createVncProxy } from './browser-pool/vnc-proxy.js';
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

  // --- Lane 2: headed Chromium via HEADED_CDP_ENDPOINT (optional) ---
  // A separate PlaywrightExecutor instance wired to a dedicated headed
  // Chrome (Xvfb + GUI + real GPU context) that the router swaps to
  // when the headless primary hits high-confidence anti-bot signals.
  // Optional: unset env or failed connect leaves headedExecutor=null
  // and the router reports the lane as 'unavailable' — the app still
  // runs, it just never has a second browser to escalate to.
  let headedExecutor: PlaywrightExecutor | null = null;
  const headedEndpoint = process.env.HEADED_CDP_ENDPOINT;
  if (headedEndpoint) {
    const candidate = new PlaywrightExecutor();
    const r = await candidate.connect(headedEndpoint);
    if (r.ok) {
      headedExecutor = candidate;
      logger.info({ endpoint: headedEndpoint }, 'Lane 2 (headed CDP) ready');
    } else {
      logger.warn(
        { endpoint: headedEndpoint, error: r.error },
        'Lane 2 (headed CDP) unavailable — connect failed',
      );
    }
  } else {
    logger.info('HEADED_CDP_ENDPOINT unset — Lane 2 disabled');
  }

  // --- Lanes 3/4/5: adapter stubs. Each one becomes a functional lane
  // the moment its API key lands in .env. Missing key → adapter null →
  // router reports 'unavailable' and the lane is silently skipped.
  const braveAdapter = createBraveSearchAdapter(process.env.BRAVE_API_KEY ?? null);
  const zapierAdapter = createZapierAdapter(process.env.ZAPIER_API_KEY ?? null);
  const apifyAdapter = createApifyAdapter(process.env.APIFY_API_TOKEN ?? null);

  const executionRouter: ExecutionRouter = createExecutionRouter({
    headless: playwrightExecutor,
    headed: headedExecutor,
    brave: braveAdapter,
    zapier: zapierAdapter,
    apify: apifyAdapter,
  });
  for (const lane of ['headless', 'headed', 'brave', 'zapier', 'apify'] as const) {
    const status = executionRouter.status(lane);
    logger.info(
      { lane, status },
      status === 'ready' ? `Lane ready: ${lane}` : `Lane unavailable: ${lane}`,
    );
  }

  // --- Phase 8: per-user BrowserPool (opt-in).
  // When MULTI_USER=true we reap any orphaned quartets from a prior
  // orchestrator crash, build the pool, and start its idle GC. The
  // pool is NOT wired into the task router in this commit — routing
  // lands in a follow-up so we can flip the env flag without moving
  // live traffic. Unhealthy startup (reaper fails, pool constructor
  // throws) degrades to MULTI_USER=false behaviour, never aborts boot.
  let browserPool: BrowserPool | null = null;
  if (env.MULTI_USER) {
    try {
      const poolConfig = {
        maxInstances: env.MAX_BROWSER_INSTANCES,
        idleTimeoutMs: env.BROWSER_IDLE_TIMEOUT_MS,
        baseDir: env.BROWSER_POOL_DIR,
        cdpPortStart: env.BROWSER_CDP_PORT_START,
        vncPortStart: env.BROWSER_VNC_PORT_START,
        wsPortStart: env.BROWSER_WS_PORT_START,
        displayStart: env.BROWSER_DISPLAY_START,
        screenSize: env.BROWSER_SCREEN_SIZE,
      };
      const reaped = await reapOrphans(poolConfig, logger);
      logger.info(
        { scanned: reaped.scanned, killed: reaped.killed, pids: reaped.pids },
        'MULTI_USER: orphan reaper done',
      );
      browserPool = new BrowserPool(poolConfig, logger);
      browserPool.startGc();
      logger.info(
        {
          capacity: poolConfig.maxInstances,
          baseDir: poolConfig.baseDir,
          cdpPorts: `${poolConfig.cdpPortStart}..${
            poolConfig.cdpPortStart + poolConfig.maxInstances - 1
          }`,
          idleTimeoutMs: poolConfig.idleTimeoutMs,
        },
        'MULTI_USER: BrowserPool ready (not yet routed — task flow still on singleton)',
      );
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'MULTI_USER init failed — falling back to single-instance mode',
      );
      browserPool = null;
    }
  } else {
    logger.info('MULTI_USER=false — using single-instance holaday-chromium-headed');
  }

  const app = createHttpApp({
    planner,
    executionRouter,
    ...(visionCommander ? { visionCommander } : {}),
    ...(playwrightExecutor ? { playwrightExecutor } : {}),
    ...(browserPool ? { browserPool } : {}),
  });

  const httpServer = app.listen(env.HTTP_PORT, () => {
    logger.info({ port: env.HTTP_PORT }, 'HTTP server listening');
  });

  // Per-user VNC WebSocket proxy — only live when the pool is active.
  // Nginx rewrites /vnc-ws/* → 127.0.0.1:4001/vnc-ws/* so this upgrade
  // handler only fires on pool traffic; /ws (tRPC-WS at :4002) is
  // untouched.
  if (browserPool) {
    const allowedUserIds = env.MULTI_USER_USERS.trim()
      ? new Set(
          env.MULTI_USER_USERS.split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        )
      : undefined;
    const vncProxy = createVncProxy(
      allowedUserIds
        ? { pool: browserPool, logger, allowedUserIds }
        : { pool: browserPool, logger },
    );
    httpServer.on('upgrade', (req, socket, head) => {
      vncProxy.handleUpgrade(req, socket, head as Buffer);
    });
    logger.info(
      { allowList: allowedUserIds ? [...allowedUserIds] : 'all users' },
      'VNC WS proxy mounted at /vnc-ws/:userId',
    );
  }

  // Boot-time stale-task sweep. Any task still in a non-terminal
  // status after an orchestrator restart can't make progress — the
  // in-memory queue + agent-loop handle are gone. Mark them failed
  // with a clear error code so the UI shows them as terminal and the
  // queue starts clean. 2-minute cutoff because the orchestrator boot
  // itself takes ~5-10s; anything older than that is definitely stale.
  try {
    const { sql } = await import('drizzle-orm');
    const rows = await db.execute(sql`
      UPDATE tasks
         SET status = 'failed',
             error_code = 'ORCHESTRATOR_RESTART',
             error_message = 'orchestrator restarted while task was in-flight; marked failed on boot sweep',
             updated_at = NOW(3),
             completed_at = NOW(3)
       WHERE status IN ('pending','executing','planning')
         AND created_at < NOW() - INTERVAL 2 MINUTE
    `);
    const changed = (rows as unknown as { affectedRows?: number }).affectedRows ?? 0;
    if (changed > 0) {
      logger.warn({ count: changed }, 'boot sweep: marked stale in-flight tasks as failed');
    }
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'boot sweep failed (non-fatal)');
  }

  const recovery = await loadRehydratedTasks();
  logger.info(recovery, 'restart recovery: rehydrated in-flight tasks');

  // Pass the planner into the WS server so it can call planner.healSelector
  // when a step fails with SELECTOR_NOT_FOUND. StubPlanner's healSelector is
  // a no-op, so when ANTHROPIC_API_KEY is absent we're effectively back to
  // pre-self-heal behaviour (controller's MAX_STEP_RETRIES=1 still retries
  // with the original selector, which is fine for StubPlanner's about:blank
  // smoke).
  const ws = createWsServer(env.WS_PORT, {
    planner,
    playwrightExecutor: playwrightExecutor ?? null,
  });
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
    if (headedExecutor) {
      await headedExecutor.disconnect().catch(() => {});
    }
    if (browserPool) {
      await browserPool.shutdown().catch((err) => {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'BrowserPool shutdown errored (continuing)',
        );
      });
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
