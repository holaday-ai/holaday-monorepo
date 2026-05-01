/**
 * Phase 19 — `/screencast-ws/:userId` upgrade handler.
 *
 * Mirrors the structure of `browser-pool/vnc-proxy.ts` (same auth
 * pattern, same per-user routing, same noServer WSS shape) so the
 * two paths can run side-by-side. Mounted alongside the existing
 * VNC proxy in index.ts; the SPA picks which transport to use via
 * a localStorage feature flag — VNC stays the default until the
 * CDP path is verified live.
 *
 * Each accepted connection:
 *   1. Verifies the JWT (?token= query OR Sec-WebSocket-Protocol
 *      bearer.JWT header)
 *   2. Confirms the requested userId matches the JWT subject
 *   3. Looks up a ready BrowserInstance from the pool
 *   4. Spins up a CdpStreamer + CdpInputHandler against that
 *      instance's PlaywrightExecutor.getPage()
 *   5. Pipes incoming JSON input messages to the handler;
 *      cleans up on close.
 *
 * Failures: per-message JSON parse errors are swallowed (one bad
 * message can't kill the channel). CDP-side errors propagate to
 * the streamer's own logging path.
 */

import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Logger } from 'pino';
import { WebSocket, WebSocketServer } from 'ws';
import { verifyAccessToken } from '../auth/jwt.js';
import type { BrowserPool } from '../browser-pool/index.js';
import { CdpInputHandler, type InputMessage } from './cdp-input.js';
import { CdpStreamer } from './cdp-streamer.js';

export interface ScreencastProxyOptions {
  pool: BrowserPool;
  logger: Logger;
  /** Override route. Default: `/screencast-ws/:userId`. */
  pathPattern?: RegExp;
}

export interface ScreencastProxy {
  /**
   * Hook into `httpServer.on('upgrade', ...)`. Returns silently
   * when the request path doesn't match — leaves the upgrade for
   * the next handler in the chain (e.g. the existing VNC proxy).
   */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void;
}

export function createScreencastProxy(opts: ScreencastProxyOptions): ScreencastProxy {
  const pathPattern = opts.pathPattern ?? /^\/screencast-ws\/([^/?#]+)/;
  const wss = new WebSocketServer({ noServer: true });
  const log = opts.logger.child({ module: 'screencast-proxy' });

  function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = req.url ?? '';
    const m = pathPattern.exec(url);
    if (!m) return; // not our path; leave for next handler

    const requestedUserId = decodeURIComponent(m[1] ?? '');
    // Log every upgrade attempt at info so BOSS can correlate
    // user reports against pm2 logs. Included in the line:
    // requested user, whether token presence flag, source IP.
    log.info(
      {
        requestedUserId,
        hasToken:
          Boolean(extractBearerFromSubprotocol(req)) ||
          Boolean(extractTokenFromQuery(url)),
        ip: req.socket.remoteAddress,
      },
      'screencast: upgrade attempt',
    );
    const token = extractBearerFromSubprotocol(req) ?? extractTokenFromQuery(url);
    if (!token) {
      return reject(socket, 401, 'missing bearer token');
    }

    verifyAccessToken(token).then(
      (claims) => {
        if (!claims) {
          log.warn({}, 'jwt verify returned null');
          return reject(socket, 401, 'invalid token');
        }
        const callerUserId = claims.sub;

        if (requestedUserId && requestedUserId !== callerUserId) {
          log.warn(
            { callerUserId, requestedUserId },
            'subject mismatch — refusing cross-user screencast',
          );
          return reject(socket, 403, 'forbidden');
        }

        const instance = opts.pool.peek(callerUserId);
        if (!instance || instance.status !== 'ready') {
          log.info(
            { callerUserId, status: instance?.status ?? 'absent' },
            'no browser allocated yet — rejecting screencast',
          );
          return reject(socket, 409, 'browser not allocated');
        }

        wss.handleUpgrade(req, socket, head, (ws) => {
          void wireUpClient({ ws, callerUserId, instance });
        });
      },
      (err: unknown) => {
        log.warn({ err: (err as Error).message }, 'jwt verify threw');
        return reject(socket, 401, 'invalid token');
      },
    );
  }

  async function wireUpClient(args: {
    ws: WebSocket;
    callerUserId: string;
    instance: ReturnType<BrowserPool['peek']> & object;
  }): Promise<void> {
    const userLog = log.child({ userId: args.callerUserId });
    let streamer: CdpStreamer | null = null;
    let inputHandler: CdpInputHandler | null = null;
    let stopped = false;

    async function teardown(reason: string): Promise<void> {
      if (stopped) return;
      stopped = true;
      userLog.info({ reason }, 'screencast: tearing down');
      try {
        await streamer?.stop();
      } catch (err) {
        userLog.debug({ err: errMsg(err) }, 'screencast: streamer stop failed');
      }
      try {
        if (args.ws.readyState === WebSocket.OPEN || args.ws.readyState === WebSocket.CONNECTING) {
          args.ws.close();
        }
      } catch {
        /* ignore */
      }
    }

    args.ws.on('close', () => void teardown('ws-close'));
    args.ws.on('error', (err) => {
      userLog.warn({ err: errMsg(err) }, 'screencast: ws error');
      void teardown('ws-error');
    });

    try {
      userLog.info('screencast: ws upgraded ok, fetching page');
      // PlaywrightExecutor.getPage returns the user's pinned tab.
      // newCDPSession opens a session parallel to Playwright's
      // internal one — see cdp-streamer.ts head comment.
      const page = await args.instance!.executor.getPage();
      userLog.info('screencast: page acquired, starting streamer');
      streamer = new CdpStreamer({ page, ws: args.ws, logger: userLog });
      await streamer.start();
      const session = streamer.getSession();
      if (!session) {
        userLog.warn('screencast: streamer started but session is null');
        await teardown('no-session');
        return;
      }
      userLog.info('screencast: streamer running; input handler attached');
      inputHandler = new CdpInputHandler(session, userLog);

      args.ws.on('message', (raw) => {
        if (!inputHandler) return;
        let msg: { type?: string; payload?: InputMessage } | null = null;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return; // swallow malformed
        }
        if (msg && msg.type === 'input' && msg.payload) {
          void inputHandler.handle(msg.payload);
        }
      });

      // Keep the pool's idle GC happy — every active screencast
      // counts as user activity even when the agent is idle.
      const touchInterval = setInterval(() => {
        if (stopped) {
          clearInterval(touchInterval);
          return;
        }
        opts.pool.touch(args.callerUserId);
      }, 15_000);
      args.ws.once('close', () => clearInterval(touchInterval));
    } catch (err) {
      userLog.warn({ err: errMsg(err) }, 'screencast: setup failed');
      await teardown('setup-error');
    }
  }

  return { handleUpgrade };
}

function extractBearerFromSubprotocol(req: IncomingMessage): string | null {
  const raw = req.headers['sec-websocket-protocol'];
  if (!raw) return null;
  const entries = Array.isArray(raw) ? raw : raw.split(',');
  for (const entry of entries) {
    const trimmed = entry.trim();
    if (trimmed.startsWith('bearer.')) return trimmed.slice('bearer.'.length);
  }
  return null;
}

function extractTokenFromQuery(url: string): string | null {
  const idx = url.indexOf('?');
  if (idx < 0) return null;
  const params = new URLSearchParams(url.slice(idx + 1));
  return params.get('token');
}

function reject(socket: Duplex, status: number, reason: string): void {
  try {
    socket.write(`HTTP/1.1 ${status} ${reason}\r\n\r\n`);
  } catch {
    /* ignore */
  }
  socket.destroy();
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
