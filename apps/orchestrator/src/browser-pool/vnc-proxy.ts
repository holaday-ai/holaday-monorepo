/**
 * Per-user VNC WebSocket proxy.
 *
 * Front-end noVNC clients open `wss://holaday.ai/vnc-ws/<userId>`
 * with a bearer subprotocol carrying the caller's JWT. This module
 * handles the Upgrade: authenticates the token, confirms the caller
 * owns the requested userId, looks up that user's websockify port
 * in the BrowserPool, and pipes frames bidirectionally between the
 * browser's WS and the internal websockify on 127.0.0.1.
 *
 * Why proxy inside the orchestrator instead of exposing websockify
 * ports externally: websockify itself has no auth. Either we front
 * every per-user port with nginx+auth (fragile, needs reload on
 * allocate) or we terminate auth at the orchestrator and keep the
 * per-user ports loopback-only. Doing it here keeps the nginx
 * config a single static block.
 *
 * Frames are relayed untouched — noVNC negotiates the `binary`
 * subprotocol directly with websockify; we echo whatever we agreed
 * on the client side so the handshake stays symmetrical.
 */

import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Logger } from 'pino';
import { WebSocket, WebSocketServer } from 'ws';
import { verifyStreamOrAccessToken } from '../auth/jwt.js';
import type { BrowserPool } from './browser-pool.js';

export interface VncProxyOptions {
  pool: BrowserPool;
  logger: Logger;
  /**
   * Regex that matches the upgrade path and captures the target
   * userId as group 1. Default accepts `/vnc-ws/<id>` so ops can
   * rename the public path without touching the module.
   */
  pathPattern?: RegExp;
  /**
   * Optional canary gate — when set, only these user IDs are allowed
   * through the proxy even if MULTI_USER is on. When empty (default),
   * every authenticated caller is eligible.
   */
  allowedUserIds?: Set<string>;
}

export interface VncProxy {
  /**
   * Wire this to `httpServer.on('upgrade', proxy.handleUpgrade)`. The
   * proxy inspects the URL; if the path doesn't match `pathPattern`,
   * it leaves the socket alone so other upgrade handlers (e.g. the
   * primary tRPC-WS on `/ws`) can pick it up. Otherwise it either
   * serves the proxy or closes with an HTTP reject.
   */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void;
}

