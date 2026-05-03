import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import {
  type ClientMessage,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  type ServerMessage,
  WS_SUBPROTOCOL,
  parseClientMessage,
} from '@holaday/shared-types';
import { jwtVerify } from 'jose';
import { WebSocket, WebSocketServer } from 'ws';
import type { Planner } from '../agent/planner.js';
import { TaskController, type TaskState } from '../agent/task-controller.js';
import type { PlaywrightExecutor } from '../agent/vision-loop/playwright-executor.js';
import type { BrowserPool } from '../browser-pool/browser-pool.js';
import { type RehydratedTask, TaskRepository } from '../agent/task-repository.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { db } from '../db/client.js';

interface ClientState {
  id: string;
  userId: string | null;
  socket: WebSocket;
  lastPongAt: number;
  authed: boolean;
  // taskId -> state. Phase 0 in-memory; persistence writes through on every
  // transition. Restart recovery rehydrates this map per-user at auth time.
  tasks: Map<string, TaskState>;
  /**
   * Step ids whose FAILURE just triggered a self-heal. When the next
   * `client.step.result` with status='ok' arrives for one of these,
   * the WS server flips `task_steps.heal_succeeded = 1` and removes
   * the id. Tracking here (not on TaskState) so the Set doesn't
   * travel through the pure-function controller — the heal success
   * signal is plumbing, not state-machine state.
   */
  healedStepIds: Set<string>;
}

const taskController = new TaskController();
const taskRepository = new TaskRepository(db);

const jwtKey = new TextEncoder().encode(env.JWT_SECRET);

const lastPingAt = new WeakMap<WebSocket, number>();

/**
 * Per-user rehydrated TaskStates loaded at boot from MySQL. When a WS client
 * authenticates we drain the entry for their user once and seed the client's
 * in-memory task map (plus re-emit server.user.confirm for awaiting_user
 * tasks).
 */
const rehydratedByUser = new Map<string, RehydratedTask[]>();

export async function loadRehydratedTasks(): Promise<{ userCount: number; taskCount: number }> {
  rehydratedByUser.clear();
  const rehydrated = await taskRepository.rehydrateInFlight();
  for (const r of rehydrated) {
    const bucket = rehydratedByUser.get(r.userExternalId) ?? [];
    bucket.push(r);
    rehydratedByUser.set(r.userExternalId, bucket);
  }
  return { userCount: rehydratedByUser.size, taskCount: rehydrated.length };
}

/**
 * Planner injected at boot so the WS server can call self-heal when a
 * step fails with SELECTOR_NOT_FOUND. Null disables self-heal entirely
 * (integration tests, environments without ANTHROPIC_API_KEY that fall
 * back to StubPlanner — StubPlanner's heal is a no-op anyway). Module-
 * level because multiple handler paths need it without threading it
 * through every function signature.
 */
let injectedPlanner: Planner | null = null;
let injectedExecutor: PlaywrightExecutor | null = null;
let injectedBrowserPool: BrowserPool | null = null;

export interface WsServerOpts {
  planner?: Planner | null;
  /**
   * When wired, the WS handler can dispatch `client.vision.user_input`
   * events straight to PlaywrightExecutor — that's how the web
   * workbench's right-side panel lets users click/type/scroll inside
   * the remote browser. Unset in the legacy WS/SW path; the user-input
   * handler no-ops in that case.
   */
  playwrightExecutor?: PlaywrightExecutor | null;
  /**
   * Phase 14 audit follow-up — pool-aware user-input dispatch.
   * Without this, `dispatchUserInput` falls back to the global
   * `injectedExecutor` (the SHARED singleton) which lands clicks on
   * the WRONG browser for users on a per-user pool slot. When the
   * pool is wired, dispatch first looks up the caller's per-user
   * executor via `pool.peek(userId).executor` and only falls back to
   * the singleton if the caller has no pool instance.
   */
  browserPool?: BrowserPool | null;
}

