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

export interface WsServerOpts {
  planner?: Planner | null;
}

export function createWsServer(port: number, opts: WsServerOpts = {}) {
  injectedPlanner = opts.planner ?? null;

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
 * Send a message to every WebSocket currently authenticated as `userId`.
 * Returns the number of recipients reached.
 */
export function broadcastToUser(userId: string, msg: ServerMessage): number {
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
    await maybeSelfHeal(taskState, msg);
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

  try {
    const healed = await planner.healSelector({
      userId: undefined, // Phase 0: we don't thread user external id through ClientState yet
      originalStep: current,
      diagnostic,
    });
    if (!healed) {
      logger.info(
        { taskId: taskState.taskId, stepId: msg.stepId },
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
    current.selector = healed;
    logger.info(
      {
        taskId: taskState.taskId,
        stepId: msg.stepId,
        kind: current.kind,
        originalStrategies: healed.strategies.length,
      },
      'selector self-heal succeeded — retry will use new selector',
    );
  } catch (err) {
    // Belt-and-braces: planner.healSelector is contracted not to
    // throw, but if it does we swallow and fall through.
    logger.warn({ err, taskId: taskState.taskId, stepId: msg.stepId }, 'self-heal threw');
  }
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
