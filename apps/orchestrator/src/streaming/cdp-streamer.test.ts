import { EventEmitter } from 'node:events';
import type { CDPSession, Page } from 'playwright';
import type { Logger } from 'pino';
import type { WebSocket } from 'ws';
import { describe, expect, it, vi } from 'vitest';
import { CdpStreamer } from './cdp-streamer.js';

describe('CdpStreamer', () => {
  it('keeps enough frame resolution for a resized workbench', async () => {
    const session = Object.assign(new EventEmitter(), {
      send: vi.fn().mockResolvedValue(undefined),
      detach: vi.fn().mockResolvedValue(undefined),
    }) as unknown as CDPSession;
    const page = {
      context: () => ({
        newCDPSession: vi.fn().mockResolvedValue(session),
      }),
      url: () => 'https://example.com/',
    } as unknown as Page;
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logger;
    const ws = { send: vi.fn() } as unknown as WebSocket;
    const streamer = new CdpStreamer({
      getPage: async () => page,
      ws,
      logger,
    });

    await streamer.start();
    expect(session.send).toHaveBeenCalledWith('Page.startScreencast', {
      format: 'jpeg',
      quality: 60,
      maxWidth: 1440,
      maxHeight: 1200,
      everyNthFrame: 1,
    });
    await streamer.stop();
  });

  it('does not hard-restart a healthy static page just because no pixels changed', async () => {
    vi.useFakeTimers();
    try {
      const send = vi.fn().mockImplementation(async (method: string) => {
        if (method === 'Runtime.evaluate') {
          return { result: { value: 'https://example.com/' } };
        }
        return undefined;
      });
      const session = Object.assign(new EventEmitter(), {
        send,
        detach: vi.fn().mockResolvedValue(undefined),
      }) as unknown as CDPSession;
      const newCDPSession = vi.fn().mockResolvedValue(session);
      const page = {
        context: () => ({ newCDPSession }),
        url: () => 'https://example.com/',
      } as unknown as Page;
      const logger = {
        info: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      } as unknown as Logger;
      const streamer = new CdpStreamer({
        getPage: async () => page,
        ws: { send: vi.fn() } as unknown as WebSocket,
        logger,
      });

      await streamer.start();
      await vi.advanceTimersByTimeAsync(6_100);

      expect(newCDPSession).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledWith('Runtime.evaluate', {
        expression: 'window.location.href',
        returnByValue: true,
      });
      await streamer.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('requests the live viewport again after top-level navigation', async () => {
    const sessionEvents = new EventEmitter();
    const session = Object.assign(sessionEvents, {
      send: vi.fn().mockResolvedValue(undefined),
      detach: vi.fn().mockResolvedValue(undefined),
    }) as unknown as CDPSession;
    const page = {
      context: () => ({
        newCDPSession: vi.fn().mockResolvedValue(session),
      }),
      url: () => 'https://example.org/',
    } as unknown as Page;
    const reapplyViewport = vi.fn().mockResolvedValue(undefined);
    const streamer = new CdpStreamer({
      getPage: async () => page,
      ws: { send: vi.fn() } as unknown as WebSocket,
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      } as unknown as Logger,
      onViewportMayReset: reapplyViewport,
    });

    await streamer.start();
    sessionEvents.emit('Page.frameNavigated', {
      frame: { id: 'main', url: 'https://example.org/' },
    });
    await vi.waitFor(() => expect(reapplyViewport).toHaveBeenCalledOnce());

    await streamer.stop();
  });
});
