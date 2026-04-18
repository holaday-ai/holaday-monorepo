import {
  type ClientMessage,
  HEARTBEAT_INTERVAL_MS,
  type ServerMessage,
  WS_SUBPROTOCOL,
  parseServerMessage,
} from '@holaday/shared-types';
import { ORCHESTRATOR_WS } from '../shared/config.js';

type Listener = (msg: ServerMessage) => void;

interface State {
  socket: WebSocket | null;
  reconnectAttempt: number;
  pingTimer: ReturnType<typeof setInterval> | null;
  closedByUser: boolean;
  listeners: Set<Listener>;
}

const state: State = {
  socket: null,
  reconnectAttempt: 0,
  pingTimer: null,
  closedByUser: false,
  listeners: new Set(),
};

export function onServerMessage(fn: Listener): () => void {
  state.listeners.add(fn);
  return () => state.listeners.delete(fn);
}

export function send(msg: ClientMessage): boolean {
  if (state.socket?.readyState !== WebSocket.OPEN) return false;
  state.socket.send(JSON.stringify(msg));
  return true;
}

export function disconnect(): void {
  state.closedByUser = true;
  state.socket?.close(1000, 'client requested disconnect');
}

/**
 * Connect to the orchestrator. Auth path:
 *   sec-websocket-protocol = "holaday.v1, jwt.<token>"
 * If the server doesn't honour the header, we send `client.hello` as the
 * first frame as a fallback (the orchestrator accepts both).
 *
 * Reconnect with exponential back-off (cap 30s). PoC A1 success = first
 * `server.welcome` message arrives back here.
 */
export function connect(token: string): void {
  if (!token) throw new Error('connect() requires a token');
  state.closedByUser = false;
  openSocket(token);
}

function openSocket(token: string): void {
  const protocols = [WS_SUBPROTOCOL, `jwt.${token}`];
  const ws = new WebSocket(ORCHESTRATOR_WS, protocols);
  state.socket = ws;

  ws.addEventListener('open', () => {
    state.reconnectAttempt = 0;
    // Header path may have been stripped by some proxies; fallback hello.
    send({ type: 'client.hello', token, extensionVersion: chrome.runtime.getManifest().version });

    state.pingTimer = setInterval(() => {
      send({ type: 'client.pong', at: Date.now() });
    }, HEARTBEAT_INTERVAL_MS);
  });

  ws.addEventListener('message', (event) => {
    const result = parseServerMessage(typeof event.data === 'string' ? event.data : '');
    if (!result.success) {
      console.warn('[holaday] bad server frame', result.error);
      return;
    }
    for (const fn of state.listeners) fn(result.data);
  });

  ws.addEventListener('close', (event) => {
    if (state.pingTimer) clearInterval(state.pingTimer);
    state.pingTimer = null;
    state.socket = null;
    if (state.closedByUser || event.code === 4401) return;
    scheduleReconnect(token);
  });

  ws.addEventListener('error', () => {
    // 'close' will fire right after; reconnect handled there.
  });
}

function scheduleReconnect(token: string): void {
  state.reconnectAttempt += 1;
  const backoff = Math.min(30_000, 500 * 2 ** state.reconnectAttempt);
  const jitter = Math.floor(Math.random() * 250);
  setTimeout(() => {
    if (!state.closedByUser) openSocket(token);
  }, backoff + jitter);
}
