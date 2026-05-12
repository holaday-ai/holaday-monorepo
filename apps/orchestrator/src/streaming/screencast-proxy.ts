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
import { dimensionsForProfile } from '@holaday/shared-types';
import { verifyStreamOrAccessToken } from '../auth/jwt.js';
import type { BrowserPool } from '../browser-pool/index.js';
import type { BrowserInstance } from '../browser-pool/types.js';
import { CdpInputHandler, type InputMessage } from './cdp-input.js';
import { CdpStreamer } from './cdp-streamer.js';

/**
 * Phase 24 fix #2 — `/screencast-ws/{arg}` route dispatcher.
 *
 * Discriminates by ID prefix so the same path supports both modes:
 *   - `tsk_…` → look up the specific task's Brave via pool.peek(taskId)
 *     and verify the JWT subject owns it. Lets the SPA show the
 *     viewer for any task the user clicks, not just the most-recent.
 *   - everything else → treated as a userId (legacy compat); falls
 *     back to peekActiveForUser(callerUserId) which finds the user's
 *     most-recently-active task instance.
 *
 * Pure function — testable without an http.Server.
 */
export type RoutePickResult =
  | { kind: 'instance'; instance: BrowserInstance }
  | { kind: 'forbidden'; reason: string }
  | { kind: 'no-active'; reason: string };

const TASK_ID_PREFIX = 'tsk_';

export function pickInstanceForRoute(args: {
  urlArg: string;
  callerUserId: string;
  peek: (taskId: string) => BrowserInstance | null;
  peekActiveForUser: (userId: string) => BrowserInstance | null;
}): RoutePickResult {
  if (args.urlArg.startsWith(TASK_ID_PREFIX)) {
    const inst = args.peek(args.urlArg);
    if (!inst) return { kind: 'no-active', reason: 'task not active' };
    if (inst.userId !== args.callerUserId) {
      return { kind: 'forbidden', reason: 'caller does not own task' };
    }
    return { kind: 'instance', instance: inst };
  }
  // Legacy userId path. The pre-Phase-24 forbidden check rejected
  // a non-empty arg that didn't match the JWT subject; preserve that
  // so a stray /screencast-ws/usr_other can't peek at someone's
  // browser even when the caller has no active task of their own.
  if (args.urlArg && args.urlArg !== args.callerUserId) {
    return { kind: 'forbidden', reason: 'subject mismatch' };
  }
  const inst = args.peekActiveForUser(args.callerUserId);
  if (!inst) return { kind: 'no-active', reason: 'no active task for user' };
  return { kind: 'instance', instance: inst };
}

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

    const urlArg = decodeURIComponent(m[1] ?? '');
    // Log every upgrade attempt at info so BOSS can correlate
    // user reports against pm2 logs. Included in the line:
    // url arg (taskId or userId), token presence flag, source IP.
    log.info(
      {
        urlArg,
        argKind: urlArg.startsWith('tsk_') ? 'taskId' : 'userId',
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

    verifyStreamOrAccessToken(token).then(
      (claims) => {
        if (!claims) {
          log.warn({}, 'jwt verify returned null');
          return reject(socket, 401, 'invalid token');
        }
        const callerUserId = claims.sub;

        // Phase 24 fix #2 — dispatch by ID prefix. tsk_… targets a
        // specific in-flight task; everything else falls through to
        // the legacy peekActiveForUser path so existing SPA builds
        // and curl probes keep working.
        const picked = pickInstanceForRoute({
          urlArg,
          callerUserId,
          peek: (taskId) => opts.pool.peek(taskId),
          peekActiveForUser: (userId) => opts.pool.peekActiveForUser(userId),
        });
        if (picked.kind === 'forbidden') {
          log.warn(
            { callerUserId, urlArg, reason: picked.reason },
            'screencast: refusing upgrade — forbidden',
          );
          return reject(socket, 403, 'forbidden');
        }
        if (picked.kind === 'no-active') {
          log.info(
            { callerUserId, urlArg, reason: picked.reason },
            'screencast: no active task instance — closing',
          );
          return reject(socket, 409, 'no active task');
        }

        const instance = picked.instance;
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
      userLog.info('screencast: ws upgraded, starting streamer');
      // Pass a getter (not a fixed Page) so the streamer can
      // re-resolve to the executor's CURRENT active page after a
      // hard-restart. resetPageForTask closes our pinned page at
      // every task start, so a fixed reference would die after the
      // first task — see cdp-streamer.ts CdpStreamerOptions.getPage.
      const executor = args.instance!.executor;
      // Optimization #3 R1 — pin the streamer's frame caps to the
      // viewport profile the pool spawned this Brave with. The CDP
      // contract caps frames at maxWidth × maxHeight; passing
      // sidepanel (900×900) keeps a narrow panel from receiving
      // 1280-px-wide frames that the SPA then downscales (wasted
      // bandwidth + slightly fuzzier text). When the instance has
      // no profile attached (back-compat), the streamer falls
      // back to its built-in 1280×800 default.
      const profile = args.instance!.viewportProfile;
      const profileDims = profile ? dimensionsForProfile(profile) : null;
      streamer = new CdpStreamer({
        getPage: () => executor.getPage(),
        ws: args.ws,
        logger: userLog,
        ...(profileDims ? { maxWidth: profileDims.width, maxHeight: profileDims.height } : {}),
      });
      await streamer.start();
      if (!streamer.getSession()) {
        userLog.warn('screencast: streamer started but session is null');
        await teardown('no-session');
        return;
      }
      userLog.info('screencast: streamer running; input handler attached');
      // Pass a getter (not the session itself) so input keeps
      // working across the streamer's hard-restart (phase 19e
      // watchdog) — the streamer swaps in a fresh session, the
      // handler picks it up on the next dispatch.
      const streamerRef = streamer;
      inputHandler = new CdpInputHandler(() => streamerRef.getSession(), userLog);

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
      // counts as activity on its bound task even when the agent
      // loop is idle. Phase 24: touch by taskId (the instance's
      // own key in the pool) instead of userId.
      const touchInterval = setInterval(() => {
        if (stopped) {
          clearInterval(touchInterval);
          return;
        }
        opts.pool.touch(args.instance.taskId);
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
