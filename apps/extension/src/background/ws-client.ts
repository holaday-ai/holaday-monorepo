import {
  type ClientMessage,
  HEARTBEAT_INTERVAL_MS,
  type ServerMessage,
  WS_SUBPROTOCOL,
  parseServerMessage,
} from '@holaday/shared-types';
import { ORCHESTRATOR_WS, ORCHESTRATOR_WS_ENDPOINTS } from '../shared/config.js';
import { withDeadline } from '../shared/deadline.js';

type Listener = (msg: ServerMessage) => void;
type UnauthorizedListener = () => void;

const WS_OPEN_TIMEOUT_MS = 12_000;

interface State {
  socket: WebSocket | null;
  token: string | null;
  socketGeneration: number;
  reconnectAttempt: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  pingTimer: ReturnType<typeof setInterval> | null;
  closedByUser: boolean;
  lastOpenAt: number | null;
  lastCloseAt: number | null;
  lastCloseCode: number | null;
  lastCloseReason: string | null;
  lastErrorAt: number | null;
  nextRetryAt: number | null;
  endpointIndex: number;
  endpointUrl: string | null;
  listeners: Set<Listener>;
  /**
   * Phase 14 — fires when the orchestrator closes us with code 4401
   * (or sends `server.error` with code='UNAUTHORIZED'). The SW uses
   * this to clear the stale token from chrome.storage so the next
   * ensureConnected runs auto-login from a fresh state instead of
   * looping forever on a bad token.
   */
  unauthorizedListeners: Set<UnauthorizedListener>;
}

const state: State = {
  socket: null,
  token: null,
  socketGeneration: 0,
  reconnectAttempt: 0,
  reconnectTimer: null,
  pingTimer: null,
  closedByUser: false,
  lastOpenAt: null,
  lastCloseAt: null,
  lastCloseCode: null,
  lastCloseReason: null,
  lastErrorAt: null,
  nextRetryAt: null,
  endpointIndex: 0,
  endpointUrl: null,
  listeners: new Set(),
  unauthorizedListeners: new Set(),
};

export interface WsConnectionStatus {
  connected: boolean;
  readyState: number | null;
  reconnectAttempt: number;
  reconnectCapped: boolean;
  lastOpenAt: number | null;
  lastCloseAt: number | null;
  lastCloseCode: number | null;
  lastCloseReason: string | null;
  lastErrorAt: number | null;
  nextRetryAt: number | null;
  endpointIndex: number;
  endpointUrl: string | null;
}

export function onServerMessage(fn: Listener): () => void {
  state.listeners.add(fn);
  return () => state.listeners.delete(fn);
}

export function onUnauthorized(fn: UnauthorizedListener): () => void {
  state.unauthorizedListeners.add(fn);
  return () => state.unauthorizedListeners.delete(fn);
}

export function send(msg: ClientMessage): boolean {
  const socket = state.socket;
  if (socket?.readyState !== WebSocket.OPEN) return false;
  try {
    socket.send(JSON.stringify(msg));
    return true;
  } catch (err) {
    console.warn('[holaday] ws send failed', err);
    recoverFromCurrentSocketSendFailure(socket);
    return false;
  }
}

function recoverFromCurrentSocketSendFailure(socket: WebSocket): void {
  if (state.socket !== socket) return;
  const token = state.token;
  if (state.pingTimer) {
    clearInterval(state.pingTimer);
    state.pingTimer = null;
  }
  state.socket = null;
  state.token = null;
  state.lastErrorAt = Date.now();
  state.lastCloseAt = Date.now();
  state.lastCloseCode = 4000;
  state.lastCloseReason = 'send failed';
  try {
    socket.close(4000, 'send failed');
  } catch {
    /* socket may already be closing */
  }
  if (token && !state.closedByUser) scheduleReconnect(token);
}

export function disconnect(): void {
  state.closedByUser = true;
  clearReconnectTimer();
  const socket = state.socket;
  state.socket = null;
  state.token = null;
  if (state.pingTimer) {
    clearInterval(state.pingTimer);
    state.pingTimer = null;
  }
  try {
    socket?.close(1000, 'client requested disconnect');
  } catch {
    /* socket may already be closing; local state is already cleared */
  }
}

