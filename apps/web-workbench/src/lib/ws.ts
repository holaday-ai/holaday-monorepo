import {
  type ClientMessage,
  HEARTBEAT_INTERVAL_MS,
  type ServerMessage,
  WS_SUBPROTOCOL,
  parseServerMessage,
} from '@holaday/shared-types';
import { getAccessToken } from '@/lib/auth';
import { hdDebug } from '@/lib/hd-debug';

/**
 * WebSocket client for the orchestrator. Patterned on the Chrome
 * extension's ws-client (apps/extension/src/background/ws-client.ts):
 *   - auth via subprotocol header `holaday.v1, jwt.<token>`
 *   - client.hello fallback (a proxy may strip the jwt subprotocol)
 *   - heartbeat: `client.pong` every HEARTBEAT_INTERVAL_MS (30s)
 *   - reconnect with exponential back-off capped at 30s + jitter
 *   - skip reconnect on code 4401 (auth rejected) so a stale token
 *     doesn't hammer the server forever.
 *
 * Browser-specific differences from the extension:
 *   - URL is `/ws` (vite proxies to ws://127.0.0.1:3002 in dev,
 *     same-origin in prod)
 *   - No chrome.runtime.getManifest() — we pass a fixed source string
 *     as `extensionVersion` so server logs can tell clients apart.
 */
const WS_URL = buildWsUrl();
const WEB_SOURCE = 'web-workbench';

type Listener = (msg: ServerMessage) => void;
type StatusListener = (status: ConnStatus) => void;

export type ConnStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'unauthorized';

interface State {
  socket: WebSocket | null;
  reconnectAttempt: number;
  pingTimer: ReturnType<typeof setInterval> | null;
  closedByUser: boolean;
  listeners: Set<Listener>;
  statusListeners: Set<StatusListener>;
  status: ConnStatus;
}

const state: State = {
  socket: null,
  reconnectAttempt: 0,
  pingTimer: null,
  closedByUser: false,
  listeners: new Set(),
  statusListeners: new Set(),
  status: 'idle',
};

function setStatus(next: ConnStatus): void {
  state.status = next;
  for (const fn of state.statusListeners) fn(next);
}

function buildWsUrl(): string {
  // Dev: vite proxy handles `/ws` → ws://127.0.0.1:3002 (strips the
  // prefix). Prod: same-origin /ws behind the same ingress. This lets
  // us stay origin-relative and avoid hard-coding host/port.
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}

export function onServerMessage(fn: Listener): () => void {
  state.listeners.add(fn);
  return () => {
    state.listeners.delete(fn);
  };
}

export function onStatus(fn: StatusListener): () => void {
  state.statusListeners.add(fn);
  // fire current status once so subscribers don't need a separate read
  fn(state.status);
  return () => {
    state.statusListeners.delete(fn);
  };
}

export function send(msg: ClientMessage): boolean {
  if (state.socket?.readyState !== WebSocket.OPEN) return false;
  state.socket.send(JSON.stringify(msg));
  return true;
}

export function isConnected(): boolean {
  return state.socket?.readyState === WebSocket.OPEN;
}

/**
 * Connect. Reads the token fresh from localStorage so a just-completed
 * login lands the right credential. Idempotent — a healthy socket
 * short-circuits (no churn when mounted twice by React StrictMode).
 */
export function connect(): void {
  const token = getAccessToken();
  if (!token) {
    setStatus('unauthorized');
    return;
  }
  if (
    state.socket &&
    (state.socket.readyState === WebSocket.OPEN || state.socket.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }
  state.closedByUser = false;
  openSocket(token);
}

export function disconnect(): void {
  state.closedByUser = true;
  state.socket?.close(1000, 'client requested disconnect');
  if (state.pingTimer) {
    clearInterval(state.pingTimer);
    state.pingTimer = null;
  }
  state.socket = null;
  setStatus('closed');
}

function openSocket(token: string): void {
  setStatus('connecting');
  const protocols = [WS_SUBPROTOCOL, `jwt.${token}`];
  const ws = new WebSocket(WS_URL, protocols);
  state.socket = ws;

  ws.addEventListener('open', () => {
    state.reconnectAttempt = 0;
    setStatus('open');
    // Fallback hello: if a proxy stripped the subprotocol we still
    // auth this way. The server accepts both paths and swallows the
    // duplicate cleanly when the header already succeeded.
    send({ type: 'client.hello', token, extensionVersion: WEB_SOURCE });
    state.pingTimer = setInterval(() => {
      send({ type: 'client.pong', at: Date.now() });
    }, HEARTBEAT_INTERVAL_MS);
  });

  ws.addEventListener('message', (event) => {
    const result = parseServerMessage(typeof event.data === 'string' ? event.data : '');
    if (!result.success) {
      // biome-ignore lint/suspicious/noConsole: surfaced for debugging
      console.warn('[web-workbench/ws] bad server frame', result.error);
      return;
    }
    if (result.data.type.startsWith('server.task.')) {
      const m = result.data as { type: string; taskId?: string };
      hdDebug('WS msg', {
        type: m.type,
        taskId: m.taskId ?? '(none)',
      });
    }
    for (const fn of state.listeners) fn(result.data);
  });

  ws.addEventListener('close', (event) => {
    if (state.pingTimer) {
      clearInterval(state.pingTimer);
      state.pingTimer = null;
    }
    state.socket = null;
    if (event.code === 4401) {
      setStatus('unauthorized');
      return;
    }
    if (state.closedByUser) {
      setStatus('closed');
      return;
    }
    setStatus('closed');
    scheduleReconnect();
  });

  ws.addEventListener('error', () => {
    // 'close' fires immediately after; reconnect handled there.
  });
}

function scheduleReconnect(): void {
  state.reconnectAttempt += 1;
  const backoff = Math.min(30_000, 500 * 2 ** state.reconnectAttempt);
  const jitter = Math.floor(Math.random() * 250);
  setTimeout(() => {
    if (state.closedByUser) return;
    const token = getAccessToken();
    if (!token) {
      setStatus('unauthorized');
      return;
    }
    openSocket(token);
  }, backoff + jitter);
}
