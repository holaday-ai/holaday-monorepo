import { HEARTBEAT_INTERVAL_MS, HEARTBEAT_TIMEOUT_MS } from '@holaday/shared-types';
import { describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { sweepHeartbeats } from './heartbeat-sweep.js';

function client(readyState: number = WebSocket.OPEN) {
  return { readyState, ping: vi.fn(), terminate: vi.fn() };
}

describe('sweepHeartbeats', () => {
  it('terminates a silent client after the timeout even though it is pinged every sweep', () => {
    const silent = client();
    const lastPongAt = 0;
    // Before the fix the sweep timed its own pings, so this never terminated.
    for (let now = HEARTBEAT_INTERVAL_MS; now <= HEARTBEAT_TIMEOUT_MS; now += HEARTBEAT_INTERVAL_MS) {
      sweepHeartbeats([silent], () => lastPongAt, now);
    }
    expect(silent.terminate).not.toHaveBeenCalled();
    sweepHeartbeats([silent], () => lastPongAt, HEARTBEAT_TIMEOUT_MS + HEARTBEAT_INTERVAL_MS);
    expect(silent.terminate).toHaveBeenCalledTimes(1);
  });

  it('keeps pinging clients that answer', () => {
    const alive = client();
    const now = 10 * HEARTBEAT_TIMEOUT_MS;
    sweepHeartbeats([alive], () => now - HEARTBEAT_INTERVAL_MS, now);
    expect(alive.ping).toHaveBeenCalledTimes(1);
    expect(alive.terminate).not.toHaveBeenCalled();
  });

  it('skips non-open sockets and pings clients that are still authenticating', () => {
    const closing = client(WebSocket.CLOSING);
    const pending = client();
    sweepHeartbeats([closing, pending], () => undefined, HEARTBEAT_TIMEOUT_MS * 5);
    expect(closing.ping).not.toHaveBeenCalled();
    expect(closing.terminate).not.toHaveBeenCalled();
    expect(pending.ping).toHaveBeenCalledTimes(1);
    expect(pending.terminate).not.toHaveBeenCalled();
  });

  it('survives a ping racing a closed socket', () => {
    const racing = client();
    racing.ping.mockImplementation(() => {
      throw new Error('WebSocket is not open');
    });
    const next = client();
    expect(() => sweepHeartbeats([racing, next], () => 0, 1)).not.toThrow();
    expect(next.ping).toHaveBeenCalledTimes(1);
  });
});