/**
 * Connect to the orchestrator. Auth path:
 *   sec-websocket-protocol = "holaday.v1, jwt.<token>"
 * If the server doesn't honour the header, we send `client.hello` as the
 * first frame as a fallback (the orchestrator accepts both).
 *
 * Reconnect with exponential back-off (cap 30s). PoC A1 success = first
 * `server.welcome` message arrives back here.
 *
 * Idempotent on the SAME token: a healthy socket short-circuits so the
 * keepalive alarm tick (every ~30s) doesn't churn the connection. To
 * swap to a different token (e.g. the SW just lifted a fresher one
 * from a workbench tab) call `reconnect(newToken)` instead — `connect`
 * intentionally never tears down a live socket.
 */
export function connect(token: string): void {
  if (!token) throw new Error('connect() requires a token');
  if (
    state.socket &&
    (state.socket.readyState === WebSocket.OPEN || state.socket.readyState === WebSocket.CONNECTING)
  ) {
    if (state.token !== token) {
      reconnect(token);
    }
    return;
  }
  state.closedByUser = false;
  openSocket(token);
}

/**
 * Phase 14 — explicit token swap. The chrome.storage.onChanged listener
 * fires this when the stored access_token VALUE changes (auto-login
 * lifted a fresher one, popup re-authed, etc.). Without this path the
 * old socket would keep streaming under the stale token until its TTL
 * expired or the orchestrator booted us, and the user would see the
 * old session in the Side Panel.
 *
 * Implementation: mark closedByUser so the close handler doesn't
 * schedule a reconnect on the OLD token, close the existing socket,
 * then open a new one. The new socket's close handler is socket-
 * tagged (see openSocket) so it can ignore the OLD socket's
 * delayed close event without clobbering the new state.
 */
