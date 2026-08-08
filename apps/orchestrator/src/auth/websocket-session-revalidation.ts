import { HEARTBEAT_INTERVAL_MS } from '@holaday/shared-types';
import type { Logger } from 'pino';
import { WebSocket } from 'ws';

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

  const timer = setInterval(() => {
    if (stopped || opts.socket.readyState !== WebSocket.OPEN) {
      stop();
      return;
    }
    if (inFlight) return;
    inFlight = true;
    void revalidate().finally(() => {
      inFlight = false;
    });
  }, opts.intervalMs ?? HEARTBEAT_INTERVAL_MS);
  timer.unref();

  const onClose = (): void => stop();
  opts.socket.once('close', onClose);

  async function revalidate(): Promise<void> {
    let sessionIsValid = false;
    try {
      sessionIsValid = await opts.revalidateSession();
    } catch (err) {
      opts.logger.warn(
        {
          err: err instanceof Error ? err.message : String(err),
          userId: opts.expectedUserId,
        },
        'websocket session revalidation failed closed',
      );
    }

    if (stopped || opts.socket.readyState !== WebSocket.OPEN || sessionIsValid) {
      return;
    }
    opts.logger.warn({ userId: opts.expectedUserId }, 'websocket session revoked');
    opts.socket.close(4401, 'session revoked');
  }

  function stop(): void {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    opts.socket.off('close', onClose);
  }

  return stop;
}
