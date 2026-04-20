import type { Request, Response } from 'express';
import type { Planner } from '../agent/planner.js';
import type { VisionLoopCommander } from '../agent/vision-loop/commander.js';
import type { PlaywrightExecutor } from '../agent/vision-loop/playwright-executor.js';
import { logger } from '../config/logger.js';
import { db } from '../db/client.js';

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
      userId: (req as Request & { userId?: string }).userId,
    };
  };
}

export type Context = Awaited<ReturnType<ReturnType<typeof makeCreateContext>>>;
