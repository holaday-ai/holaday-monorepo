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

export function createWsServer(port: number) {
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
 * re-emit server.user.confirm for anything in awaiting_user so the
 * extension immediately re-prompts the user after a restart.
 */
function applyRehydrationForUser(state: ClientState): void {
  if (!state.userId) return;
  const bucket = rehydratedByUser.get(state.userId);
  if (!bucket || bucket.length === 0) return;

  for (const entry of bucket) {
    state.tasks.set(entry.state.taskId, entry.state);
    if (entry.state.status === 'awaiting_user' && entry.pendingConfirm) {
      send(state.socket, {
        type: 'server.user.confirm',
        taskId: entry.state.taskId,
        stepId: entry.pendingConfirm.stepId,
        prompt: entry.pendingConfirm.prompt,
        risk: entry.pendingConfirm.risk,
      });
    }
  }
  logger.info(
    { userId: state.userId, rehydratedCount: bucket.length },
    'rehydrated tasks delivered to client',
  );
  // Drain so reconnecting sibling tabs don't double-prompt.
  rehydratedByUser.delete(state.userId);
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
        await taskRepository.applyStepResult(taskState, nextState, msg.data);
      } catch (err) {
        logger.error({ err, taskId: msg.taskId }, 'persist applyStepResult failed');
      }
    }
  }
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