export function createWsServer(port: number, opts: WsServerOpts = {}) {
  injectedPlanner = opts.planner ?? null;
  injectedExecutor = opts.playwrightExecutor ?? null;
  injectedBrowserPool = opts.browserPool ?? null;

  const wss = new WebSocketServer({ port, handleProtocols });

  wss.on('connection', (socket, req) => {
    void handleConnection(socket, req);
  });

  const heartbeat = setInterval(() => sweep(wss), HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();

  return {
    wss,
    close: () => {
      clearInterval(heartbeat);
      return new Promise<void>((resolve) => wss.close(() => resolve()));
    },
  };
}

/**
 * Drain per-user rehydrated tasks into the client's in-memory map and
 * re-emit the right continuation frame so the extension can resume:
 *
 *   awaiting_user → re-emit server.user.confirm (persisted pending payload)
 *   paused        → re-emit server.task.control pause (with reason)
 *   executing     → re-emit server.task.dispatch for the cursor step,
 *                    so the extension resumes the in-flight action
 *                    (W1 rehearsal b1: completeness of crash recovery)
 *
 * `planning` and `pending` are transient server-side states that shouldn't
 * normally persist past a restart; if they do, we log and move on — a
 * re-plan would need to call the commander again which is out of scope.
 */
function applyRehydrationForUser(state: ClientState): void {
  if (!state.userId) return;
  const bucket = rehydratedByUser.get(state.userId);
  if (!bucket || bucket.length === 0) return;

  let reemittedDispatch = 0;
  let reemittedConfirm = 0;
  let reemittedPause = 0;

  for (const entry of bucket) {
    state.tasks.set(entry.state.taskId, entry.state);

    if (entry.state.status === 'awaiting_user' && entry.pendingConfirm) {
      const pc = entry.pendingConfirm;
      if (pc.kind === 'batch') {
        send(state.socket, {
          type: 'server.batch_confirm_required',
          taskId: entry.state.taskId,
          stepId: pc.stepId,
          batchIndex: pc.batchIndex,
          batchTotal: pc.batchTotal,
          items: pc.items,
          risk: pc.risk,
          ...(pc.summary ? { summary: pc.summary } : {}),
        });
      } else {
        send(state.socket, {
          type: 'server.user.confirm',
          taskId: entry.state.taskId,
          stepId: pc.stepId,
          prompt: pc.prompt,
          risk: pc.risk,
        });
      }
      reemittedConfirm += 1;
      continue;
    }

    if (entry.state.status === 'paused' && entry.pauseReason) {
      send(state.socket, {
        type: 'server.task.control',
        taskId: entry.state.taskId,
        command: 'pause',
        reason: entry.pauseReason,
      });
      reemittedPause += 1;
      continue;
    }

    if (entry.state.status === 'executing') {
      const step = entry.state.plan[entry.state.cursor];
      if (!step) {
        logger.warn(
          { userId: state.userId, taskId: entry.state.taskId, cursor: entry.state.cursor },
          'executing task rehydrated with cursor past plan end; skipping re-dispatch',
        );
        continue;
      }
      send(state.socket, {
        type: 'server.task.dispatch',
        taskId: entry.state.taskId,
        stepId: step.id,
        action: {
          kind: step.kind,
          ...(step.selector ? { selector: step.selector } : {}),
          ...(step.payload ? { payload: step.payload } : {}),
        },
      });
      reemittedDispatch += 1;
      continue;
    }

    logger.info(
      { userId: state.userId, taskId: entry.state.taskId, status: entry.state.status },
      'rehydrated task in transient state; not re-emitting (needs re-plan in W2+)',
    );
  }

  logger.info(
    {
      userId: state.userId,
      rehydratedCount: bucket.length,
      reemitted: {
        dispatch: reemittedDispatch,
        confirm: reemittedConfirm,
        pause: reemittedPause,
      },
    },
    'rehydrated tasks delivered to client',
  );
  // Drain so reconnecting sibling tabs don't double-prompt.
  rehydratedByUser.delete(state.userId);
}

// ---------- Connected-clients registry (so tRPC can push) ----------

const clientsByUser = new Map<string, Set<ClientState>>();

/**
 * Phase 14 — extension-reported login states. Per-user map of
 * domain → boolean. Updated whenever a Chrome extension client
 * sends `client.extension.login_states`. Read by the playbook
 * router in tasks.ts to log "user has Chrome login for X" when
 * the matched playbook is loginRequired and the extension is
 * connected. In-memory only; resets on orchestrator restart and
 * fills back in within ~5 minutes (the extension's alarms tick).
 *
 * Stale entries (older than 30 min) are treated as null at read
 * time — the domain map is upserted in full on every report so
 * an absent key means "extension never told us about that site",
 * which is also "unknown".
 */
interface ExtensionLoginStateEntry {
  states: Map<string, boolean>;
  updatedAt: number;
}
const EXTENSION_STATE_TTL_MS = 30 * 60 * 1000;
const extensionLoginStateByUser = new Map<string, ExtensionLoginStateEntry>();

function setExtensionLoginStates(userId: string, raw: Record<string, boolean>): void {
  const states = new Map<string, boolean>();
  for (const [k, v] of Object.entries(raw)) states.set(k.toLowerCase(), v);
  extensionLoginStateByUser.set(userId, { states, updatedAt: Date.now() });
}

/**
 * Lookup: did the user's Chrome report a logged-in state for `domain`
 * within the freshness TTL? Returns null when unknown (extension never
 * reported, report expired, or no extension). Domain is matched
 * case-insensitively against the bare host the extension shipped.
 */
export function getExtensionLoginState(userId: string, domain: string): boolean | null {
  const entry = extensionLoginStateByUser.get(userId);
  if (!entry) return null;
  if (Date.now() - entry.updatedAt > EXTENSION_STATE_TTL_MS) return null;
  const v = entry.states.get(domain.toLowerCase());
  return v ?? null;
}

function addClientForUser(userId: string, client: ClientState): void {
  const set = clientsByUser.get(userId) ?? new Set();
  set.add(client);
  clientsByUser.set(userId, set);
}

function removeClientForUser(userId: string, client: ClientState): void {
  const set = clientsByUser.get(userId);
  if (!set) return;
  set.delete(client);
  if (set.size === 0) clientsByUser.delete(userId);
}

/**
 * Message types that, if sent to a Chrome extension WS client, would
 * drive the user's LOCAL Chrome via chrome.debugger. P0 guard
 * (Phase 24 RC follow-up): drop them at the broadcast boundary so a
 * legacy code path emitting these (e.g. TaskController's planned-step
 * dispatch) cannot accidentally hijack the user's browser. The SPA
 * web client doesn't act on these types either, so dropping is safe.
 *
 * Cookie-sync uses HTTP POST /cookies/sync, NOT WS — blocking these
 * WS message types does not affect cookie sync.
 */
const TASK_EXECUTION_TYPES = new Set<string>([
  'server.task.dispatch',
  'server.vision.observe',
  'server.vision.act',
]);

/**
 * Send a message to every WebSocket currently authenticated as `userId`.
 * Returns the number of recipients reached.
 *
 * P0 guard: task-execution message types (above) are dropped with a
 * warning instead of being delivered. This prevents a legacy / fallback
 * code path from routing task work to the user's local Chrome via the
 * extension's chrome.debugger surface — task execution must run on
 * the per-task pool Brave only.
 */
export function broadcastToUser(userId: string, msg: ServerMessage): number {
  if (TASK_EXECUTION_TYPES.has(msg.type)) {
    logger.warn(
      { userId, msgType: msg.type },
      'broadcastToUser: P0 GUARD — task-execution message dropped (extension hijack prevention)',
    );
    return 0;
  }
  const set = clientsByUser.get(userId);
  if (!set) return 0;
  let count = 0;
  for (const client of set) {
    if (client.socket.readyState === WebSocket.OPEN) {
      send(client.socket, msg);
      count += 1;
    }
  }
  return count;
}

/** Update an in-memory TaskState for every connected socket of `userId`. */
export function updateTaskStateForUser(userId: string, state: TaskState): number {
  const set = clientsByUser.get(userId);
  if (!set) return 0;
  let count = 0;
  for (const client of set) {
    client.tasks.set(state.taskId, state);
    count += 1;
  }
  return count;
}

function handleProtocols(protocols: Set<string>): string | false {
  // Subprotocol format: "holaday.v1" (+ optional "jwt.<token>" as second value)
  if (protocols.has(WS_SUBPROTOCOL)) return WS_SUBPROTOCOL;
  return false;
}

async function handleConnection(socket: WebSocket, req: IncomingMessage) {
  const state: ClientState = {
    id: randomUUID(),
    userId: null,
    socket,
    lastPongAt: Date.now(),
    authed: false,
    tasks: new Map(),
    healedStepIds: new Set(),
  };

  const requestedProtos = (req.headers['sec-websocket-protocol'] ?? '')
    .toString()
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const jwtProto = requestedProtos.find((p) => p.startsWith('jwt.'));
  if (jwtProto) {
    const token = jwtProto.slice('jwt.'.length);
    const userId = await verifyToken(token);
    if (userId) {
      state.userId = userId;
      state.authed = true;
      addClientForUser(userId, state);
      send(socket, {
        type: 'server.welcome',
        clientId: state.id,
        heartbeatMs: HEARTBEAT_INTERVAL_MS,
      });
      applyRehydrationForUser(state);
    }
  }

  // Give the client 10s to prove auth via first-frame `client.hello` if header path failed.
  const authTimer = setTimeout(() => {
    if (!state.authed) {
      send(socket, { type: 'server.error', code: 'UNAUTHORIZED', message: 'auth timeout' });
      socket.close(4401, 'unauthorized');
    }
  }, 10_000);
  authTimer.unref();

  socket.on('message', async (raw) => {
    const result = parseClientMessage(raw.toString());
    if (!result.success) {
      send(socket, {
        type: 'server.error',
        code: 'BAD_FRAME',
        message: result.error,
      });
      return;
    }
    await handleClientMessage(state, result.data, authTimer);
  });

  socket.on('pong', () => {
    state.lastPongAt = Date.now();
  });

  socket.on('close', () => {
    clearTimeout(authTimer);
    if (state.userId) removeClientForUser(state.userId, state);
    logger.info({ clientId: state.id, userId: state.userId }, 'ws client closed');
  });

  socket.on('error', (err) => {
    logger.warn({ clientId: state.id, err }, 'ws error');
  });
}

async function handleClientMessage(
  state: ClientState,
  msg: ClientMessage,
  authTimer: NodeJS.Timeout,
) {
  if (msg.type === 'client.hello') {
    const userId = await verifyToken(msg.token);
    if (!userId) {
      send(state.socket, { type: 'server.error', code: 'UNAUTHORIZED', message: 'bad token' });
      state.socket.close(4401, 'unauthorized');
      return;
    }
    state.userId = userId;
    state.authed = true;
    addClientForUser(userId, state);
    clearTimeout(authTimer);
    send(state.socket, {
      type: 'server.welcome',
      clientId: state.id,
      heartbeatMs: HEARTBEAT_INTERVAL_MS,
    });
    applyRehydrationForUser(state);
    return;
  }

  if (!state.authed) {
    send(state.socket, { type: 'server.error', code: 'UNAUTHORIZED', message: 'hello required' });
    return;
  }

  if (msg.type === 'client.pong') {
    state.lastPongAt = Date.now();
    return;
  }

  if (msg.type === 'client.task.ack') {
    logger.debug({ taskId: msg.taskId, stepId: msg.stepId, clientId: state.id }, 'task ack');
    return;
  }

  if (msg.type === 'client.step.result') {
    void runStepResult(state, msg);
    return;
  }

  if (msg.type === 'client.screenshot') {
    logger.debug(
      { taskId: msg.taskId, stepId: msg.stepId, key: msg.key, clientId: state.id },
      'screenshot ready',
    );
    return;
  }

  if (msg.type === 'client.vision.observation') {
    const key = visionKey(msg.taskId, msg.tickIndex);
    const resolver = pendingObservations.get(key);
    if (resolver) resolver(msg);
    else {
      logger.warn(
        { taskId: msg.taskId, tickIndex: msg.tickIndex },
        'vision.observation arrived with no pending request (late response?)',
      );
    }
    return;
  }

  if (msg.type === 'client.vision.acted') {
    const key = visionKey(msg.taskId, msg.tickIndex);
    const resolver = pendingActed.get(key);
    if (resolver) resolver(msg);
    else {
      logger.warn(
        { taskId: msg.taskId, tickIndex: msg.tickIndex },
        'vision.acted arrived with no pending request',
      );
    }
    return;
  }

  if (msg.type === 'client.vision.user_input') {
    // Pool-aware: prefer the caller's per-user pool executor over
    // the shared singleton. Without this, clicks/insert_text from a
    // user on the per-user pool would land on whatever browser the
    // singleton is pinned to (worst-case: another user's session).
    const perUserExec =
      state.userId && injectedBrowserPool
        ? injectedBrowserPool.peek(state.userId)?.executor ?? null
        : null;
    const exec = perUserExec ?? injectedExecutor;
    await dispatchUserInput(msg, exec, state.userId ?? null);
    return;
  }

  if (msg.type === 'client.extension.login_states') {
    if (state.userId) {
      setExtensionLoginStates(state.userId, msg.states);
      logger.debug(
        {
          userId: state.userId,
          clientId: state.id,
          domains: Object.keys(msg.states).length,
        },
        'extension: login states updated',
      );
    }
    return;
  }
}

type UserInputMsg = Extract<ClientMessage, { type: 'client.vision.user_input' }>;

/**
 * Dispatch a user-driven panel interaction (click / scroll / type /
 * key) straight to PlaywrightExecutor. Exposed for unit tests; prod
 * code path reaches it through handleClientMessage.
 *
 * When no executor is wired (legacy WS/SW path), log + no-op so the
 * frontend doesn't get a hard error — the UX there is "interactive
 * mode isn't available for your session" not "WS is broken".
 */
export async function dispatchUserInput(
  msg: UserInputMsg,
  executor: PlaywrightExecutor | null,
  userId: string | null,
): Promise<void> {
  if (!executor) {
    logger.warn(
      { userId, kind: msg.kind, taskId: msg.taskId },
      'user_input received but no PlaywrightExecutor wired — ignoring',
    );
    return;
  }
  try {
    // PlaywrightExecutor's action methods take our internal PageLike.
    // `getPage()` returns a real `Page`, but the shapes diverge on
    // optional-arg signatures that TS rejects at the union level; the
    // rest of the codebase uses the same `as unknown as` bridge.
    const page = (await executor.getPage()) as unknown as Parameters<
      PlaywrightExecutor['click']
    >[0];
    switch (msg.kind) {
      case 'click': {
        if (typeof msg.x !== 'number' || typeof msg.y !== 'number') {
          logger.warn({ msg: 'user_input.click missing x/y' });
          return;
        }
        await executor.click(page, msg.x, msg.y, msg.button ?? 'left');
        break;
      }
      case 'type': {
        if (!msg.text) return;
        await executor.type(page, msg.text);
        break;
      }
      case 'insert_text': {
        if (!msg.text) return;
        await executor.insertText(page, msg.text);
        break;
      }
      case 'key': {
        if (!msg.key) return;
        await executor.pressKey(page, msg.key);
        break;
      }
      case 'scroll': {
        if (typeof msg.scrollDeltaY !== 'number') return;
        await executor.scroll(
          page,
          msg.scrollDeltaY,
          typeof msg.x === 'number' ? msg.x : undefined,
          typeof msg.y === 'number' ? msg.y : undefined,
        );
        break;
      }
    }
    logger.info(
      {
        action: 'panel_user_input',
        kind: msg.kind,
        taskId: msg.taskId ?? null,
        userId,
      },
      'dispatched user_input to PlaywrightExecutor',
    );

    // After the user's action lands, capture a fresh frame and push
    // it back. Otherwise the screencast only updates when the agent
    // takes its next tool action — which can be never during a
    // user-driven captcha solve or free-drive session. Without this
    // the panel visibly "freezes" after the click, even though the
    // remote page has actually moved.
    if (userId) {
      try {
        const freshPage = (await executor.getPage()) as unknown as Parameters<
          PlaywrightExecutor['screenshot']
        >[0];
        const shot = await executor.screenshot(freshPage);
        if (!shot.error && shot.base64) {
          broadcastToUser(userId, {
            type: 'server.vision.screencast',
            taskId: msg.taskId ?? '',
            // Interactive-mode frames don't belong to any agent tick;
            // -1 is the sentinel the UI uses to skip "第 N 帧" chrome.
            tickIndex: -1,
            imageBase64: shot.base64,
            url: (freshPage as unknown as { url: () => string }).url(),
            viewport: {
              width: shot.viewportWidth ?? 1280,
              height: shot.viewportHeight ?? 800,
            },
            timestamp: new Date().toISOString(),
          });
        }
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'user_input post-action screencast capture failed',
        );
      }
    }
  } catch (err) {
    logger.error(
      {
        err: err instanceof Error ? err.message : String(err),
        kind: msg.kind,
        taskId: msg.taskId,
      },
      'handleUserInput failed',
    );
  }
}