export function createVncProxy(opts: VncProxyOptions): VncProxy {
  const pathPattern = opts.pathPattern ?? /^\/vnc-ws\/([^/?#]+)/;
  const wss = new WebSocketServer({ noServer: true });
  const log = opts.logger.child({ module: 'vnc-proxy' });

  function handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): void {
    const url = req.url ?? '';
    const m = pathPattern.exec(url);
    if (!m) return; // not our path; leave for other upgrade handlers
    const urlArg = decodeURIComponent(m[1] ?? '');

    // Token can arrive two ways: (1) `?token=JWT` query param —
    // preferred for the browser, since RFB doesn't let us inject a
    // subprotocol; (2) `Sec-WebSocket-Protocol: bearer.JWT` for
    // server-to-server proxy use. Prefer subprotocol when both are
    // present so a tooling client that explicitly sets it wins over
    // a stale query.
    const token = extractBearerFromSubprotocol(req) ?? extractTokenFromQuery(url);
    if (!token) {
      return reject(socket, 401, 'missing bearer token');
    }

    // verifyStreamOrAccessToken accepts either a short-lived stream
    // token (preferred — fresh per connect, 60s TTL) or the legacy
    // long-lived workbench JWT (kept for SPA versions that haven't
    // shipped the stream-token swap yet). Kick off async; if
    // rejected or null we close the raw TCP socket, never calling
    // wss.handleUpgrade.
    verifyStreamOrAccessToken(token).then((claims) => {
      if (!claims) {
        log.warn({}, 'jwt verify returned null — invalid token');
        return reject(socket, 401, 'invalid token');
      }
      const callerUserId = claims.sub;

      if (opts.allowedUserIds && !opts.allowedUserIds.has(callerUserId)) {
        return reject(socket, 403, 'user not on canary allow-list');
      }

      // Mirror the screencast-proxy dispatch: tsk_… targets a
      // specific in-flight task and verifies the caller owns it,
      // anything else falls back to the user's most-recently-active
      // instance. The previous code path treated the URL arg as a
      // userId only, so VNC always landed on peekActiveForUser even
      // when the SPA explicitly knew which task it wanted to watch
      // — visible as "wrong browser" when the user had multiple
      // concurrent tasks.
      let instance: ReturnType<BrowserPool['peek']>;
      if (urlArg.startsWith('tsk_')) {
        instance = opts.pool.peek(urlArg);
        if (!instance) {
          log.info({ taskId: urlArg }, 'task not active — rejecting VNC');
          return reject(socket, 409, 'task not active');
        }
        if (instance.userId !== callerUserId) {
          log.warn(
            { callerUserId, taskId: urlArg, ownerUserId: instance.userId },
            'subject mismatch — refusing cross-user VNC by taskId',
          );
          return reject(socket, 403, 'forbidden');
        }
      } else {
        if (urlArg && urlArg !== callerUserId) {
          log.warn(
            { callerUserId, requestedUserId: urlArg },
            'subject mismatch — refusing cross-user VNC',
          );
          return reject(socket, 403, 'forbidden');
        }
        instance = opts.pool.peekActiveForUser(callerUserId);
      }
      if (!instance || instance.status !== 'ready') {
        log.info(
          { callerUserId, status: instance?.status ?? 'absent' },
          'no browser allocated yet — rejecting VNC until first task allocates',
        );
        return reject(socket, 409, 'browser not allocated');
      }

      // Accept the upgrade; Playwright doesn't care about this path.
      // We echo the "binary" subprotocol back so noVNC's client-side
      // selectSubProtocol resolves to the same thing websockify will
      // speak.
      wss.handleUpgrade(req, socket, head, (client) => {
        const upstreamUrl = `ws://127.0.0.1:${instance.wsPort}/`;
        const upstream = new WebSocket(upstreamUrl, ['binary']);
        pipe(client, upstream, instance.taskId, log, opts.pool);
        opts.pool.touch(instance.taskId);
      });
    }, (err: unknown) => {
      log.warn({ err: (err as Error).message }, 'jwt verify threw');
      return reject(socket, 401, 'invalid token');
    });
  }

  return { handleUpgrade };
}

/**
 * Extract a bearer token from the Sec-WebSocket-Protocol header. The
 * browser WebSocket API doesn't let callers send custom headers, so
 * we tunnel the JWT through the subprotocol list: the client opens
 * with `['binary', 'bearer.<jwt>']` and the server picks off the
 * bearer entry.
 */
function extractBearerFromSubprotocol(req: IncomingMessage): string | null {
  const raw = req.headers['sec-websocket-protocol'];
  if (!raw) return null;
  // The header value is a comma-separated list per RFC 6455 §4.1.
  const entries = Array.isArray(raw) ? raw : raw.split(',');
  for (const entry of entries) {
    const trimmed = entry.trim();
    if (trimmed.startsWith('bearer.')) return trimmed.slice('bearer.'.length);
  }
  return null;
}

/**
 * Pull `token` from the upgrade URL's query string. Used by the noVNC
 * browser client, which can't inject custom headers. URL shape:
 *   /vnc-ws/<userId>?token=<JWT>
 */
function extractTokenFromQuery(url: string): string | null {
  const q = url.indexOf('?');
  if (q < 0) return null;
  const search = url.slice(q + 1);
  const params = new URLSearchParams(search);
  const t = params.get('token');
  return t && t.length > 0 ? t : null;
}

/**
 * Low-level reject: send an HTTP error response on the raw TCP socket
 * and close it. Browsers surface this as a failed WebSocket
 * connection; the specific code/reason shows up in devtools so we
 * can diagnose auth failures without leaving orphan sockets.
 */
function reject(socket: Duplex, status: number, reason: string): void {
  socket.write(
    `HTTP/1.1 ${status} ${reason}\r\n` +
      'Connection: close\r\n' +
      `Content-Length: ${Buffer.byteLength(reason)}\r\n\r\n` +
      reason,
  );
  socket.destroy();
}

/**
 * Pipe frames between the caller and the internal websockify in both
 * directions. Close one side when the other closes. No frame
 * transformation — websockify speaks binary VNC and noVNC speaks
 * binary VNC, we're just the middleman.
 *
 * pool.touch() fires on every relayed frame (BOTH directions) at most
 * once per TOUCH_THROTTLE_MS to keep the GC away from an actively-
 * watched session. Throttled because RFB FramebufferUpdate frames
 * arrive at 30+ fps under heavy paint and we don't need to write
 * lastActiveAt that often. Without this, a user just *watching* a
 * task (no input) would lose their browser to the 5-minute idle GC
 * even though the pixels are flowing.
 */
const TOUCH_THROTTLE_MS = 1_000;

function pipe(
  client: WebSocket,
  upstream: WebSocket,
  taskId: string,
  log: Logger,
  pool: BrowserPool,
): void {
  // Don't relay frames until upstream has finished its handshake.
  // Buffer a small window in case the client races the
  // initial-RFB-VERSION bytes.
  const clientBacklog: Array<[data: Buffer, isBinary: boolean]> = [];
  let upstreamReady = false;
  let lastTouchAt = Date.now();
  function maybeTouch(): void {
    const now = Date.now();
    if (now - lastTouchAt < TOUCH_THROTTLE_MS) return;
    lastTouchAt = now;
    pool.touch(taskId);
  }

  upstream.on('open', () => {
    upstreamReady = true;
    for (const [data, isBinary] of clientBacklog) {
      upstream.send(data, { binary: isBinary });
    }
    clientBacklog.length = 0;
  });

  upstream.on('error', (err) => {
    log.warn({ taskId, err: err.message }, 'upstream ws error');
    client.close(1011, 'upstream error');
  });

  upstream.on('close', (code, reason) => {
    log.debug({ taskId, code, reasonLen: reason?.length ?? 0 }, 'upstream closed');
    if (client.readyState === client.OPEN) client.close(1011, 'upstream closed');
  });

  upstream.on('message', (data, isBinary) => {
    if (client.readyState !== client.OPEN) return;
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
    client.send(buf, { binary: isBinary });
    maybeTouch();
  });

  client.on('message', (data, isBinary) => {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
    if (!upstreamReady) {
      clientBacklog.push([buf, isBinary]);
      return;
    }
    upstream.send(buf, { binary: isBinary });
    maybeTouch();
  });

  client.on('error', (err) => {
    log.warn({ taskId, err: err.message }, 'client ws error');
    if (upstream.readyState === upstream.OPEN) upstream.close(1011, 'client error');
  });

  client.on('close', (code, reason) => {
    log.debug({ taskId, code, reasonLen: reason?.length ?? 0 }, 'client closed');
    if (upstream.readyState === upstream.OPEN) upstream.close(1000, 'client gone');
  });
}
