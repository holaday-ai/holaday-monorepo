import {
  type ClientMessage,
  HEARTBEAT_INTERVAL_MS,
  type ServerMessage,
  WS_SUBPROTOCOL,
  parseServerMessage,
} from '@holaday/shared-types';
import { ORCHESTRATOR_WS } from '../shared/config.js';

type Listener = (msg: ServerMessage) => void;
type UnauthorizedListener = () => void;

interface State {
  socket: WebSocket | null;
  reconnectAttempt: number;
  pingTimer: ReturnType<typeof setInterval> | null;
  closedByUser: boolean;
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
  reconnectAttempt: 0,
  pingTimer: null,
  closedByUser: false,
  listeners: new Set(),
  unauthorizedListeners: new Set(),
};

export function onServerMessage(fn: Listener): () => void {
  state.listeners.add(fn);
  return () => state.listeners.delete(fn);
}

export function onUnauthorized(fn: UnauthorizedListener): () => void {
  state.unauthorizedListeners.add(fn);
  return () => state.unauthorizedListeners.delete(fn);
}

export function send(msg: ClientMessage): boolean {
  if (state.socket?.readyState !== WebSocket.OPEN) return false;
  try {
    state.socket.send(JSON.stringify(msg));
    return true;
  } catch (err) {
    console.warn('[holaday] ws send failed', err);
    return false;
  }
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
  if (state.socket) {
    state.closedByUser = true;
    try {
      state.socket.close(1000, 'token swap');
    } catch {
      /* socket may already be closing */
    }
    state.socket = null;
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

function openSocket(token: string): void {
  const protocols = [WS_SUBPROTOCOL, `jwt.${token}`];
  const ws = new WebSocket(ORCHESTRATOR_WS, protocols);
  state.socket = ws;
  // Phase 14 — server may signal UNAUTHORIZED via BOTH a server.error
  // frame AND a 4401 close. Fire the listeners only once per socket,
  // otherwise the SW's auth-failure counter doubles and we hit the
  // freeze threshold with one real failure.
  let unauthorizedFired = false;
  const fireUnauthorized = (): void => {
    if (unauthorizedFired) return;
    unauthorizedFired = true;
    for (const fn of state.unauthorizedListeners) fn();
  };

  ws.addEventListener('open', () => {
    if (state.socket !== ws) return; // stale event after a token swap
    state.reconnectAttempt = 0;
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
    for (const fn of state.listeners) fn(result.data);
  });

  ws.addEventListener('close', (event) => {
    // Tag-by-socket: a delayed close from the OLD socket (after a
    // reconnect/token-swap) would otherwise clobber state.socket
    // (which now points at the NEW socket) and stop heartbeats.
    if (state.socket !== ws) return;
    if (state.pingTimer) clearInterval(state.pingTimer);
    state.pingTimer = null;
    state.socket = null;
    if (event.code === 4401) {
      // Orchestrator rejected our auth. Surface to the SW so it
      // clears the bad token; do NOT auto-reconnect — that would
      // just loop on the same bad creds.
      fireUnauthorized();
      return;
    }
    if (state.closedByUser) return;
    scheduleReconnect(token);
  });

  ws.addEventListener('error', () => {
    // 'close' will fire right after; reconnect handled there.
  });
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
 * trying entirely; the user has to either open the popup (which
 * clears the counter via `resetWsReconnectAttempts`) or wait for an
 * explicit "重置连接" action to nudge it back to life.
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

/**
 * Hydrate `state.reconnectAttempt` from chrome.storage on module load
 * so the cap survives SW recycles. Best-effort — if storage read
 * fails we treat the count as 0 (the usual fail-safe) but the cap
 * still trips after 3 fresh attempts in the new SW.
 */
async function hydrateReconnectAttempts(): Promise<void> {
  try {
    const v = (await chrome.storage.local.get(WS_RECONNECT_KEY))[WS_RECONNECT_KEY];
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
      await chrome.storage.local.remove(WS_RECONNECT_KEY);
    } else {
      await chrome.storage.local.set({ [WS_RECONNECT_KEY]: n });
    }
  } catch {
    /* see hydrate — non-fatal */
  }
}

// Fire-and-forget hydration on module load. Subsequent connect/openSocket
// calls don't wait for it; the in-memory state.reconnectAttempt either
// reflects the persisted count (if hydration finished) or starts at 0
// (if not), and the FIRST scheduleReconnect picks up wherever
// state.reconnectAttempt currently sits.
void hydrateReconnectAttempts();

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
    const v = (await chrome.storage.local.get(WS_RECONNECT_KEY))[WS_RECONNECT_KEY];
    return typeof v === 'number' && v >= MAX_NETWORK_RECONNECTS;
  } catch {
    return false;
  }
}

/**
 * Clear the persistent + in-memory reconnect counter so the next
 * connect attempt starts fresh. Called by:
 *   - Successful open (in-line — the WS handshake just worked)
 *   - The popup "重置连接" / "重试" buttons via background/index.ts
 *   - chrome.runtime.onStartup (a fresh browser session shouldn't
 *     inherit a stale cap from a previous Chrome instance)
 */
export async function resetWsReconnectAttempts(): Promise<void> {
  state.reconnectAttempt = 0;
  await persistReconnectAttempts(0);
}

function scheduleReconnect(token: string): void {
  state.reconnectAttempt += 1;
  void persistReconnectAttempts(state.reconnectAttempt);
  if (state.reconnectAttempt > MAX_NETWORK_RECONNECTS) {
    console.warn(
      `[holaday] ws: ${MAX_NETWORK_RECONNECTS} reconnects failed, pausing until user action (popup open or 重置连接)`,
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
  setTimeout(() => {
    if (!state.closedByUser) openSocket(token);
  }, backoff + jitter);
}