export function reconnect(token: string): void {
  if (!token) throw new Error('reconnect() requires a token');
  if (
    state.socket &&
    state.token === token &&
    (state.socket.readyState === WebSocket.OPEN || state.socket.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }
  clearReconnectTimer();
  if (state.socket) {
    state.closedByUser = true;
    try {
      state.socket.close(1000, 'token swap');
    } catch {
      /* socket may already be closing */
    }
    state.socket = null;
    state.token = null;
    if (state.pingTimer) {
      clearInterval(state.pingTimer);
      state.pingTimer = null;
    }
  }
  state.reconnectAttempt = 0;
  void persistReconnectAttempts(0);
  state.closedByUser = false;
  openSocket(token);
}

export function isConnected(): boolean {
  return state.socket?.readyState === WebSocket.OPEN;
}

export function getCurrentWsToken(): string | null {
  return state.token;
}

export async function getWsConnectionStatus(): Promise<WsConnectionStatus> {
  return {
    connected: isConnected(),
    readyState: state.socket?.readyState ?? null,
    reconnectAttempt: state.reconnectAttempt,
    reconnectCapped: await isReconnectCapped(),
    lastOpenAt: state.lastOpenAt,
    lastCloseAt: state.lastCloseAt,
    lastCloseCode: state.lastCloseCode,
    lastCloseReason: state.lastCloseReason,
    lastErrorAt: state.lastErrorAt,
    nextRetryAt: state.nextRetryAt,
    endpointIndex: state.endpointIndex,
    endpointUrl: state.endpointUrl,
  };
}

function openSocket(token: string): void {
  clearReconnectTimer();
  state.socketGeneration += 1;
  const protocols = [WS_SUBPROTOCOL, `jwt.${token}`];
  const endpoint = getCurrentWsEndpoint();
  state.endpointUrl = endpoint;
  let ws: WebSocket;
  try {
    ws = new WebSocket(endpoint, protocols);
  } catch (err) {
    state.lastErrorAt = Date.now();
    state.lastCloseAt = Date.now();
    state.lastCloseCode = null;
    state.lastCloseReason =
      err instanceof Error ? `open failed: ${err.message}` : 'open failed';
    console.warn('[holaday] ws open failed', err);
    if (!state.closedByUser) {
      scheduleReconnect(token);
    }
    return;
  }
  state.socket = ws;
  state.token = token;
  let openTimer: ReturnType<typeof setTimeout> | null = null;
  let socketSettled = false;
  const clearOpenTimer = (): void => {
    if (openTimer) {
      clearTimeout(openTimer);
      openTimer = null;
    }
  };
  // Phase 14 — server may signal UNAUTHORIZED via BOTH a server.error
  // frame AND a 4401 close. Fire the listeners only once per socket,
  // otherwise the SW's auth-failure counter doubles and we hit the
  // freeze threshold with one real failure.
  let unauthorizedFired = false;
  const fireUnauthorized = (): void => {
    if (unauthorizedFired) return;
    unauthorizedFired = true;
    for (const fn of state.unauthorizedListeners) {
      try {
        fn();
      } catch (err) {
        console.warn('[holaday] unauthorized listener failed', err);
      }
    }
  };
  const settleSocketClose = (code: number, reason: string | null): void => {
    if (socketSettled) return;
    socketSettled = true;
    clearOpenTimer();
    // Tag-by-socket: a delayed close from the OLD socket (after a
    // reconnect/token-swap) would otherwise clobber state.socket
    // (which now points at the NEW socket) and stop heartbeats.
    if (state.socket !== ws) return;
    if (state.pingTimer) clearInterval(state.pingTimer);
    state.pingTimer = null;
    state.socket = null;
    state.token = null;
    state.lastCloseAt = Date.now();
    state.lastCloseCode = code;
    state.lastCloseReason = reason;
    if (code === 4401) {
      // Orchestrator rejected our auth. Surface to the SW so it
      // clears the bad token; do NOT auto-reconnect — that would
      // just loop on the same bad creds.
      fireUnauthorized();
      return;
    }
    if (unauthorizedFired) {
      // Some servers/proxies send a server.error frame before closing
      // with a generic code. Once auth has been rejected, never schedule
      // a network reconnect with the same stale bearer.
      return;
    }
    if (state.closedByUser) return;
    scheduleReconnect(token);
  };
  openTimer = setTimeout(() => {
    if (state.socket !== ws || ws.readyState !== WebSocket.CONNECTING) return;
    state.lastErrorAt = Date.now();
    state.lastCloseReason = 'open timeout';
    console.warn(`[holaday] ws open timed out after ${WS_OPEN_TIMEOUT_MS}ms; reconnecting`);
    try {
      ws.close(4000, 'open timeout');
    } catch {
      /* close may throw on already-closing sockets; close handler handles the rest */
    }
    settleSocketClose(4000, 'open timeout');
  }, WS_OPEN_TIMEOUT_MS);
  openTimer && (openTimer as { unref?: () => void }).unref?.();

  ws.addEventListener('open', () => {
    if (state.socket !== ws) return; // stale event after a token swap
    clearOpenTimer();
    state.reconnectAttempt = 0;
    state.lastOpenAt = Date.now();
    state.lastCloseAt = null;
    state.lastCloseCode = null;
    state.lastCloseReason = null;
    state.lastErrorAt = null;
    state.nextRetryAt = null;
    void persistPreferredWsEndpoint(endpoint);
    // Clear the persistent cap so the next blip starts from 0 again.
    // Fire-and-forget: best-effort, and we don't want to delay 'hello'
    // on a chrome.storage write.
    void persistReconnectAttempts(0);
    // Header path may have been stripped by some proxies; fallback hello.
    send({ type: 'client.hello', token, extensionVersion: chrome.runtime.getManifest().version });

    state.pingTimer = setInterval(() => {
      send({ type: 'client.pong', at: Date.now() });
    }, HEARTBEAT_INTERVAL_MS);
  });

  ws.addEventListener('message', (event) => {
    if (state.socket !== ws) return;
    const result = parseServerMessage(typeof event.data === 'string' ? event.data : '');
    if (!result.success) {
      console.warn('[holaday] bad server frame', result.error);
      return;
    }
    // 4401-equivalent: orchestrator may emit server.error code=UNAUTHORIZED
    // before closing the socket. Surface it as an "unauthorized" event so
    // the SW clears the stale token instead of looping with bad creds.
    if (
      result.data.type === 'server.error' &&
      result.data.code === 'UNAUTHORIZED'
    ) {
      fireUnauthorized();
    }
    for (const fn of state.listeners) {
      try {
        fn(result.data);
      } catch (err) {
        console.warn('[holaday] server message listener failed', err);
      }
    }
  });

  ws.addEventListener('close', (event) => {
    settleSocketClose(event.code, event.reason || null);
  });

  ws.addEventListener('error', () => {
    if (state.socket !== ws) return;
    state.lastErrorAt = Date.now();
    state.lastCloseReason = 'network error';
    // 'close' will fire right after; reconnect handled there.
  });
}

function getCurrentWsEndpoint(): string {
  return ORCHESTRATOR_WS_ENDPOINTS[state.endpointIndex] ?? ORCHESTRATOR_WS;
}

function getNextWsEndpointIndex(): number {
  if (ORCHESTRATOR_WS_ENDPOINTS.length <= 1) return 0;
  return (state.endpointIndex + 1) % ORCHESTRATOR_WS_ENDPOINTS.length;
}

/**
 * Hard cap on consecutive network reconnect attempts. Phase 25 retunes
 * this from 10 → 3 attempts with a tighter 1 / 2 / 4 s backoff schedule.
 *
 * Why the change: the previous cap+backoff (10 attempts, exp to 30 s)
 * looked bounded inside a single SW life, but the count lived in
 * module-scope state which dies whenever Chrome recycles the service
 * worker (every ~30 s of idle in MV3). The keepalive alarm wakes the
 * SW, ensureConnected fires, ws-client loads with a fresh count of 0,
 * and the user effectively sees a never-stopping reconnect every
 * ~30 s for as long as the orchestrator is unreachable.
 *
 * Fix: persist the attempt count to `chrome.storage.local` so the cap
 * survives SW recycles. After 3 consecutive failures the SW stops
 * trying entirely; the user has to open the popup or click its
 * explicit "重试连接" action to nudge it back to life.
 *
 * Layered ON TOP of the auth-failure circuit breaker in
 * background/index.ts. The auth path covers 4401-loop scenarios;
 * THIS cap covers the other tail (orchestrator sleep / network blip /
 * TLS handshake failure) where the close code isn't 4401 so the auth
 * breaker never trips.
 */
const MAX_NETWORK_RECONNECTS = 3;
const BACKOFF_SCHEDULE_MS = [1_000, 2_000, 4_000] as const;
const WS_RECONNECT_KEY = 'holaday.ws.reconnectAttempts';
const WS_PREFERRED_ENDPOINT_KEY = 'holaday.ws.preferredEndpoint';
const WS_STORAGE_TIMEOUT_MS = 1_500;

/**
 * Hydrate `state.reconnectAttempt` from chrome.storage on module load
 * so the cap survives SW recycles. Best-effort — if storage read
 * fails we treat the count as 0 (the usual fail-safe) but the cap
 * still trips after 3 fresh attempts in the new SW.
 */
async function hydrateReconnectAttempts(): Promise<void> {
  const generation = state.socketGeneration;
  try {
    const out = await withDeadline(
      chrome.storage.local.get(WS_RECONNECT_KEY),
      WS_STORAGE_TIMEOUT_MS,
      'ws_reconnect_read_timeout',
    );
    if (state.socketGeneration !== generation || state.socket) return;
    const v = out[WS_RECONNECT_KEY];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
      state.reconnectAttempt = Math.floor(v);
    }
  } catch {
    /* defensive — storage races on SW boot occasionally; ignore */
  }
}

