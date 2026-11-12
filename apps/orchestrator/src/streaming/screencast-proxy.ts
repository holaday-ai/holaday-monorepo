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
import { browserControlSessions } from '../agent/supercar/browser-control-sessions.js';
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
import {
  BrowserActionConfirmations,
  BrowserFrameGuard,
  frameGraceFor,
} from './browser-viewport-v2.js';
import { CdpInputHandler } from './cdp-input.js';
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

/** FIX-61B P1-5: how long after typing the focus may let an Enter / Space through. */
const TYPING_FOCUS_MS = 1_500;
/** 复审 #1: the text box that really has the focus (through shadow roots); null in a frame or elsewhere. */
const FOCUSED_TEXT_BOX_EXPRESSION = `(() => {
  let e = document.activeElement;
  while (e && e.shadowRoot && e.shadowRoot.activeElement) e = e.shadowRoot.activeElement;
  if (!e || /^(?:IFRAME|FRAME|BODY|HTML)$/.test(e.tagName)) return null;
  const type = (e.getAttribute('type') || 'text').toLowerCase();
  const editable = e.isContentEditable || e.tagName === 'TEXTAREA' ||
    (e.tagName === 'INPUT' && /^(?:text|search|email|url|tel|number)$/.test(type));
  return editable ? e : null;
})()`;
/** 复审 #1: dialogs open on the page (a new one may confirm on Enter). */
const OPEN_DIALOGS_EXPRESSION =
  "document.querySelectorAll('dialog[open],[role=dialog],[role=alertdialog],[aria-modal=true]').length";