// ---------- Vision-loop request/response plumbing ----------

/**
 * Correlation key for a (taskId, tickIndex) vision round-trip. One
 * outstanding request per kind per tick — the runner never asks twice
 * for the same observation / same action slot.
 */
function visionKey(taskId: string, tickIndex: number): string {
  return `${taskId}:${tickIndex}`;
}

type ObservationMsg = Extract<ClientMessage, { type: 'client.vision.observation' }>;
type ActedMsg = Extract<ClientMessage, { type: 'client.vision.acted' }>;

const pendingObservations = new Map<string, (m: ObservationMsg) => void>();
const pendingActed = new Map<string, (m: ActedMsg) => void>();

/**
 * Default per-tick round-trip timeout. Screenshot + Runtime.evaluate
 * + WS hops is normally sub-second; 15s absorbs cold-SW wake-ups and
 * slow pages without blocking a stuck task forever.
 */
const VISION_RTT_TIMEOUT_MS = 15_000;

/**
 * Ask the SW for an observation. Sends `server.vision.observe` to a
 * connected client for `userId` and resolves when the matching
 * `client.vision.observation` arrives. Rejects on timeout, on no
 * connected client, or if a duplicate request is already outstanding.
 *
 * Exported so the vision-loop task runner can inject it as its
 * `screenshotFn`. Not part of a class — server.ts already owns the
 * per-user client map, so threading this through a class would
 * duplicate bookkeeping.
 */
