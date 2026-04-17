import type { Request, Response } from 'express';
import { logger } from '../config/logger.js';
import { db } from '../db/client.js';

export async function createContext({ req, res }: { req: Request; res: Response }) {
  return {
    db,
    logger,
    req,
    res,
    userId: (req as Request & { userId?: string }).userId,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