/** FIX-61B P0-3: a screen size not applied because the agent's page changed under it — not a failure. */
export class BrowserViewportSkippedError extends Error {
  constructor() {
    super('browser_viewport_skipped');
    this.name = 'BrowserViewportSkippedError';
  }
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
    let viewportPending = false;
    // The newest lease a viewport message from this screen carried (DEPLOY-61 第 0 步 #2).
    let viewportLease: string | null = null;
    const humanLease = (): string | null => {
      const control = browserControlSessions
        .get(args.instance, args.instance.userId, args.instance.taskId)
        ?.control.snapshot();
      return control?.phase === 'human' ? control.lease : null;
    };
    /**
     * DEPLOY-61 P0-1: only a size sent with the current lease changes the assistant's page (the
     * input handler's mayAlign). DEPLOY-61 重跑 第 0 步 #2: so only such a size makes the frames
     * shown so far stale; a watcher's size changes nothing and must not hold every input back
     * (on a finished task it was never applied at all, so input stayed refused until the size).
     */
    const viewportWillApply = (): boolean => {
      const lease = humanLease();
      return lease !== null && viewportLease === lease;
    };
    const frameGuard = new BrowserFrameGuard();
    // FIX-62 P0-1: the frame revision each accepted human input was checked against; the handler
    // re-checks it (and the document itself) right before the input is sent.
    const validated = new WeakMap<object, { revision: number; loader: string }>();
    /**
     * FIX-61B P1-5 (Deploy-61 online: the first Enter after typing 「holaday」 was dropped without a
     * word — the caret and Google's suggestion list kept superseding the frame within 250ms). The
     * element the person typed into, and when. An Enter / Space on a frame superseded within the
     * lenient grace goes through only when the focus is still exactly that element (a page that
     * moved focus to 「确认支付」 is refused, as before).
     */
    let typingFocus: { node: number; dialogs: number; at: number } | null = null;
    /**
     * The element keys go to, as a stable node id, and how many dialogs are open — or null when it
     * cannot be told for sure (复审 #1): focus inside a frame, or on anything but a text box.
     * Shadow roots are walked down to the element that really has the focus.
     */
    const focusedNode = async (): Promise<{ node: number; dialogs: number } | null> => {
      const session = streamer?.getSession();
      if (!session) return null;
      try {
        const evaluated = (await session.send('Runtime.evaluate', {
          expression: FOCUSED_TEXT_BOX_EXPRESSION,
          returnByValue: false,
        })) as { result?: { objectId?: string } };
        const objectId = evaluated.result?.objectId;
        if (!objectId) return null;
        const described = (await session.send('DOM.describeNode', { objectId })) as {
          node?: { backendNodeId?: number };
        };
        void session.send('Runtime.releaseObject', { objectId }).catch(() => {});
        const node = described.node?.backendNodeId;
        if (!node) return null;
        const counted = (await session.send('Runtime.evaluate', {
          expression: OPEN_DIALOGS_EXPRESSION,
          returnByValue: true,
        })) as { result?: { value?: unknown } };
        const dialogs = typeof counted.result?.value === 'number' ? counted.result.value : -1;
        return { node, dialogs };
      } catch {
        return null;
      }
    };
    /** Read where the keys go just before they are sent (read after, the page may have moved focus). */
    const noteTyping = async (): Promise<void> => {
      const focus = await focusedNode();
      typingFocus = focus === null ? null : { ...focus, at: Date.now() };
    };
    /** The focus is still the element typed into within the lenient grace. */
    const stillTypingTarget = async (): Promise<boolean> => {
      const typed = typingFocus;
      if (!typed || Date.now() - typed.at > TYPING_FOCUS_MS) return false;
      // 复审 #1: the same text box, and no dialog opened since (「按回车确认」 on a new modal).
      const now = await focusedNode();
      return !!now && now.node === typed.node && now.dialogs === typed.dialogs && now.dialogs >= 0;
    };
    const confirmations = new BrowserActionConfirmations();
    const invalidate = () => {
      typingFocus = null;
      frameGuard.invalidate();
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
    const inputBridge = createOwnedScreencastInputBridge({
      instance: args.instance,
      runWithStableViewport: (action) =>
        streamer && args.viewportV2 ? streamer.runWithStableViewport(action) : action(),
      viewportV2: args.viewportV2,
      maxViewportHeight: args.viewportV2 ? 2400 : 1600,
      onViewportRequested: (envelope) => {
        if (typeof envelope.controlLease === 'string') viewportLease = envelope.controlLease;
        if (!args.viewportV2 || !viewportWillApply()) return;
        viewportPending = true;
        invalidate();
        streamer?.invalidateObservation();
      },
      beforeDispatch: args.viewportV2
        ? async (envelope, signal) => {
            const message = envelope.payload;
            if (!message) throw new Error('browser_input_missing');
            // FIX-61B P0-3: a size that changes nothing (sent while only watching) never fails —
            // whichever page the agent is on now. Online, such a size queued for a running task
            // met a new tab, failed as browser_tab_changed and the task with it.
            if (message.type === 'viewport' && !viewportWillApply()) return;
            if (!streamer?.matchesPage(await args.instance.executor.getPage())) {
              invalidate();
              if (message.type === 'viewport') {
                // The lease holder's size, for a page the agent has left: drop it, follow the
                // agent's page, and the size is applied there afresh (onViewportMayReset).
                void streamer
                  ?.followCurrentPage()
                  .catch((err: unknown) =>
                    userLog.debug({ err: errMsg(err) }, 'screencast: follow page failed'),
                  );
                throw new BrowserViewportSkippedError();
              }
              // 复审 #1 建议: the lease holder's other input meets the same new page — follow it too
              // (a screen that did not re-send its size would otherwise stay on the old tab).
              if (viewportWillApply())
                void streamer
                  ?.followCurrentPage()
                  .catch((err: unknown) =>
                    userLog.debug({ err: errMsg(err) }, 'screencast: follow page failed'),
                  );
              throw new Error('browser_tab_changed');
            }
            if (message.type === 'viewport') {
              if (!viewportWillApply()) return;
              viewportPending = true;
              invalidate();
              streamer?.invalidateObservation();
              return;
            }
            // FIX-61 复审 #2 #2 / DEPLOY-61 #1: keys, text and the release of a press are lenient;
            // Enter and Space activate the focused element and keep 250ms (frameGraceFor).
            let inputKind = frameGraceFor(message);
            let relaxedForTyping = false;
            // FIX-61B P1-5: Enter / Space on a frame superseded only within the lenient grace go
            // through when the focus is still the element the person was typing into.
            if (
              inputKind === 'pointer' &&
              message.type === 'keyDown' &&
              !viewportPending &&
              !frameGuard.validate(envelope.observation, Date.now(), 'pointer') &&
              frameGuard.validate(envelope.observation, Date.now(), 'lenient') &&
              (await stillTypingTarget())
            ) {
              inputKind = 'lenient';
              relaxedForTyping = true;
            }
            if (
              ('x' in message && (!Number.isFinite(message.x) || !Number.isFinite(message.y))) ||
              viewportPending ||
              !frameGuard.validate(envelope.observation, Date.now(), inputKind)
            ) {
              streamer?.requestFrameRefresh();
              throw new Error('browser_observation_expired');
            }
            if (envelope.observation)
              validated.set(message, {
                revision: envelope.observation.viewportRevision,
                loader: streamer?.documentLoader() ?? '',
              });
            if (message.type === 'scroll' || message.type === 'mouseMove') return;
            // FIX-61B P1-5: where the person types (text, or a printable key), read before it is sent.
            if (
              message.type === 'insertText' ||
              (message.type === 'keyDown' &&
                typeof message.key === 'string' &&
                message.key.length === 1 &&
                message.key !== ' ')
            )
              await noteTyping();
            if (!opts.beforeViewportAction) throw new Error('browser_action_gate_unavailable');
            const result = await opts.beforeViewportAction(
              args.instance,
              envelope,
              signal,
              streamer.getSession(),
            );
            // Recheck after the asynchronous policy: resize/navigation may have happened.
            if (
              !streamer.matchesPage(await args.instance.executor.getPage()) ||
              !frameGuard.validate(envelope.observation, Date.now(), inputKind) ||
              (relaxedForTyping && !(await stillTypingTarget()))
            )
              throw new Error('browser_observation_expired');
            if (
              result.request.taskId !== args.instance.taskId ||
              result.request.actor !== 'human' ||
              result.request.lane !== 'cdp' ||
              result.request.tabId !== envelope.observation?.tabId ||
              result.request.observationRevision !== envelope.observation?.viewportRevision ||
              result.request.lease !== envelope.controlLease
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
      releasePressed: async (signal) => {
        await inputHandler?.releasePressed(signal);
        streamer?.notePointerInput('release');
      },
      onViewportApplied: (viewport) => {
        streamer?.setCaptureScale(viewport.deviceScaleFactor ?? 1);
        if (args.viewportV2) {
          viewportPending = false;
          streamer?.invalidateObservation();
          streamer?.requestFrameRefresh();
        }
        if (args.ws.readyState !== WebSocket.OPEN) return;
        try {
          args.ws.send(JSON.stringify({ type: 'viewport-applied', ...viewport }));
        } catch {
          /* socket closed between readyState and send */
        }
      },
    });

    async function teardown(reason: string): Promise<void> {
      if (stopped) return;
      stopped = true;
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
    // Attach before the streamer starts. Chromium/CDP setup can take several
    // hundred milliseconds; the SPA sends its viewport as soon as the socket
    // opens, and losing that first message leaves the stream pinned to the
    // spawn-time 430x760 profile. The bridge retains only the newest viewport
    // and deliberately drops stale pointer/keyboard input.
    args.ws.on('message', (raw) => {
      if (args.ws.readyState !== WebSocket.OPEN) return;
      if (args.viewportV2 && raw.toString() === '{"type":"observe"}') {
        streamer?.requestFrameRefresh();
        return;
      }
      void inputBridge.receive(raw.toString()).catch((err: unknown) => {
        userLog.debug({ err: errMsg(err) }, 'screencast: input dispatch failed');
        // DEPLOY-61 重跑 第 0 步 #2: the checks are unchanged; this screen is only told that its
        // input named a frame no longer current, so a replayed first press can say 「请再点一次」.
        if (
          args.viewportV2 &&
          errMsg(err) === 'browser_observation_expired' &&
          args.ws.readyState === WebSocket.OPEN
        ) {
          try {
            // FIX-61B P1-5: which kind of input, so a refused key is said too.
            let kind = 'pointer';
            try {
              const sent = JSON.parse(raw.toString()) as { payload?: { type?: string } };
              if (/^(?:keyDown|insertText)$/.test(sent.payload?.type ?? '')) kind = 'key';
            } catch {
              /* unreadable: pointer */
            }
            args.ws.send(JSON.stringify({ type: 'input-expired', input: kind }));
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
        onFrame: (frame) => {
          if (!viewportPending) frameGuard.observe(frame);
        },
        onObservationInvalidated: invalidate,
        onViewportMayReset: () => inputBridge.reapplyViewport(),
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
        args.viewportV2,
        () => executor.getPage(),
        args.viewportV2 ? 2400 : 1600,
        {
          // FIX-61 复审 #1 / DEPLOY-61 P0-1: only the lease holder's screen — the one whose
          // viewport message carried the current lease — may change the assistant's page. While
          // a phone holds control, another screen that only watches still changes nothing.
          mayAlign: viewportWillApply,
          lease: () => viewportLease,
          taskRef: args.instance.taskId.slice(0, 8),
          onAligned: (restore) =>
            browserControlSessions.noteAgentViewportChanged(args.instance, restore),
        },
      );
      // FIX-62 P0-1 (DEPLOY-61 第三次 单列 4): human input reaches only the document its frame
      // showed: the revision and loader it was validated against, checked again when it is sent.
      const streamRef = streamer;
      inputHandler.setDocumentGuard({
        expected: (message) => validated.get(message),
        revision: () => streamRef.currentRevision(),
        loader: () => streamRef.documentLoader(),
        freshLoader: () => streamRef.freshLoader(),
      });
      await inputBridge.attach(inputHandler);
      // DEPLOY-61 P0-1: the screen that takes control re-sends its size with the new lease (the
      // workbench does); only that message may change the assistant's page (mayAlign above).

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