export async function requestVisionObservationFromSW(
  userId: string,
  taskId: string,
  tickIndex: number,
  timeoutMs: number = VISION_RTT_TIMEOUT_MS,
): Promise<ObservationMsg> {
  // P0 SAFETY GUARD — Phase 24 RC follow-up.
  // The Chrome extension WS path drives the USER'S LOCAL CHROME via
  // chrome.debugger. Routing task screenshots through it surfaces a
  // "HOLA DAY 已开始调试此浏览器" banner and opens task target URLs
  // in the user's own browser tabs. The pool's per-task Brave is the
  // ONLY legitimate execution surface; the extension WS exists only
  // for cookie-sync HTTP. Throw aggressively so the caller sees a
  // hard failure instead of silently hijacking the user's browser.
  // The original implementation (firstConnectedClient → send) was
  // ripped out — re-enabling extension-driven task execution requires
  // a deliberate code change, not a feature flag.
  void userId;
  void timeoutMs;
  void pendingObservations;
  throw new Error(
    `extension-WS task execution disabled — task ${taskId} tick ${tickIndex} ` +
      'must run on per-task pool Brave only (P0 safety guard).',
  );
}

/**
 * Dispatch a VisionAction to the SW and await the acted-frame reply.
 * `action.click.x/y` must already be REAL viewport pixels (runner
 * applies modelCoordToReal before calling this).
 */
