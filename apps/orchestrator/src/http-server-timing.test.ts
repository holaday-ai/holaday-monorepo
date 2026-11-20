import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { describe, expect, it } from 'vitest';
import {
  formatServerTiming,
  recordServerTiming,
  serverTimingMiddleware,
  timedPhase,
} from './http-server-timing.js';

describe('Server-Timing', () => {
  it('adds the app duration and handler phases to the response headers', async () => {
    const app = express();
    app.use(serverTimingMiddleware);
    app.get('/x', async (_req, res) => {
      await timedPhase(res, 'db', () => new Promise((resolve) => setTimeout(resolve, 15)));
      recordServerTiming(res, 'avail', 2);
      recordServerTiming(res, 'avail', 3);
      recordServerTiming(res, 'Bad Name', 1);
      res.json({ ok: true });
    });
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/x`);
      const header = response.headers.get('server-timing') ?? '';
      const phases = Object.fromEntries(
        header.split(', ').map((entry) => {
          const [name, dur] = entry.split(';dur=');
          return [name, Number(dur)];
        }),
      );
      expect(Object.keys(phases)).toEqual(['db', 'avail', 'app']);
      expect(phases.db).toBeGreaterThanOrEqual(14);
      expect(phases.avail).toBe(5);
      expect(phases.app).toBeGreaterThanOrEqual(phases.db ?? 0);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('is a no-op for responses the middleware did not see', () => {
    expect(() => recordServerTiming(undefined, 'db', 1)).not.toThrow();
    expect(() => recordServerTiming({} as never, 'db', 1)).not.toThrow();
    expect(formatServerTiming([{ name: 'db', ms: 1.234 }], 9.87)).toBe('db;dur=1.2, app;dur=9.9');
  });
});
