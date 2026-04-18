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
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

interface ClientState {
  id: string;
  userId: string | null;
  socket: WebSocket;
  lastPongAt: number;
  authed: boolean;
  // taskId -> state. Phase 0 in-memory; persistence wires in W2.
  tasks: Map<string, TaskState>;
}

const taskController = new TaskController();

const jwtKey = new TextEncoder().encode(env.JWT_SECRET);

const lastPingAt = new WeakMap<WebSocket, number>();

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
    runStepResult(state, msg);
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

function runStepResult(
  state: ClientState,
  msg: Extract<ClientMessage, { type: 'client.step.result' }>,
): void {
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
    // eff.kind === 'persist' wires to MySQL in W2 (SkillLoader / TaskRunner).
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