export async function dispatchVisionActionToSW(
  userId: string,
  taskId: string,
  tickIndex: number,
  action: Extract<ServerMessage, { type: 'server.vision.act' }>['action'],
  timeoutMs: number = VISION_RTT_TIMEOUT_MS,
): Promise<ActedMsg> {
  // P0 SAFETY GUARD — Phase 24 RC follow-up. See parallel guard in
  // requestVisionObservationFromSW above. The extension's CDP surface
  // is the user's LOCAL Chrome; dispatching VisionAction (click/type/
  // navigate) through it drives the user's own tabs. We refuse at
  // the dispatch boundary so no caller can accidentally hijack — the
  // task fails loudly instead.
  void userId;
  void action;
  void timeoutMs;
  void pendingActed;
  throw new Error(
    `extension-WS task execution disabled — task ${taskId} tick ${tickIndex} ` +
      'must run on per-task pool Brave only (P0 safety guard).',
  );
}
function firstConnectedClient(userId: string): ClientState | null {
  const set = clientsByUser.get(userId);
  if (!set || set.size === 0) return null;
  // Iterator-first; Phase B will pick by last-heartbeat freshness.
  for (const c of set) return c;
  return null;
}

/**
 * Layer 5 — does `userId` have at least one authed WS client with an
 * open socket right now? Exported for the vision-loop fallback path
 * so it can decide whether swapping the transport to the extension
 * would actually get the task executed.
 */
