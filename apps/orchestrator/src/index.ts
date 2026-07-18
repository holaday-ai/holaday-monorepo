import { ProxyAgent, setGlobalDispatcher } from 'undici';
const _proxy = process.env.HTTPS_PROXY;
if (_proxy) setGlobalDispatcher(new ProxyAgent(_proxy));
import { bootstrap } from 'global-agent';
bootstrap();
import Anthropic from '@anthropic-ai/sdk';
import { isBriefingIntent } from './agent/a-share/briefing-dispatch.js';
import { DrizzleLlmCallRecorder } from './agent/llm-call-recorder.js';
import { AnthropicPlanner } from './agent/planners/anthropic.js';
import { StubPlanner } from './agent/planners/stub.js';
import {
  recoverStuckRunningScheduledTasks,
  startScheduledRunner,
} from './agent/scheduled-runner.js';
import { failStaleTasksWithEvents } from './agent/task-maintenance.js';
import {
  type ExecutionRouter,
  createApifyAdapter,
  createExecutionRouter,
  createZapierAdapter,
} from './agent/supercar/index.js';
import {
  AnthropicVisionLoopCommander,
  shouldUseLegacyPlanner,
} from './agent/vision-loop/commander.js';
import { PlaywrightExecutor } from './agent/vision-loop/playwright-executor.js';
import { defaultBrowserNetworkPolicy } from './agent/browser-network-policy.js';
import { BrowserPool, reapOrphans } from './browser-pool/index.js';
import { createVncProxy } from './browser-pool/vnc-proxy.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { injectPendingCookies } from './cookies/sync-service.js';
import { db } from './db/client.js';
import { runRetentionReaper } from './evidence/retention-reaper.js';
import { createHttpApp } from './http.js';
import { buildScheduledDispatchNotification } from './notifications/scheduled-copy.js';
import { createPayPalAdapter } from './payment/index.js';
import { type TaskQueue, createTaskQueue } from './queue/task-queue.js';
import { createScreencastProxy } from './streaming/screencast-proxy.js';
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
    const candidate = new PlaywrightExecutor({ networkPolicy: defaultBrowserNetworkPolicy });
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
      // Local QA must not require a developer to manually launch Chrome
      // with a debugging port. Start a clean headless Chrome context in
      // development; it is isolated from the user's normal Chrome profile.
      const managedResult =
        env.NODE_ENV === 'development'
          ? await candidate.launchManaged({
              ...(process.platform === 'darwin' ? { channel: 'chrome' } : {}),
              headless: true,
            })
          : { ok: false as const, error: 'managed launch is development-only' };
      if (managedResult.ok) {
        playwrightExecutor = candidate;
        logger.info(
          { mode: env.EXECUTOR_MODE, browser: 'managed-isolated' },
          'PlaywrightExecutor launched managed local browser',
        );
      } else {
        logger.warn(
          {
            cdpEndpoint: env.CDP_ENDPOINT,
            connectError: connectResult.error,
            managedError: managedResult.error,
          },
          'PlaywrightExecutor unavailable — falling back to legacy WS/SW path',
        );
      }
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
    const candidate = new PlaywrightExecutor({ networkPolicy: defaultBrowserNetworkPolicy });
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

  // --- Lanes 4/5: adapter stubs. Each one becomes a functional lane
  // the moment its API key lands in .env. Missing key → adapter null →
  // router reports 'unavailable' and the lane is silently skipped.
  // (Lane 3 / Brave Search retired — search now goes through Anthropic's
  // built-in web_search_20260209 tool inside the model loop.)
  const zapierAdapter = createZapierAdapter(process.env.ZAPIER_API_KEY ?? null);
  const apifyAdapter = createApifyAdapter(process.env.APIFY_API_TOKEN ?? null);

  const executionRouter: ExecutionRouter = createExecutionRouter({
    headless: playwrightExecutor,
    headed: headedExecutor,
    zapier: zapierAdapter,
    apify: apifyAdapter,
  });
  for (const lane of ['headless', 'headed', 'zapier', 'apify'] as const) {
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
  let taskQueue: TaskQueue | null = null;
  const useNativeDevelopmentPool =
    env.NODE_ENV === 'development' && process.platform === 'darwin';
  if (env.MULTI_USER || useNativeDevelopmentPool) {
    try {
      const poolConfig = {
        maxInstances: useNativeDevelopmentPool
          ? Math.min(env.MAX_BROWSER_INSTANCES, 3)
          : env.MAX_BROWSER_INSTANCES,
        idleTimeoutMs: env.BROWSER_IDLE_TIMEOUT_MS,
        baseDir: useNativeDevelopmentPool
          ? '/tmp/holaday-browser-pool'
          : env.BROWSER_POOL_DIR,
        cdpPortStart: env.BROWSER_CDP_PORT_START,
        vncPortStart: env.BROWSER_VNC_PORT_START,
        wsPortStart: env.BROWSER_WS_PORT_START,
        displayStart: env.BROWSER_DISPLAY_START,
        screenSize: env.BROWSER_SCREEN_SIZE,
        // Phase 17 — drain pending cookies (extension-shipped) into
        // the freshly-spawned context. Best-effort: errors logged
        // inside the helper, never bubble up to block allocate.
        onInstanceReady: async (
          userExternalId: string,
          executor: PlaywrightExecutor,
        ): Promise<void> => {
          try {
            const page = await executor.getPage();
            const ctx = page.context();
            await injectPendingCookies({ db, context: ctx, userExternalId });
          } catch (err) {
            logger.warn(
              { err: err instanceof Error ? err.message : String(err), userExternalId },
              'pool: onInstanceReady cookie-sync drain failed',
            );
          }
        },
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
          runtime: useNativeDevelopmentPool ? 'native-chromium' : 'linux-sidecars',
        },
        // Phase 19c follow-up — the prior wording ("not yet routed —
        // task flow still on singleton") was stale. Tasks have been
        // routing through the per-user pool since the
        // `shouldUseBrowserPool` gate flipped to unconditional-true:
        // tasks.ts line ~561 calls pool.allocate(userId) then sets
        // `primaryExecutor = perUserExec ?? headedSingleton ??
        // headlessSingleton`. The singleton lanes are now the
        // fallback for "pool.allocate threw" only.
        'MULTI_USER: BrowserPool ready — task flow routed through per-user pool (singleton lanes are fallback only)',
      );
      // Phase 24 RC follow-up — TaskQueue gates dispatch to the pool
      // so a 30-task burst can't overrun the 10 slots. Tied to the
      // pool's lifetime: lives only when MULTI_USER pool came up.
      // The pool's own canAllocate() is the dispatch predicate; the
      // queue tracks its own inFlight counter to pace burst dispatch
      // (canAllocate is a snapshot — it stays true while a freshly-
      // dispatched task is still in pool.allocate's spawn path).
      const poolForQueue = browserPool;
      taskQueue = createTaskQueue({
        canDispatch: () => poolForQueue.canAllocate(),
        capacity: poolConfig.maxInstances,
        tickMs: 5000,
        maxDepth: 100,
        queueTimeoutMs: 10 * 60 * 1000,
        logger: (level, msg, ctx) => logger[level](ctx ?? {}, msg),
      });
      logger.info(
        { capacity: poolConfig.maxInstances, tickMs: 5000, maxDepth: 100, queueTimeoutMs: 600000 },
        'TaskQueue ready — pool-capacity-aware FIFO active',
      );
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'MULTI_USER init failed — falling back to single-instance mode',
      );
      browserPool = null;
      taskQueue = null;
    }
  } else {
    logger.info('MULTI_USER=false — using single-instance holaday-chromium-headed');
  }

  // --- Phase 9: PayPal Checkout adapter (sandbox by default).
  // Constructs only when both client id + secret are present; null
  // otherwise so the payment router can return PRECONDITION_FAILED
  // and the SPA hides the upgrade button gracefully.
  const paypalAdapter = createPayPalAdapter({
    clientId: process.env.PAYPAL_CLIENT_ID ?? null,
    clientSecret: process.env.PAYPAL_CLIENT_SECRET ?? null,
    env: process.env.PAYPAL_ENV === 'live' ? 'live' : 'sandbox',
  });
  if (paypalAdapter) {
    logger.info({ env: paypalAdapter.env }, 'PayPal adapter ready');
  } else {
    logger.info('PayPal adapter disabled — PAYPAL_CLIENT_ID/_SECRET not set');
  }

  // Phase 24 RC follow-up — Firecrawl adapter for the new 'scrape'
  // execution mode + supercar's scrape_website tool. Boots only when
  // FIRECRAWL_API_KEY is in env; otherwise scrape-mode tasks fail
  // loudly with a "not configured" reason instead of silently
  // routing to the (much more expensive) browser path.
  let firecrawlLane: import('./firecrawl/firecrawl-lane.js').FirecrawlLane | null = null;
  if (env.FIRECRAWL_API_KEY) {
    const { createFirecrawlLane } = await import('./firecrawl/firecrawl-lane.js');
    firecrawlLane = createFirecrawlLane({
      apiKey: env.FIRECRAWL_API_KEY,
      baseUrl: env.FIRECRAWL_BASE_URL,
      // A5 — surface HTTP status / body / abort details when Firecrawl
      // fails so prod log triage doesn't have to reproduce the upstream
      // request to know whether it was a 4xx, 5xx, or a timeout.
      logger: logger.child({ component: 'firecrawl' }),
    });
    logger.info(
      { baseUrl: env.FIRECRAWL_BASE_URL, keyPrefix: env.FIRECRAWL_API_KEY.slice(0, 6) },
      'Firecrawl adapter ready',
    );
  } else {
    logger.info('Firecrawl adapter disabled — FIRECRAWL_API_KEY not set');
  }

  // Phase 5c+P5-fix — eagerly construct the shared StorageProvider
  // at boot. The factory throws on misconfigured R2 (STORAGE_PROVIDER=
  // r2 with missing R2_* creds), so we want that failure visible at
  // pm2 start rather than deferred to the first file upload. The
  // singleton is then memoized in storage-provider.ts and consumed by
  // every FileService default constructor + the http.ts upload route.
  const { getSharedStorageProvider } = await import('./files/storage-provider.js');
  const sharedStorage = getSharedStorageProvider({ logger });
  logger.info(
    { providerKind: sharedStorage.constructor.name },
    'storage: shared provider initialized',
  );

  // Phase 3 R3 — DownloadManager. Wraps the existing FileService with
  // a 50MB cap + URL construction. FileService is constructed inside
  // createHttpApp today, so we stand up a parallel instance here for
  // the manager (FileService is stateless — the DB pool is shared
  // through the singleton `db` import). FileService picks up the
  // shared storage singleton via its default constructor branch.
  const downloadFileService = new (await import('./files/file-service.js')).FileService(db, logger);
  const downloadManager = new (await import('./files/download-manager.js')).DownloadManager(
    downloadFileService,
    env.HOLADAY_PUBLIC_BASE_URL,
  );

  const app = createHttpApp({
    planner,
    executionRouter,
    downloadManager,
    ...(visionCommander ? { visionCommander } : {}),
    ...(playwrightExecutor ? { playwrightExecutor } : {}),
    ...(browserPool ? { browserPool } : {}),
    ...(taskQueue ? { taskQueue } : {}),
    ...(firecrawlLane ? { firecrawl: firecrawlLane } : {}),
    ...(paypalAdapter ? { paypalAdapter } : {}),
  });

  const httpServer = app.listen(env.HTTP_PORT, () => {
    logger.info({ port: env.HTTP_PORT }, 'HTTP server listening');
  });

  // Phase 5d follow-up — periodic cleanup of expired webhook
  // idempotency rows (24h TTL). Fires once on boot + then every
  // 60min. Lookup-time guard already treats expired rows as missing
  // so this is purely about table bloat.
  {
    const { startIdempotencyCleanup } = await import('./api-keys/webhook-idempotency-service.js');
    startIdempotencyCleanup({ db, logger });
  }

  // Codex P5 follow-up — boot sweep for scheduled_tasks rows stuck in
  // 'running'. A pm2 restart that landed mid-dispatch left the row
  // wedged in 'running'; the runner's tick only matches 'active',
  // so the row would never fire again. Restore them to 'active' so
  // the next tick re-claims atomically + dispatches. Worst case: one
  // extra fire (acceptable vs. silent stop).
  await recoverStuckRunningScheduledTasks(db);

  // Phase 5a — scheduled-tasks polling loop, NOW with real dispatch.
  // The Phase 16b version was a logger stub; this version wires
  // tasksRouter.createCaller so a fired schedule actually creates +
  // dispatches a task as the owning user.
  //
  // Context construction: we synthesize the ctx the protectedProcedure
  // middleware expects — userId (resolved from user_internal_id),
  // db, logger, plus every adapter handle in scope. req / res are
  // stubbed because tasks.create doesn't read either; the protected
  // procedure middleware only gates on ctx.userId.
  //
  // Single-instance assumption stays: only one orchestrator pm2
  // process polls, so two runs of the same schedule can't race.
  // Quota / concurrency limits inside tasks.create still apply, so a
  // schedule firing on a user who's at their concurrent task limit
  // throws — runner advances next_run_at anyway (the dispatch result
  // is null but the row moves forward so it doesn't tight-retry).
  {
    const { tasksRouter } = await import('./trpc/routers/tasks.js');
    const { users: usersTable } = await import('./db/schema/users.js');
    const { tasks: tasksTable } = await import('./db/schema/tasks.js');
    const { eq } = await import('drizzle-orm');
    // §6c — A股简报 dispatch 连续失败计数（per-process 内存；成功重置，≥3 发 inbox 错误）。
    const briefingFailCounts = new Map<number, number>();
    startScheduledRunner({
      db,
      dispatch: async ({ scheduledTaskId, userInternalId, intent }) => {
        try {
          // §6c — A股每日简报：哨兵 intent → 直接组装渲染 + 投递 inbox（不走通用
          // agent 任务）。失败只影响该用户该任务；连续 3 次降级为 inbox 错误通知。
          if (isBriefingIntent(intent)) {
            const { runBriefingDispatch } = await import('./agent/a-share/briefing-dispatch.js');
            const { HttpAkshareClient } = await import('./agent/a-share/akshare-http-client.js');
            const { notify } = await import('./notifications/notification-service.js');
            const client = new HttpAkshareClient({
              baseUrl: process.env.AKSHARE_HTTP_URL ?? 'http://127.0.0.1:8848',
              logger,
            });
            try {
              const r = await runBriefingDispatch(
                { db, client, notify: (input) => notify({ db, logger }, input) },
                { scheduledTaskInternalId: scheduledTaskId, userInternalId, intent },
              );
              briefingFailCounts.delete(scheduledTaskId);
              // P1 非交易日：未投递，回带 skip → runner 记 last_run_status='skipped' + note。
              if (r.skipped)
                return { skipped: true as const, note: r.reason ?? '非交易日，未投递' };
              return scheduledTaskId; // 非 null = 成功（简报无 task 行）
            } catch (err) {
              const fails = (briefingFailCounts.get(scheduledTaskId) ?? 0) + 1;
              briefingFailCounts.set(scheduledTaskId, fails);
              logger.warn(
                { err: err instanceof Error ? err.message : String(err), scheduledTaskId, fails },
                'scheduled-runner: briefing dispatch failed',
              );
              if (fails >= 3) {
                briefingFailCounts.set(scheduledTaskId, 0);
                await notify(
                  { db, logger },
                  {
                    userInternalId,
                    scheduledTaskInternalId: scheduledTaskId,
                    type: 'task_failed',
                    title: 'A股简报生成失败',
                    message: '每日 A股简报连续多次生成失败。请稍后重试，或在设置中关闭后重新开启。',
                  },
                ).catch(() => {});
              }
              return null; // 仅本任务记 failed，下个 interval 重试本任务，不影响他人
            }
          }
          const [user] = await db
            .select({ externalId: usersTable.externalId })
            .from(usersTable)
            .where(eq(usersTable.id, userInternalId))
            .limit(1);
          if (!user) {
            logger.warn(
              { scheduledTaskId, userInternalId },
              'scheduled-runner: owning user not found — skipping',
            );
            return null;
          }
          // Minimal Context for createCaller. Cast the req/res to
          // unknown because tasks.create never reads them — making
          // them undefined would compile-fail Context, so we stub
          // with an empty object. If a future handler starts reading
          // ctx.req.headers (etc.) it'd surface here.
          const ctx = {
            db,
            logger,
            req: {} as unknown as import('express').Request,
            res: {} as unknown as import('express').Response,
            planner,
            visionCommander: visionCommander ?? undefined,
            playwrightExecutor: playwrightExecutor ?? null,
            executionRouter,
            browserPool: browserPool ?? null,
            taskQueue: taskQueue ?? null,
            firecrawl: firecrawlLane ?? null,
            paypalAdapter: paypalAdapter ?? null,
            downloadManager,
            userId: user.externalId,
          };
          const result = await tasksRouter.createCaller(ctx).create({ intent });
          // Resolve the new external taskId back to the internal
          // bigint id so the runner can stamp last_task_id (used by
          // the SPA list view's "上次运行 → tsk_…" link).
          const [taskRow] = await db
            .select({ id: tasksTable.id })
            .from(tasksTable)
            .where(eq(tasksTable.externalId, result.taskId))
            .limit(1);
          logger.info(
            {
              scheduledTaskId,
              ownerExternalId: user.externalId,
              dispatchedTaskId: result.taskId,
              executionMode: result.executionMode,
            },
            'scheduled-runner: dispatched',
          );
          return taskRow?.id ?? null;
        } catch (err) {
          logger.warn(
            {
              err: err instanceof Error ? err.message : String(err),
              scheduledTaskId,
            },
            'scheduled-runner: dispatch failed',
          );
          return null;
        }
      },
      // Phase 26B — wire the notification service so scheduled
      // dispatch attempts land in the user's inbox + fire any
      // configured webhooks. The notify hook is best-effort; the
      // runner ignores its return value and never blocks on it.
      notify: async ({ userInternalId, scheduledTaskInternalId, intent, ok, error, skipped }) => {
        // 简报 intent 的通知由 dispatch 分支自管（成功投递简报 + 3 连败错误）→ 跳过通用。
        if (isBriefingIntent(intent)) return;
        const { notify } = await import('./notifications/notification-service.js');
        const payload = buildScheduledDispatchNotification({ intent, ok, error, skipped });
        await notify(
          { db, logger },
          {
            userInternalId,
            scheduledTaskInternalId,
            type: payload.type,
            title: payload.title,
            message: payload.message,
            taskName: payload.taskName,
          },
        );
      },
      // Phase 26B follow-up — reminder hook. Fires when the
      // configured lead-time window opens and the runner has
      // atomically claimed the cycle (so no double-fire).
      notifyReminder: async ({
        userInternalId,
        scheduledTaskInternalId,
        intent,
        nextRunAt,
        reminderMinutes,
      }) => {
        const { notify } = await import('./notifications/notification-service.js');
        const truncatedIntent = intent.length > 60 ? `${intent.slice(0, 60)}…` : intent;
        const fireLocal = nextRunAt.toLocaleString('zh-CN', {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'Asia/Shanghai',
        });
        const leadCopy =
          reminderMinutes === 0
            ? '即将开始'
            : reminderMinutes < 60
              ? `${reminderMinutes} 分钟后开始`
              : `${Math.round(reminderMinutes / 60)} 小时后开始`;
        await notify(
          { db, logger },
          {
            userInternalId,
            scheduledTaskInternalId,
            type: 'task_reminder',
            title: '定时任务提醒',
            message: `「${truncatedIntent}」${leadCopy}（${fireLocal}）。`,
            taskName: truncatedIntent,
          },
        );
      },
    });

    // Phase 1 #2 — A股简报缓存预热（BOSS 拍板：冷缓存 → 预热，简报 10s 超时不动）。
    // 08:25 / 15:25 北京（简报前 5 分钟）用长超时(30s)客户端把 /index/us·hk·cn 各
    // 调一遍填 akshare-mcp 缓存(TTL 600s)，5 分钟后简报以 10s 读暖缓存即时返回。
    {
      const { startPrewarmScheduler, warmSharedCaches, warmSymbolTable } = await import(
        './agent/a-share/prewarm-scheduler.js'
      );
      const { HttpAkshareClient } = await import('./agent/a-share/akshare-http-client.js');
      const akshareBaseUrl = process.env.AKSHARE_HTTP_URL ?? 'http://127.0.0.1:8848';
      const prewarmClient = new HttpAkshareClient({
        baseUrl: akshareBaseUrl,
        timeoutMs: 30_000,
        logger,
      });
      startPrewarmScheduler({
        warm: async () => {
          await warmSharedCaches(prewarmClient);
          // ④ 短名解析全量代码名称表（开盘前刷新一次；~70s 长超时，不阻塞简报）。
          await warmSymbolTable(akshareBaseUrl);
        },
        logger,
      });
      logger.info({ times: ['08:25', '15:25'] }, 'prewarm: A股简报缓存预热调度已启动');
    }
  }

  // Per-user VNC WebSocket proxy — only live when the pool is active.
  // Nginx (Vultr or Aliyun edge) rewrites /vnc-ws/* → 127.0.0.1:4001/vnc-ws/*
  // so this upgrade handler only fires on pool traffic; /ws (tRPC-WS
  // at :4002) is untouched.
  //
  // Phase 14 audit follow-up — the MULTI_USER_USERS allowlist gate was
  // retired here too. The proxy still requires JWT auth + checks the
  // user owns a live pool instance, so dropping the allowlist doesn't
  // open it to abuse — it just stops blocking new free-plan users
  // from streaming THEIR OWN browser.
  if (browserPool) {
    const vncProxy = createVncProxy({ pool: browserPool, logger });
    // Phase 19 — CDP screencast proxy mounted SIDE-BY-SIDE with VNC.
    // Both run; the SPA's BrowserPanel picks which transport to use
    // via a localStorage feature flag (holaday.streamTransport=cdp).
    // Default stays on VNC until BOSS verifies CDP path live in prod.
    // See streaming/screencast-proxy.ts for the protocol contract.
    const screencastProxy = createScreencastProxy({ pool: browserPool, logger });
    httpServer.on('upgrade', (req, socket, head) => {
      const url = req.url ?? '';
      // Try the CDP path first (cheaper regex, fewer matches), then
      // fall through to VNC. Each handler is no-op when its path
      // pattern doesn't match.
      if (url.startsWith('/screencast-ws/')) {
        screencastProxy.handleUpgrade(req, socket, head as Buffer);
        return;
      }
      vncProxy.handleUpgrade(req, socket, head as Buffer);
    });
    logger.info(
      'VNC WS proxy mounted at /vnc-ws/:userId; CDP screencast at /screencast-ws/:userId',
    );
  }

  // Boot-time stale-task sweep. Transient server-side states that
  // still exist after an orchestrator restart have lost their
  // process-local queue/planner handle. Mark stale rows failed with
  // a clear error code so the UI shows them as terminal and the queue
  // starts clean. 2-minute cutoff because the orchestrator boot
  // itself takes ~5-10s; anything older than that is definitely stale.
  try {
    const restartMessage = '服务重启导致任务中断，重新发送一次即可。';
    const changed = await failStaleTasksWithEvents(db, {
      source: 'boot_sweep',
      sourceStatuses: ['pending', 'planning', 'queued', 'executing'],
      staleBy: 'createdAt',
      cutoff: new Date(Date.now() - 2 * 60_000),
      errorCode: 'ORCHESTRATOR_RESTART',
      // User-facing error_message; the stable diagnostic is in
      // error_code above. Keep this short + actionable since the
      // SPA renders it verbatim inside the failed-task card.
      errorMessage: restartMessage,
    });
    // Phase 3 R1 — also reap stale awaiting_user tasks. With the new
    // state-machine guard, agent-loop's takeover-timeout no longer
    // overwrites awaiting_user with completed, so parked tasks that
    // the user never came back to now persist indefinitely (and count
    // against the per-user concurrency limit). 35 min is the
    // agent-loop's takeover window (30 min) + buffer; rows older than
    // that are definitely abandoned. Bypass user accumulates these
    // fastest because eval suites kick off many parking cases.
    // The boot-sweep threshold also defaults to 35 minutes, but
    // can be tightened via env var for one-off cleanup. After the
    // Phase 3 R1 state-machine guard landed, the bypass eval user
    // accumulated 100 awaiting_user tasks (the guard now prevents
    // takeover-timeout from auto-completing them, but the runtime
    // reaper hadn't existed yet). Set BOOT_SWEEP_AWAITING_USER_MIN=5
    // for one deploy to flush, then restore.
    const bootAwaitingMin = Number.parseInt(process.env.BOOT_SWEEP_AWAITING_USER_MIN ?? '35', 10);
    const parkChanged = await failStaleTasksWithEvents(db, {
      source: 'boot_sweep',
      sourceStatuses: ['awaiting_user'],
      staleBy: 'updatedAt',
      cutoff: new Date(Date.now() - bootAwaitingMin * 60_000),
      errorCode: 'AWAITING_USER_TIMEOUT',
      errorMessage: `等待用户响应超时（>${bootAwaitingMin}分钟），任务已自动释放。`,
      clearAwaiting: true,
    });
    if (changed > 0) {
      logger.warn({ count: changed }, 'boot sweep: marked stale in-flight tasks as failed');
    } else {
      logger.info('boot sweep: no stale in-flight tasks to mark');
    }
    if (parkChanged > 0) {
      logger.warn(
        { count: parkChanged, thresholdMin: bootAwaitingMin },
        'boot sweep: marked stale awaiting_user parks as failed',
      );
    } else {
      logger.info(
        { thresholdMin: bootAwaitingMin },
        'boot sweep: no stale awaiting_user parks to mark',
      );
    }
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'boot sweep failed (non-fatal)',
    );
  }

  // Phase 22a — runtime zombie reaper. Boot sweep above only fires at
  // restart; tasks that go zombie DURING a long-lived orchestrator
  // session (uncaught throw in the runner that escaped the catch
  // chains, Anthropic SDK hang past every internal timeout, DB blip
  // mid-persist) used to sit at status='executing' until BOSS asked
  // for a pm2 restart. This sweep runs every 60s and marks any task
  // that's been at 'executing' with no updated_at change for more than
  // ZOMBIE_REAP_THRESHOLD_MIN as failed. The threshold is intentionally
  // generous (Phase 24: 20 min, was 15 min) — per-task pool means one
  // task can legitimately hold its instance for the full 20-min window
  // (long research, multi-page extraction). Any task touching the DB
  // via persist hooks within that window keeps itself out of the reap.
  const ZOMBIE_REAP_INTERVAL_MS = 60_000;
  const ZOMBIE_REAP_THRESHOLD_MIN = 20;
  // Phase 3 R1 — runtime sweep also covers stale awaiting_user. Same
  // 35-min threshold as the boot-sweep counterpart; marks parked tasks
  // the user never came back to as failed so they stop counting against
  // per-user concurrency. Without this, a Vultr session that runs for
  // weeks (no restart triggering boot sweep) accumulates abandoned
  // parks and eventually wedges the bypass user / heavy users.
  const AWAITING_USER_REAP_THRESHOLD_MIN = 35;
  const zombieReaperTimer = setInterval(() => {
    void (async () => {
      try {
        const changed = await failStaleTasksWithEvents(db, {
          source: 'runtime_zombie_reaper',
          sourceStatuses: ['executing'],
          staleBy: 'updatedAt',
          cutoff: new Date(Date.now() - ZOMBIE_REAP_THRESHOLD_MIN * 60_000),
          errorCode: 'EXECUTION_TIMEOUT',
          errorMessage: `任务执行超过 ${ZOMBIE_REAP_THRESHOLD_MIN} 分钟未更新，已自动标记失败。`,
        });
        if (changed > 0) {
          logger.warn(
            { count: changed, thresholdMin: ZOMBIE_REAP_THRESHOLD_MIN },
            'zombie reaper: marked stale executing tasks as failed',
          );
        }
        const parkChanged = await failStaleTasksWithEvents(db, {
          source: 'runtime_zombie_reaper',
          sourceStatuses: ['awaiting_user'],
          staleBy: 'updatedAt',
          cutoff: new Date(Date.now() - AWAITING_USER_REAP_THRESHOLD_MIN * 60_000),
          errorCode: 'AWAITING_USER_TIMEOUT',
          errorMessage: `等待用户响应超时（>${AWAITING_USER_REAP_THRESHOLD_MIN}分钟），任务已自动释放。`,
          clearAwaiting: true,
        });
        if (parkChanged > 0) {
          logger.warn(
            { count: parkChanged, thresholdMin: AWAITING_USER_REAP_THRESHOLD_MIN },
            'zombie reaper: marked stale awaiting_user parks as failed',
          );
        }
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'zombie reaper: sweep failed (non-fatal)',
        );
      }
    })();
  }, ZOMBIE_REAP_INTERVAL_MS);
  // Don't keep the event loop alive on a sleeping timer; the HTTP
  // server is what holds the process up.
  zombieReaperTimer.unref?.();

  // Phase 1 #3 Pack B — Evidence retention reaper. Nightly sweep of
  // expired evidence_artifacts (delete R2 object then MySQL row; skip
  // manual_hold). Gated by RETENTION_REAPER_ENABLED (default off: no
  // artifacts exist until LEDGER_DB_WRITE is on). unref so a sleeping
  // timer never holds the process up.
  if (process.env.RETENTION_REAPER_ENABLED === "true") {
    const RETENTION_REAP_INTERVAL_MS = 24 * 60 * 60 * 1000;
    const retentionReaperTimer = setInterval(() => {
      void (async () => {
        try {
          const swept = await runRetentionReaper({ db, logger });
          if (swept.deleted > 0 || swept.r2Failed > 0) {
            logger.info(swept, "retention reaper: swept expired evidence artifacts");
          }
        } catch (err) {
          logger.warn(
            { err: err instanceof Error ? err.message : String(err) },
            "retention reaper: sweep failed (non-fatal)",
          );
        }
      })();
    }, RETENTION_REAP_INTERVAL_MS);
    retentionReaperTimer.unref?.();
  }

  // Phase 1 Playbook ④ B1 — user-task crystallize sweep. Low-frequency cron that distils
  // completed/partial_success tasks WITH captures (incl. origin='user' real trajectories — the
  // crystallizer has no origin filter) into DRAFT operation_paths. Reuses crystallizeTasks
  // UNCHANGED (commit mode); idempotent (dedup by source_task_id). WRITE-ONLY sink → nothing
  // reads operation_paths back into the live lane, so ZERO live-user impact. Off the request
  // path entirely. Gated by USER_TASK_CRYSTALLIZE_ENABLED (default off). unref so it never holds
  // the process up.
  if (process.env.USER_TASK_CRYSTALLIZE_ENABLED === "true") {
    const { crystallizeTasks } = await import("./playbook/crystallizer.js");
    const USER_CRYSTALLIZE_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h
    const runSweep = () =>
      void (async () => {
        try {
          const r = await crystallizeTasks({ db }, { dryRun: false });
          if (r.planned.length > 0) {
            logger.info(
              { created: r.planned.length, scanned: r.scannedTasks, skipped: r.skipped.length },
              "user-task crystallize sweep: distilled trajectories into draft operation_paths",
            );
          }
        } catch (err) {
          logger.warn(
            { err: err instanceof Error ? err.message : String(err) },
            "user-task crystallize sweep: failed (non-fatal)",
          );
        }
      })();
    const userCrystallizeTimer = setInterval(runSweep, USER_CRYSTALLIZE_INTERVAL_MS);
    userCrystallizeTimer.unref?.();
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
    // Pool-aware user-input dispatch (Phase 14 audit follow-up). When
    // the pool is up, panel clicks / insert_text route to the caller's
    // own Brave instead of the shared singleton.
    browserPool,
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
    if (taskQueue) {
      try {
        taskQueue.stop();
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'TaskQueue stop errored (continuing)',
        );
      }
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