async function persistReconnectAttempts(n: number): Promise<void> {
  try {
    if (n <= 0) {
      await withDeadline(
        chrome.storage.local.remove(WS_RECONNECT_KEY),
        WS_STORAGE_TIMEOUT_MS,
        'ws_reconnect_remove_timeout',
      );
    } else {
      await withDeadline(
        chrome.storage.local.set({ [WS_RECONNECT_KEY]: n }),
        WS_STORAGE_TIMEOUT_MS,
        'ws_reconnect_write_timeout',
      );
    }
  } catch {
    /* see hydrate — non-fatal */
  }
}

async function hydratePreferredWsEndpoint(): Promise<void> {
  try {
    const out = await withDeadline(
      chrome.storage.local.get(WS_PREFERRED_ENDPOINT_KEY),
      WS_STORAGE_TIMEOUT_MS,
      'ws_endpoint_read_timeout',
    );
    const stored = out[WS_PREFERRED_ENDPOINT_KEY];
    if (typeof stored !== 'string') return;
    const index = ORCHESTRATOR_WS_ENDPOINTS.indexOf(stored);
    if (index < 0) {
      await clearPreferredWsEndpoint();
      return;
    }
    if (state.socket) return;
    state.endpointIndex = index;
  } catch {
    /* defensive — endpoint preference is only an optimization */
  }
}