export function hasConnectedSwClient(userId: string): boolean {
  const set = clientsByUser.get(userId);
  if (!set) return false;
  for (const c of set) {
    if (c.authed && c.socket.readyState === WebSocket.OPEN) return true;
  }
  return false;
}

async function runStepResult(
  state: ClientState,
  msg: Extract<ClientMessage, { type: 'client.step.result' }>,
): Promise<void> {
  const taskState = state.tasks.get(msg.taskId);
  if (!taskState) {
    send(state.socket, {
      type: 'server.error',
      code: 'UNKNOWN_TASK',
      message: `no in-flight task ${msg.taskId}`,
    });
    return;
  }

  // Self-heal hook. BEFORE we hand this result to the state machine,
  // see if it's a SELECTOR_NOT_FOUND on a step that still has retries
  // available. If so, call the planner with the driver's diagnostic
  // and, if it hands back a replacement ResilientSelector, swap it
  // onto the in-memory plan's current step. TaskController's built-in
  // MAX_STEP_RETRIES=1 then re-dispatches the SAME step id with the
  // new selector — zero state-machine change, single extra Opus call
  // per failing step, capped at one heal per step.
  if (msg.status === 'error' && msg.error?.code === 'SELECTOR_NOT_FOUND') {
    await maybeSelfHeal(state, taskState, msg);
  }

  // Heal-success bookkeeping: if the current msg is an OK result for
  // a step we healed on the prior dispatch, flip heal_succeeded=1 on
  // the DB row and forget the tracking. We run this BEFORE the
  // controller advances the cursor — the DB update is independent
  // of the state-machine transition.
  if (msg.status === 'ok' && state.healedStepIds.has(msg.stepId)) {
    state.healedStepIds.delete(msg.stepId);
    try {
      await taskRepository.markHealSucceeded({
        taskExternalId: msg.taskId,
        stepExternalId: msg.stepId,
      });
    } catch (err) {
      logger.warn(
        { err, taskId: msg.taskId, stepId: msg.stepId },
        'markHealSucceeded failed (non-fatal)',
      );
    }
  }

  const { state: nextState, effects } = taskController.onStepResult(taskState, {
    taskId: msg.taskId,
    stepId: msg.stepId,
    status: msg.status,
    data: msg.data,
    error: msg.error,
  });

  state.tasks.set(msg.taskId, nextState);

  for (const eff of effects) {
    if (eff.kind === 'send') {
      send(state.socket, eff.message);
    }
    if (eff.kind === 'persist') {
      try {
        await taskRepository.applyStepResult(taskState, nextState, msg.data, msg.status);
      } catch (err) {
        logger.error({ err, taskId: msg.taskId }, 'persist applyStepResult failed');
      }
    }
  }
}

