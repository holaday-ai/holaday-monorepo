import type { NextFunction, Request, Response } from 'express';
import { verifyAccessToken } from './jwt.js';

const BEARER_PREFIX = 'Bearer ';

export async function bearerAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const header = req.header('authorization');
  if (header?.startsWith(BEARER_PREFIX)) {
    const token = header.slice(BEARER_PREFIX.length).trim();
    const claims = await verifyAccessToken(token);
    if (claims) {
      (req as Request & { userId?: string }).userId = claims.sub;
    }
  }
  next();
}
