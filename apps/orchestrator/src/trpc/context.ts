import type { Request, Response } from 'express';
import type { Planner } from '../agent/planner.js';
import { logger } from '../config/logger.js';
import { db } from '../db/client.js';

/**
 * Context factory. `planner` is injected by the factory created at boot so
 * tests can substitute a StubPlanner without patching imports.
 */
export interface AppContextDeps {
  planner: Planner;
}

export function makeCreateContext(deps: AppContextDeps) {
  return async function createContext({ req, res }: { req: Request; res: Response }) {
    return {
      db,
      logger,
      req,
      res,
      planner: deps.planner,
      userId: (req as Request & { userId?: string }).userId,
    };
  };
}

export type Context = Awaited<ReturnType<ReturnType<typeof makeCreateContext>>>;