/**
 * On SELECTOR_NOT_FOUND, call `planner.healSelector()` with the
 * driver's diagnostic payload (URL, title, per-strategy failures,
 * screenshot base64) and — if it returns a replacement — mutate the
 * in-memory plan's current step selector IN PLACE. The retry that
 * fires from TaskController.onStepResult immediately after picks up
 * the new selector transparently.
 *
 * Constraints:
 *  - Only fires if a planner is injected (StubPlanner path skips).
 *  - Only fires on the step's first failure (retryCount[stepId]===0);
 *    if we already healed once this step, fall through to the normal
 *    retries-exhausted path.
 *  - Never throws — planner.healSelector has its own try/catch and
 *    returns null on failure. If heal declines or errors, the
 *    controller's retry still fires with the ORIGINAL selector,
 *    same as pre-self-heal behaviour.
 */
async function maybeSelfHeal(
  clientState: ClientState,
  taskState: TaskState,
  msg: Extract<ClientMessage, { type: 'client.step.result' }>,
): Promise<void> {
  const planner = injectedPlanner;
  if (!planner) return;
  const current = taskState.plan[taskState.cursor];
  if (!current || current.id !== msg.stepId) return;
  if (!current.selector) return;
  const consumed = taskState.retryCount?.[msg.stepId] ?? 0;
  if (consumed > 0) return; // only heal on the first failure

  const diagnostic = extractDiagnostic(msg.data);
  if (!diagnostic) return;

  let healResult: Awaited<ReturnType<typeof planner.healSelector>>;
  try {
    healResult = await planner.healSelector({
      userId: clientState.userId ?? undefined,
      originalStep: current,
      diagnostic,
    });
  } catch (err) {
    // Belt-and-braces: planner.healSelector is contracted not to throw.
    logger.warn({ err, taskId: taskState.taskId, stepId: msg.stepId }, 'self-heal threw');
    return;
  }

  // Record the attempt on the step row — whether the selector came
  // back or not. `heal_attempts` reflects how often we asked; the
  // separate `heal_succeeded` flag reflects whether the subsequent
  // retry actually landed ok. This split lets `tasks.healStats`
  // compute a genuine success rate (succeeded / attempts), not a
  // "did the model produce any output" rate.
  try {
    await taskRepository.recordHealAttempt({
      taskExternalId: taskState.taskId,
      stepExternalId: msg.stepId,
      elapsedMs: healResult.elapsedMs,
      inputTokens: healResult.inputTokens,
      outputTokens: healResult.outputTokens,
    });
  } catch (err) {
    logger.warn(
      { err, taskId: taskState.taskId, stepId: msg.stepId },
      'recordHealAttempt failed (non-fatal)',
    );
  }

  if (!healResult.selector) {
    logger.info(
      { taskId: taskState.taskId, stepId: msg.stepId, elapsedMs: healResult.elapsedMs },
      'selector self-heal declined — falling through to normal retry',
    );
    return;
  }
  // Mutate in place. We intentionally DON'T persist the new selector
  // to task_steps.input — Phase 0 keeps the DB record of the
  // original plan for audit; the heal result lives in memory for
  // the retry, and on restart a mid-heal task would rehydrate to
  // the original plan (retries already consumed → paused on first
  // miss, user resumes manually). Good enough for Phase 0 dogfood.
  current.selector = healResult.selector;
  // Track so a subsequent OK result flips heal_succeeded=1.
  clientState.healedStepIds.add(msg.stepId);
  logger.info(
    {
      taskId: taskState.taskId,
      stepId: msg.stepId,
      kind: current.kind,
      originalStrategies: healResult.selector.strategies.length,
      elapsedMs: healResult.elapsedMs,
      inputTokens: healResult.inputTokens,
      outputTokens: healResult.outputTokens,
    },
    'selector self-heal succeeded — retry will use new selector',
  );
}

