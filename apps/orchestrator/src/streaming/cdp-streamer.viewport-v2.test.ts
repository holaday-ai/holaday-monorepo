import { EventEmitter } from 'node:events';
import type { Logger } from 'pino';
import type { CDPSession, Page } from 'playwright';
import { expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import { CdpStreamer } from './cdp-streamer.js';

it('rebinds the CDP session when the current Page changes even at the same URL', async () => {
  vi.useFakeTimers();
  let streamer: CdpStreamer | undefined;
  try {
    const session = () =>
      Object.assign(new EventEmitter(), {
        send: vi.fn(async (method: string) =>
          method === 'Runtime.evaluate'
            ? { result: { value: 'https://same.example/' } }
            : undefined,
        ),
        detach: vi.fn(async () => {}),
      }) as unknown as CDPSession;
    const firstSession = session();
    const secondSession = session();
    const firstAttach = vi.fn(async () => firstSession);
    const secondAttach = vi.fn(async () => secondSession);
    const page = (newCDPSession: typeof firstAttach) =>
      ({
        context: () => ({ newCDPSession }),
        url: () => 'https://same.example/',
        isClosed: () => false,
      }) as unknown as Page;
    const firstPage = page(firstAttach);
    const secondPage = page(secondAttach);
    let currentPage = firstPage;
    streamer = new CdpStreamer({
      getPage: async () => currentPage,
      ws: { send: vi.fn() } as unknown as WebSocket,
      logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() } as unknown as Logger,
      viewportV2: true,
    });
    await streamer.start();
    expect(streamer.matchesPage(firstPage)).toBe(true);
    (firstSession as unknown as EventEmitter).emit('Page.screencastFrame', {
      data: 'fixture',
      metadata: {},
      sessionId: 1,
    });
    currentPage = secondPage;
    expect(streamer.matchesPage(secondPage)).toBe(false);
    await vi.advanceTimersByTimeAsync(6100);
    expect(firstSession.detach).toHaveBeenCalled();
    expect(secondAttach).toHaveBeenCalledTimes(1);
    expect(streamer.matchesPage(firstPage)).toBe(false);
    expect(streamer.matchesPage(secondPage)).toBe(true);
  } finally {
    await streamer?.stop();
    vi.useRealTimers();
  }
});
