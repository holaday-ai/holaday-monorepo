import { HEARTBEAT_TIMEOUT_MS } from '@holaday/shared-types';
import { WebSocket } from 'ws';

interface HeartbeatClient {
  readyState: number;
  ping(): void;
  terminate(): void;
}

/**
 * One heartbeat sweep: terminate OPEN clients that have not answered (a
 * protocol pong or an app-level `client.pong`, both of which update
 * `lastPongAt`) within HEARTBEAT_TIMEOUT_MS, ping the rest.
 *
 * The previous sweep measured the time since its OWN last ping, which it
 * refreshed every interval, so the timeout could never fire and half-open
 * extension sockets (laptop sleep, NAT drop) stayed "connected" — tool calls
 * were routed to a dead client until TCP gave up.
 *
 * Clients without a state (still authenticating) are only pinged.
 */
export function sweepHeartbeats<T extends HeartbeatClient>(
  clients: Iterable<T>,
  lastPongAtOf: (client: T) => number | undefined,
  now: number = Date.now(),
  timeoutMs: number = HEARTBEAT_TIMEOUT_MS,
): void {
  for (const client of clients) {
    if (client.readyState !== WebSocket.OPEN) continue;
    const lastPongAt = lastPongAtOf(client);
    if (lastPongAt !== undefined && now - lastPongAt > timeoutMs) {
      client.terminate();
      continue;
    }
    try {
      client.ping();
    } catch {
      /* socket raced closed; the close handler owns cleanup */
    }
  }
}
