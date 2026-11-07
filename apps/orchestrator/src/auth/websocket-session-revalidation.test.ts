import { EventEmitter } from 'node:events';
import { pino } from 'pino';
import { afterEach, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { startWebSocketSessionRevalidation } from './websocket-session-revalidation.js';

const logger = pino({ level: 'silent' });
afterEach(() => vi.useRealTimers());
function socket() {
  const ws = Object.assign(new EventEmitter(), {
    readyState: WebSocket.OPEN as number,
    close: vi.fn(() => {
      ws.readyState = WebSocket.CLOSING;
    }),
    terminate: vi.fn(),
  });
  return ws;
}
it('closes by the 3 second query deadline without waiting for a hung database', async () => {
  vi.useFakeTimers();
  const ws = socket();
  let release!: (ok: boolean) => void;
  const check = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        release = resolve;
      }),
  );
  const stop = startWebSocketSessionRevalidation({
    socket: ws as never,
    expectedUserId: 'usr_test',
    logger,
    revalidateSession: check,
  });
  await vi.advanceTimersByTimeAsync(33_001);
  expect(ws.close).toHaveBeenCalledWith(4401, 'session revoked');
  expect(check).toHaveBeenCalledTimes(1);
  release(true);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(ws.close).toHaveBeenCalledTimes(1);
  stop();
});
it('renews a healthy authorization without closing the connection', async () => {
  vi.useFakeTimers();
  const ws = socket();
  const check = vi.fn(async () => true);
  const stop = startWebSocketSessionRevalidation({
    socket: ws as never,
    expectedUserId: 'usr_test',
    logger,
    revalidateSession: check,
  });
  await vi.advanceTimersByTimeAsync(180_000);
  expect(check.mock.calls.length).toBeGreaterThanOrEqual(5);
  expect(ws.close).not.toHaveBeenCalled();
  stop();
  expect(vi.getTimerCount()).toBe(0);
});
it('caps a configured long check interval at a safe lease interval', async () => {
  vi.useFakeTimers();
  const ws = socket();
  const stop = startWebSocketSessionRevalidation({
    socket: ws as never,
    expectedUserId: 'usr_test',
    logger,
    intervalMs: 120_000,
    revalidateSession: () => new Promise(() => {}),
  });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(ws.close).toHaveBeenCalledWith(4401, 'session revoked');
  stop();
});

it('maintains independent deadlines for a hanging and a healthy socket', async () => {
  vi.useFakeTimers();
  const hung = socket();
  const healthy = socket();
  const stopHung = startWebSocketSessionRevalidation({
    socket: hung as never,
    expectedUserId: 'usr_hung',
    logger,
    revalidateSession: () => new Promise(() => {}),
  });
  const stopHealthy = startWebSocketSessionRevalidation({
    socket: healthy as never,
    expectedUserId: 'usr_healthy',
    logger,
    revalidateSession: async () => true,
  });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(hung.close).toHaveBeenCalledOnce();
  expect(healthy.close).not.toHaveBeenCalled();
  stopHung();
  stopHealthy();
  expect(vi.getTimerCount()).toBe(0);
});
