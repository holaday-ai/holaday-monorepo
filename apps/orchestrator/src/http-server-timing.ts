import type { NextFunction, Request, Response } from 'express';

/**
 * `Server-Timing` for API responses: `app` is the server-side time from this
 * middleware (before auth and body parsing) to the response headers, and
 * handlers may add named phases (`db`, `avail`, …). Comparing `app` with the
 * end-to-end latency a client measures separates server work from network /
 * edge time. Durations only — no identifiers or values.
 */

const PHASES = Symbol('serverTimingPhases');
const PHASE_NAME = /^[a-z][a-z0-9_-]{0,31}$/;
const MAX_PHASES = 16;

interface TimedResponse extends Response {
  [PHASES]?: Array<{ name: string; ms: number }>;
}

/** Adds (or accumulates) a named phase duration to this response's Server-Timing. */
export function recordServerTiming(res: Response | undefined, name: string, ms: number): void {
  const phases = (res as TimedResponse | undefined)?.[PHASES];
  if (!phases || !PHASE_NAME.test(name) || !Number.isFinite(ms) || ms < 0) return;
  const existing = phases.find((phase) => phase.name === name);
  if (existing) existing.ms += ms;
  else if (phases.length < MAX_PHASES) phases.push({ name, ms });
}

/** Times `work` as a Server-Timing phase. */
export async function timedPhase<T>(
  res: Response | undefined,
  name: string,
  work: () => Promise<T>,
): Promise<T> {
  const started = performance.now();
  try {
    return await work();
  } finally {
    recordServerTiming(res, name, performance.now() - started);
  }
}

export function formatServerTiming(
  phases: ReadonlyArray<{ name: string; ms: number }>,
  totalMs: number,
): string {
  return [...phases, { name: 'app', ms: totalMs }]
    .map((phase) => `${phase.name};dur=${phase.ms.toFixed(1)}`)
    .join(', ');
}

export function serverTimingMiddleware(req: Request, res: Response, next: NextFunction): void {
  const started = performance.now();
  const timed = res as TimedResponse;
  timed[PHASES] = [];
  const writeHead = res.writeHead;
  res.writeHead = function patchedWriteHead(this: Response, ...args: unknown[]) {
    if (!res.headersSent && !res.getHeader('Server-Timing')) {
      res.setHeader(
        'Server-Timing',
        formatServerTiming(timed[PHASES] ?? [], performance.now() - started),
      );
    }
    return (writeHead as (...a: unknown[]) => Response).apply(this, args);
  } as Response['writeHead'];
  void req;
  next();
}
