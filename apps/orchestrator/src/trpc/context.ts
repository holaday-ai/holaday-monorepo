import type { Request, Response } from 'express';
import type { Planner } from '../agent/planner.js';
import type { VisionLoopCommander } from '../agent/vision-loop/commander.js';
import { logger } from '../config/logger.js';
import { db } from '../db/client.js';

/**
 * Context factory. `planner` and `visionCommander` are both injected by the
 * factory created at boot so tests can substitute stubs without patching
 * imports. `visionCommander` is optional — when unset, tasks.create always
 * falls through to the legacy planner path regardless of env flag.
 */
export interface AppContextDeps {
  planner: Planner;
  visionCommander?: VisionLoopCommander;
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
      userId: (req as Request & { userId?: string }).userId,
    };
  };
}

export type Context = Awaited<ReturnType<ReturnType<typeof makeCreateContext>>>;
