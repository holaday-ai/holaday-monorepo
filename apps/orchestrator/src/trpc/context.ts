import type { Request, Response } from 'express';
import type { Planner } from '../agent/planner.js';
import type { ExecutionRouter } from '../agent/supercar/index.js';
import type { VisionLoopCommander } from '../agent/vision-loop/commander.js';
import type { PlaywrightExecutor } from '../agent/vision-loop/playwright-executor.js';
import type { BrowserPool } from '../browser-pool/index.js';
import { logger } from '../config/logger.js';
import { db } from '../db/client.js';
import type { DownloadManager } from '../files/download-manager.js';
import type { PayPalAdapter } from '../payment/index.js';
import type { TaskQueue } from '../queue/task-queue.js';
import type { FirecrawlLane } from '../firecrawl/firecrawl-lane.js';

/**
 * Context factory. `planner` and `visionCommander` are both injected by the
 * factory created at boot so tests can substitute stubs without patching
 * imports. `visionCommander` is optional — when unset, tasks.create always
 * falls through to the legacy planner path regardless of env flag.
 *
 * `playwrightExecutor` (Phase D Step 3) is populated at boot when
 * EXECUTOR_MODE is 'playwright' or 'auto' AND the CDP connect
 * succeeded. When present, task-runner uses it directly and bypasses
 * the WS → SW → CDP hop; when absent, falls back to the legacy WS
 * round-trip.
 */
export interface AppContextDeps {
  planner: Planner;
  visionCommander?: VisionLoopCommander;
  playwrightExecutor?: PlaywrightExecutor | null;
  /**
   * 5-lane router (Phase 6-2). When present, supercar uses it to pick
   * between headless / headed browsers + Brave / Zapier / Apify
   * adapters per task. Undefined pre-Phase-6-2 deploys — tasks.ts
   * falls back to the single `playwrightExecutor` path in that case.
   */
  executionRouter?: ExecutionRouter;
  /**
   * Phase 8 per-user pool. Non-null when MULTI_USER=true at boot. When
   * both the pool AND the caller's userId is in the canary allow-list
   * (MULTI_USER_USERS) tasks.ts routes traffic through a dedicated
   * per-user browser instead of the shared headed-singleton lane.
   */
  browserPool?: BrowserPool | null;
  /**
   * Phase 24 RC follow-up — global pool-capacity-aware task queue.
   * Wired only when browserPool is also wired. tasks.create's supercar
   * branch enqueues every browser-mode task here; the queue throttles
   * dispatch so a 30-task burst doesn't overrun the 10-slot pool.
   */
  taskQueue?: TaskQueue | null;
  /**
   * Phase 24 RC follow-up — Firecrawl adapter. Non-null when
   * FIRECRAWL_API_KEY is set at boot. The 'scrape' execution mode
   * uses this to fetch live page content / search results without
   * spinning up a Brave; supercar's `scrape_website` tool also
   * delegates to it when the user falls back to the agent loop.
   * Null = scrape-mode tasks fail with a configured-key reason.
   */
  firecrawl?: FirecrawlLane | null;
  /**
   * Phase 9 PayPal adapter. Non-null when PAYPAL_CLIENT_ID/_SECRET are
   * set. The payment router throws PRECONDITION_FAILED when this is
   * null so the SPA can show a "PayPal not configured" message.
   */
  paypalAdapter?: PayPalAdapter | null;
  /**
   * Phase 3 R3 — DownloadManager. Wraps FileService.storeOutput with
   * the 50MB cap + URL construction. Optional so integration tests
   * that build a partial deps shape compile; tasks.ts checks for
   * null at the L1 screenshot save site.
   */
  downloadManager?: DownloadManager | null;
}

export function makeCreateContext(deps: AppContextDeps) {
  return async function createContext({ req, res }: { req: Request; res: Response }) {
    return {
      db,
      logger,
      req,
      res,
      planner: deps.planner,
      visionCommander: deps.visionCommander,
      playwrightExecutor: deps.playwrightExecutor ?? null,
      executionRouter: deps.executionRouter ?? null,
      browserPool: deps.browserPool ?? null,
      taskQueue: deps.taskQueue ?? null,
      firecrawl: deps.firecrawl ?? null,
      paypalAdapter: deps.paypalAdapter ?? null,
      downloadManager: deps.downloadManager ?? null,
      userId: (req as Request & { userId?: string }).userId,
    };
  };
}

export type Context = Awaited<ReturnType<ReturnType<typeof makeCreateContext>>>;
