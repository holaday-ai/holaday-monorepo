import type { CDPSession } from 'playwright';
import { instanceBrowserCapabilities } from '../config/browser-capabilities.js';
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
import type { BrowserActionDecision, BrowserActionRequest } from '@holaday/shared-types';
import type { Logger } from 'pino';
import { WebSocket, WebSocketServer } from 'ws';
import { captchaWidgetStateCdp } from '../agent/captcha-widget.js';
import { browserControlSessions } from '../agent/supercar/browser-control-sessions.js';
import { captchaHandoffs } from '../agent/supercar/captcha-handoff.js';
import {
  type AuthenticatedSession,
  authenticateStreamOrAccessSession,
  revalidateAuthenticatedSession,
} from '../auth/middleware.js';
import { startWebSocketSessionRevalidation } from '../auth/websocket-session-revalidation.js';
import type { BrowserPool } from '../browser-pool/index.js';
import type { BrowserInstance } from '../browser-pool/types.js';
import { db } from '../db/client.js';
import type { ExecutionAdmission } from '../execution/execution-admission.js';
import { BrowserActionConfirmations } from './browser-viewport-v2.js';
import { CdpInputHandler, PAGE_CHANGED_ERROR } from './cdp-input.js';
import { CdpStreamer } from './cdp-streamer.js';
import { createOwnedScreencastInputBridge } from './owned-screencast-input.js';
import type { InputEnvelope } from './screencast-input-bridge.js';

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
/** CAPTCHA-UX-1 第 2 条: how often the captcha box is looked up while a verification is waited for. */
const CAPTCHA_BOX_POLL_MS = 700;

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
  /** Server-only adapter: must derive the exact target/digest from the live page,
   * then invoke #248's onBeforeAction. No adapter means V2 writes are read-only. */
  beforeViewportAction?: (
    instance: BrowserInstance,
    envelope: InputEnvelope,
    signal?: AbortSignal,
    session?: CDPSession | null,
  ) => Promise<{ request: BrowserActionRequest; decision: BrowserActionDecision }>;
  logger: Logger;
  executionDrain?: ExecutionAdmission;
  /** Override route. Default: `/screencast-ws/:userId`. */
  pathPattern?: RegExp;
  authenticateToken?: (token: string) => Promise<string | null>;
  /** Test override for the established-account revalidation check. */
  revalidateSession?: (session: AuthenticatedSession) => Promise<boolean>;
  /** Defaults to the task-WebSocket heartbeat period. */
  sessionRevalidationIntervalMs?: number;
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
  const customAuthenticateToken = opts.authenticateToken;
  const admissionOpen = () => {
    opts.executionDrain?.tick();
    return !opts.executionDrain || opts.executionDrain.drain.snapshot().mode === 'open';
  };

  function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = req.url ?? '';
    const m = pathPattern.exec(url);
    if (!m) return; // not our path; leave for next handler
    const v2Requested = new URL(url, 'http://localhost').searchParams.get('viewportV2') === '1';

    if (!admissionOpen()) {
      reject(socket, 503, 'maintenance');
      return;
    }

    const urlArg = decodeURIComponent(m[1] ?? '');
    // Log every upgrade attempt at info so BOSS can correlate
    // user reports against pm2 logs. Included in the line:
    // url arg (taskId or userId), token presence flag, source IP.
    log.info(
      {
        urlArg,
        argKind: urlArg.startsWith('tsk_') ? 'taskId' : 'userId',
        hasToken: Boolean(extractBearerFromSubprotocol(req)) || Boolean(extractTokenFromQuery(url)),
        ip: req.socket.remoteAddress,
      },
      'screencast: upgrade attempt',
    );
    const token = extractBearerFromSubprotocol(req) ?? extractTokenFromQuery(url);
    if (!token) {
      reject(socket, 401, 'missing bearer token');
      return;
    }

    const authenticateConnection = customAuthenticateToken
      ? async (candidate: string): Promise<AuthenticatedSession | null> => {
          const userId = await customAuthenticateToken(candidate);
          return userId ? { userId, authVersion: 0 } : null;
        }
      : (candidate: string) => authenticateStreamOrAccessSession(db, candidate);

    const connect = () =>
      authenticateConnection(token).then(
        async (session) => {
          if (!admissionOpen()) return reject(socket, 503, 'maintenance');
          if (!session) {
            log.warn({}, 'jwt verify returned null');
            return reject(socket, 401, 'invalid token');
          }
          const callerUserId = session.userId;

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
          const capabilities = instanceBrowserCapabilities(instance);
          if (v2Requested && !capabilities.viewportV2) {
            reject(socket, 409, 'browser viewport v2 disabled');
            return;
          }
          await new Promise<void>((resolve, rejectSetup) =>
            wss.handleUpgrade(req, socket, head, (ws) => {
              startWebSocketSessionRevalidation({
                socket: ws,
                expectedUserId: callerUserId,
                revalidateSession: () => {
                  if (opts.revalidateSession) return opts.revalidateSession(session);
                  if (customAuthenticateToken) {
                    return customAuthenticateToken(token).then(
                      (userId) => userId === session.userId,
                    );
                  }
                  return revalidateAuthenticatedSession(db, session);
                },
                logger: log,
                intervalMs: opts.sessionRevalidationIntervalMs,
              });
              // The server flag enforces V2 guards even for a legacy URL; dropping
              // the negotiation parameter must never restore unguarded writes.
              void wireUpClient({
                ws,
                callerUserId,
                instance,
                viewportV2: capabilities.viewportV2,
              }).then(resolve, rejectSetup);
            }),
          );
        },
        (err: unknown) => {
          log.warn({ err: (err as Error).message }, 'jwt verify threw');
          return reject(socket, 401, 'invalid token');
        },
      );
    try {
      const work = opts.executionDrain ? opts.executionDrain.runRoot(connect).result : connect();
      void work.catch(() => {
        if (!socket.destroyed) reject(socket, 503, 'maintenance');
      });
    } catch {
      reject(socket, 503, 'maintenance');
    }
  }

  async function wireUpClient(args: {
    ws: WebSocket;
    callerUserId: string;
    viewportV2: boolean;
    instance: ReturnType<BrowserPool['peek']> & object;
  }): Promise<void> {
    const userLog = log.child({ userId: args.callerUserId });
    let streamer: CdpStreamer | null = null;
    let inputHandler: CdpInputHandler | null = null;
    let stopped = false;
    const confirmations = new BrowserActionConfirmations();
    /**
     * CAPTCHA-UX-1 第 2 条: while the task waits for the person to pass a verification, tell this
     * screen where the captcha box is (null when there is none) so it can zoom in on it. Sent only
     * on change; the screen only scales its own picture — the page's size never changes.
     */
    let captchaBoxTimer: NodeJS.Timeout | null = null;
    let lastCaptchaBox = 'null';
    let captchaBoxReading = false;
    const watchCaptchaBox = (): void => {
      // 复审 P2: a stream torn down while it was starting never gets a timer.
      if (stopped) return;
      captchaBoxTimer = setInterval(() => {
        // 复审 P2: one reading at a time (a busy page or a JS dialog must not pile them up).
        if (captchaBoxReading) return;
        captchaBoxReading = true;
        void (async () => {
          if (stopped || args.ws.readyState !== WebSocket.OPEN) return;
          const binding = browserControlSessions.get(
            args.instance,
            args.instance.userId,
            args.instance.taskId,
          );
          const waiting =
            !!binding &&
            captchaHandoffs.active(args.instance.taskId, args.instance.userId, binding.control);
          const session = streamer?.getSession();
          const state = waiting && session ? await captchaWidgetStateCdp(session) : null;
          // 复审 #2 P2: a reading that failed (a busy page) keeps what the screen shows.
          if (waiting && !state) return;
          // Only a box still to be done is zoomed onto; passed or gone → the whole page again.
          const box = state?.unpassed ? state.box : null;
          const key = JSON.stringify(box);
          if (key === lastCaptchaBox || stopped || args.ws.readyState !== WebSocket.OPEN) return;
          lastCaptchaBox = key;
          args.ws.send(JSON.stringify({ type: 'captcha-box', rect: box }));
        })()
          .catch(() => {})
          .finally(() => {
            captchaBoxReading = false;
          });
      }, CAPTCHA_BOX_POLL_MS);
      captchaBoxTimer.unref?.();
    };
    const invalidate = () => {
      confirmations.invalidate();
      if (args.viewportV2 && args.ws.readyState === WebSocket.OPEN)
        args.ws.send(JSON.stringify({ type: 'observation-invalidated' }));
    };
    if (args.viewportV2)
      args.ws.send(
        JSON.stringify({
          type: 'viewport-v2-ready',
          controlReady: Boolean(opts.beforeViewportAction),
        }),
      );
    /** 复审 P2-1: when each input reached the server (the Enter / Space navigation guard). */
    const receivedAt = new WeakMap<object, number>();
    const inputBridge = createOwnedScreencastInputBridge({
      instance: args.instance,
      onInputReceived: (envelope) => {
        if (envelope.payload) receivedAt.set(envelope.payload, performance.now());
        return undefined;
      },
      runWithStableViewport: (action) =>
        streamer && args.viewportV2 ? streamer.runWithStableViewport(action) : action(),
      beforeDispatch: args.viewportV2
        ? async (envelope, signal) => {
            const message = envelope.payload;
            if (!message) throw new Error('browser_input_missing');
            // HOTFIX-R4A（协调方改，减法）: like a remote desktop, the person's input goes where they
            // see it — no frame freshness, revision or layout check, no 「再点一次」. The one refusal
            // left (Enter / Space within 300 ms of a cross-document navigation) is in CdpInputHandler.
            if (!streamer) throw new Error('browser_input_session_unavailable');
            // A v2 client names the picture it acted on (the audit and policy bind to it); an old
            // client that sends none is refused, as before. Its age is no longer checked.
            if (!envelope.observation) throw new Error('browser_observation_missing');
            if (!streamer.matchesPage(await args.instance.executor.getPage()))
              // The assistant moved to another tab: the screen follows it. This input goes to
              // whichever page the stream is bound to when it is sent (or is dropped while the
              // stream rebinds); the person sees the new page and acts on it.
              void streamer
                .followCurrentPage()
                .catch((err: unknown) =>
                  userLog.debug({ err: errMsg(err) }, 'screencast: follow page failed'),
                );
            if ('x' in message && (!Number.isFinite(message.x) || !Number.isFinite(message.y)))
              throw new Error('browser_input_invalid');
            if (message.type === 'scroll' || message.type === 'mouseMove') return;
            if (!opts.beforeViewportAction) throw new Error('browser_action_gate_unavailable');
            const result = await opts.beforeViewportAction(
              args.instance,
              envelope,
              signal,
              streamer.getSession(),
            );
            if (
              result.request.taskId !== args.instance.taskId ||
              result.request.actor !== 'human' ||
              result.request.lane !== 'cdp' ||
              result.request.tabId !== envelope.observation?.tabId ||
              result.request.observationRevision !== envelope.observation?.viewportRevision
            )
              throw new Error('browser_action_binding_invalid');
            if (result.decision.kind !== 'allow')
              throw new Error('browser_action_confirmation_required');
            if (
              result.decision.sensitive &&
              !confirmations.consume(envelope.confirmationNonce, result.request)
            )
              throw new Error('browser_confirmation_invalid');
          }
        : undefined,
      executionDrain: opts.executionDrain,
      peek: (taskId) => opts.pool.peek(taskId),
    });

    async function teardown(reason: string): Promise<void> {
      if (stopped) return;
      stopped = true;
      if (captchaBoxTimer) clearInterval(captchaBoxTimer);
      invalidate();
      inputBridge.detach();
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
      inputBridge.detach();
    }

    args.ws.on('close', () => void teardown('ws-close'));
    args.ws.on('error', (err) => {
      userLog.warn({ err: errMsg(err) }, 'screencast: ws error');
      void teardown('ws-error');
    });
    // Pointer / keyboard input that arrives before the streamer is running is dropped (never
    // replayed later). REBUILD-4: a viewer's size is never applied to the page.
    args.ws.on('message', (raw) => {
      if (args.ws.readyState !== WebSocket.OPEN) return;
      if (args.viewportV2 && raw.toString() === '{"type":"observe"}') {
        streamer?.requestFrameRefresh();
        return;
      }
      // 复审 #1 #1: the person pressed while this screen waits for a fresh frame — the assistant
      // yields now, before the input itself can be sent. Only on the task owner's own stream.
      if (args.viewportV2 && raw.toString() === '{"type":"busy"}') {
        if (opts.pool.peek(args.instance.taskId) === args.instance)
          browserControlSessions.noteViewerBusy(args.instance);
        streamer?.requestFrameRefresh();
        return;
      }
      void inputBridge.receive(raw.toString()).catch((err: unknown) => {
        userLog.debug({ err: errMsg(err) }, 'screencast: input dispatch failed');
        // HOTFIX-R4A（协调方改）: the only refusal left — an Enter / Space within 300 ms of a
        // cross-document navigation (CdpInputHandler) — is said once: 「页面刚跳转了，请再按一次」.
        if (
          args.viewportV2 &&
          errMsg(err) === PAGE_CHANGED_ERROR &&
          args.ws.readyState === WebSocket.OPEN
        ) {
          try {
            args.ws.send(JSON.stringify({ type: 'input-expired', input: 'key' }));
          } catch {
            /* socket closed between readyState and send */
          }
        }
        // 复审 #1 (建议修 #3): a stop still winding down (control closed, runner not finished) or a
        // run starting refuses the input — say so instead of nothing happening.
        if (
          args.viewportV2 &&
          /^(?:browser_control_closed|browser_control_unavailable|browser_runner_active)$/.test(
            errMsg(err),
          ) &&
          args.ws.readyState === WebSocket.OPEN
        ) {
          try {
            args.ws.send(JSON.stringify({ type: 'input-closed' }));
          } catch {
            /* socket closed between readyState and send */
          }
        }
      });
    });

    try {
      userLog.info('screencast: ws upgraded, starting streamer');
      // Pass a getter (not a fixed Page) so the streamer can
      // re-resolve to the executor's CURRENT active page after a
      // hard-restart. resetPageForTask closes our pinned page at
      // every task start, so a fixed reference would die after the
      // first task — see cdp-streamer.ts CdpStreamerOptions.getPage.
      const executor = args.instance!.executor;
      // Keep the cap large enough for the live workbench. Chromium still sends
      // frames at the current remote viewport size, so a narrow panel remains
      // cheap; when the user expands the browser, the stream can grow instead
      // of upscaling a permanently 430px-wide JPEG.
      const profile = args.instance!.viewportProfile;
      userLog.info(
        {
          viewportProfile: profile ?? 'desktop',
          frameCapWidth: 1440,
          frameCapHeight: 1200,
        },
        'screencast: resolved viewport profile',
      );
      streamer = new CdpStreamer({
        getPage: () => executor.getPage(),
        ws: args.ws,
        logger: userLog,
        viewportV2: args.viewportV2,
        onObservationInvalidated: invalidate,
      });
      await streamer.start();
      if (!streamer.getSession()) {
        userLog.warn('screencast: streamer started but session is null');
        await teardown('no-session');
        return;
      }
      userLog.info('screencast: streamer running; input handler attached');
      if (args.viewportV2) watchCaptchaBox();
      // Pass a getter (not the session itself) so input keeps
      // working across the streamer's hard-restart (phase 19e
      // watchdog) — the streamer swaps in a fresh session, the
      // handler picks it up on the next dispatch.
      const streamerRef = streamer;
      inputHandler = new CdpInputHandler(
        () => streamerRef.getSession(),
        userLog,
        (message) => {
          streamerRef.notePointerInput(message.type);
          streamerRef.requestFrameRefresh();
        },
        () => {
          void browserControlSessions
            .quarantine(args.instance, () =>
              opts.pool.release(args.instance.taskId, 'browser-input-unknown'),
            )
            .catch((err: unknown) =>
              userLog.warn({ err: errMsg(err) }, 'screencast: browser stop unconfirmed'),
            );
          void teardown('input-outcome-unknown');
        },
      );
      // HOTFIX-R4A（协调方改）: the one guard left — when the last cross-document navigation was.
      const streamRef = streamer;
      inputHandler.setNavigationGuard({
        lastNavigationAt: () => streamRef.lastNavigationAt(),
        receivedAt: (message) => receivedAt.get(message),
        pending: () => streamRef.historyPending(),
        settled: (ms) => streamRef.historySettled(ms),
      });
      await inputBridge.attach(inputHandler);

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
