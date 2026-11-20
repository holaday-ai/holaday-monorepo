import type { Logger } from 'pino';
import { WebSocket } from 'ws';

// A 30s lease plus the session database cache's 30s maximum remains <=60s.
export const SOCKET_AUTHORIZATION_TTL_MS = 30_000;
export const SOCKET_REVALIDATION_TIMEOUT_MS = 3_000;
const CHECK_INTERVAL_MS = 15_000;
interface WebSocketSessionRevalidationOptions {
  socket: WebSocket;
  expectedUserId: string;
  revalidateSession: () => Promise<boolean>;
  logger: Logger;
  intervalMs?: number;
}

export function startWebSocketSessionRevalidation(
  opts: WebSocketSessionRevalidationOptions,
): () => void {
  let stopped = false;
  let inFlight = false;
  let deadline = Date.now() + SOCKET_AUTHORIZATION_TTL_MS;
  let expiry: NodeJS.Timeout;
  let queryTimeout: NodeJS.Timeout | undefined;
  let forceClose: NodeJS.Timeout | undefined;
  const intervalMs = Math.max(1, Math.min(opts.intervalMs ?? CHECK_INTERVAL_MS, CHECK_INTERVAL_MS));
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  armExpiry();
  opts.socket.once('close', onClose);

  function armExpiry(): void {
    clearTimeout(expiry);
    expiry = setTimeout(revoke, Math.max(0, deadline - Date.now()));
    expiry.unref();
  }
  function revoke(): void {
    if (stopped) return;
    stop();
    if (opts.socket.readyState !== WebSocket.OPEN) return;
    opts.logger.warn({ userId: opts.expectedUserId }, 'websocket session revoked');
    opts.socket.close(4401, 'session revoked');
    // A peer that refuses the close handshake must not retain a live transport.
    forceClose = setTimeout(() => opts.socket.terminate(), 1_000);
    forceClose.unref();
    opts.socket.once('close', onClose);
  }
  function tick(): void {
    if (stopped || opts.socket.readyState !== WebSocket.OPEN) {
      stop();
      return;
    }
    if (Date.now() >= deadline) {
      revoke();
      return;
    }
    if (inFlight) return;
    inFlight = true;
    const started = Date.now();
    queryTimeout = setTimeout(revoke, SOCKET_REVALIDATION_TIMEOUT_MS);
    queryTimeout.unref();
    // The original query keeps its normal ownership/cleanup. Timing out closes
    // authorization independently; late resolution cannot resurrect this lease.
    void Promise.resolve()
      .then(opts.revalidateSession)
      .then(
        (valid) => {
          if (stopped) return;
          if (
            !valid ||
            Date.now() >= deadline ||
            Date.now() - started >= SOCKET_REVALIDATION_TIMEOUT_MS
          ) {
            revoke();
            return;
          }
          deadline = started + SOCKET_AUTHORIZATION_TTL_MS;
          armExpiry();
        },
        () => revoke(),
      )
      .finally(() => {
        clearTimeout(queryTimeout);
        inFlight = false;
      });
  }
  function onClose(): void {
    clearTimeout(forceClose);
    stop();
  }
  function stop(): void {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    clearTimeout(expiry);
    clearTimeout(queryTimeout);
    opts.socket.off('close', onClose);
  }
  return stop;
}