interface Diagnostic {
  url: string;
  title: string;
  strategies: { kind: string; selector: string; reason: string }[];
  screenshot?: string;
}

/**
 * Pull the SELECTOR_NOT_FOUND diagnostic payload out of the driver's
 * `data` field. Shape matches `SelectorNotFoundDiagnostic` from
 * packages/browser-driver/src/crx-adapter.ts. Returns null when the
 * payload isn't present — e.g. a non-crx adapter that didn't bother
 * to attach page state, or an older extension build.
 */
function extractDiagnostic(data: unknown): Diagnostic | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as {
    url?: unknown;
    title?: unknown;
    strategies?: unknown;
    screenshot?: unknown;
  };
  if (typeof d.url !== 'string' || typeof d.title !== 'string') return null;
  if (!Array.isArray(d.strategies)) return null;
  const strategies: Diagnostic['strategies'] = [];
  for (const row of d.strategies) {
    if (!row || typeof row !== 'object') continue;
    const r = row as { kind?: unknown; selector?: unknown; reason?: unknown };
    if (
      typeof r.kind === 'string' &&
      typeof r.selector === 'string' &&
      typeof r.reason === 'string'
    ) {
      strategies.push({ kind: r.kind, selector: r.selector, reason: r.reason });
    }
  }
  return {
    url: d.url,
    title: d.title,
    strategies,
    ...(typeof d.screenshot === 'string' ? { screenshot: d.screenshot } : {}),
  };
}

async function verifyToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, jwtKey, { algorithms: ['HS256'] });
    if (typeof payload.sub === 'string') return payload.sub;
    return null;
  } catch {
    return null;
  }
}

function send(socket: WebSocket, msg: ServerMessage) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(msg));
  }
}

function sweep(wss: WebSocketServer) {
  const now = Date.now();
  for (const client of wss.clients) {
    if (client.readyState !== WebSocket.OPEN) continue;
    const previous = lastPingAt.get(client) ?? now;
    if (now - previous > HEARTBEAT_TIMEOUT_MS) {
      client.terminate();
      continue;
    }
    client.ping();
    lastPingAt.set(client, now);
  }
}