async function clearPreferredWsEndpoint(): Promise<void> {
  try {
    await withDeadline(
      chrome.storage.local.remove(WS_PREFERRED_ENDPOINT_KEY),
      WS_STORAGE_TIMEOUT_MS,
      'ws_endpoint_remove_timeout',
    );
  } catch {
    /* non-fatal; stale endpoint cleanup should never block connect */
  }
}

async function persistPreferredWsEndpoint(endpoint: string): Promise<void> {
  if (!ORCHESTRATOR_WS_ENDPOINTS.includes(endpoint)) return;
  try {
    await withDeadline(
      chrome.storage.local.set({ [WS_PREFERRED_ENDPOINT_KEY]: endpoint }),
      WS_STORAGE_TIMEOUT_MS,
      'ws_endpoint_write_timeout',
    );
  } catch {
    /* non-fatal; the next boot can still use the default order */
  }
}

// Fire-and-forget hydration on module load. Subsequent connect/openSocket
// calls don't wait for it; the in-memory state.reconnectAttempt either
// reflects the persisted count (if hydration finished) or starts at 0
// (if not), and the FIRST scheduleReconnect picks up wherever
// state.reconnectAttempt currently sits.
void hydrateReconnectAttempts();
void hydratePreferredWsEndpoint();

/**
 * Cap-aware reconnect check, exported for the background SW's alarm
 * handler. The alarm runs ensureConnected → connect every ~30 s; if
 * we're already past the cap, calling connect just for the SW to
 * tear it down on close+scheduleReconnect is wasted work. The SW
 * reads this before driving the keepalive path and short-circuits
 * when the cap is hit.
 *
 * Best-effort: storage failures resolve to `false` (assume not capped)
 * so a transient storage glitch doesn't permanently silence the
 * client.
 */
export async function isReconnectCapped(): Promise<boolean> {
  try {
    const out = await withDeadline(
      chrome.storage.local.get(WS_RECONNECT_KEY),
      WS_STORAGE_TIMEOUT_MS,
      'ws_reconnect_cap_read_timeout',
    );
    const v = out[WS_RECONNECT_KEY];
    return typeof v === 'number' && v > MAX_NETWORK_RECONNECTS;
  } catch {
    return false;
  }
}

/**
 * Clear the persistent + in-memory reconnect counter so the next
 * connect attempt starts fresh. Called by:
 *   - Successful open (in-line — the WS handshake just worked)
 *   - Popup mount / "重试连接" via background/index.ts
 *   - chrome.runtime.onStartup (a fresh browser session shouldn't
 *     inherit a stale cap from a previous Chrome instance)
 */
export async function resetWsReconnectAttempts(): Promise<void> {
  clearReconnectTimer();
  state.reconnectAttempt = 0;
  await persistReconnectAttempts(0);
}

function clearReconnectTimer(): void {
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }
  state.nextRetryAt = null;
}

function scheduleReconnect(token: string): void {
  state.reconnectAttempt += 1;
  void persistReconnectAttempts(state.reconnectAttempt);
  if (state.reconnectAttempt > MAX_NETWORK_RECONNECTS) {
    state.nextRetryAt = null;
    console.warn(
      `[holaday] ws: ${MAX_NETWORK_RECONNECTS} reconnects failed, pausing until user action (popup open or 重试连接)`,
    );
    return;
  }
  // attempt 1 → 1s, attempt 2 → 2s, attempt 3 → 4s (last). Past 3
  // we've already returned above, so the cap on the schedule never
  // surfaces, but the Math.min keeps the lookup safe.
  const idx = Math.max(0, Math.min(BACKOFF_SCHEDULE_MS.length - 1, state.reconnectAttempt - 1));
  // BACKOFF_SCHEDULE_MS is a non-empty `as const` tuple; idx is
  // clamped into its bounds above, so the lookup is non-undefined.
  // `?? 4000` is defensive — preserves the worst-case bound if a
  // future edit accidentally narrows the tuple.
  const backoff = BACKOFF_SCHEDULE_MS[idx] ?? 4_000;
  const jitter = Math.floor(Math.random() * 250);
  const delay = backoff + jitter;
  const generation = state.socketGeneration;
  const nextEndpointIndex = getNextWsEndpointIndex();
  clearReconnectTimer();
  state.nextRetryAt = Date.now() + delay;
  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    state.nextRetryAt = null;
    if (state.closedByUser || state.socket || state.socketGeneration !== generation) return;
    state.endpointIndex = nextEndpointIndex;
    openSocket(token);
  }, delay);
}
