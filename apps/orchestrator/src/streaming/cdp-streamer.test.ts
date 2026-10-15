import { EventEmitter } from 'node:events';
import type { Logger } from 'pino';
import type { CDPSession, Page } from 'playwright';
import { describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
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

  it('logs only the origin of the page it streams, never its path or query', async () => {
    const session = Object.assign(new EventEmitter(), {
      send: vi.fn().mockResolvedValue(undefined),
      detach: vi.fn().mockResolvedValue(undefined),
    }) as unknown as CDPSession;
    const page = {
      context: () => ({ newCDPSession: vi.fn().mockResolvedValue(session) }),
      url: () => 'https://shop.example.com/account/orders?token=secret-token#x',
    } as unknown as Page;
    const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn() } as unknown as Logger;
    const streamer = new CdpStreamer({
      getPage: async () => page,
      ws: { send: vi.fn() } as unknown as WebSocket,
      logger,
    });
    await streamer.start();
    (session as unknown as EventEmitter).emit('Page.frameNavigated', {
      frame: { id: 'main', url: 'https://shop.example.com/account/orders?token=secret-token#x' },
    });
    await vi.waitFor(() =>
      expect(
        vi
          .mocked(logger.info)
          .mock.calls.some((call) => /frame-navigated/.test(JSON.stringify(call))),
      ).toBe(true),
    );
    await streamer.stop();
    const logged = JSON.stringify([
      vi.mocked(logger.info).mock.calls,
      vi.mocked(logger.warn).mock.calls,
      vi.mocked(logger.debug).mock.calls,
    ]);
    expect(logged).toContain('https://shop.example.com/');
    expect(logged).not.toContain('secret-token');
    expect(logged).not.toContain('/account/orders');
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
      const sessionEvents = new EventEmitter();
      const session = Object.assign(sessionEvents, {
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
      sessionEvents.emit('Page.screencastFrame', {
        data: 'first-frame',
        metadata: {},
        sessionId: 1,
      });
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

  it('restarts a healthy CDP session when its initial frame never arrives', async () => {
    vi.useFakeTimers();
    try {
      const firstSession = Object.assign(new EventEmitter(), {
        send: vi.fn().mockImplementation(async (method: string) => {
          if (method === 'Runtime.evaluate') {
            return { result: { value: 'https://example.com/' } };
          }
          return undefined;
        }),
        detach: vi.fn().mockResolvedValue(undefined),
      }) as unknown as CDPSession;
      const secondSession = Object.assign(new EventEmitter(), {
        send: vi.fn().mockResolvedValue(undefined),
        detach: vi.fn().mockResolvedValue(undefined),
      }) as unknown as CDPSession;
      const newCDPSession = vi
        .fn()
        .mockResolvedValueOnce(firstSession)
        .mockResolvedValueOnce(secondSession);
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

      expect(newCDPSession).toHaveBeenCalledTimes(2);
      expect(firstSession.send).toHaveBeenCalledWith('Page.stopScreencast');
      expect(secondSession.send).toHaveBeenCalledWith('Page.startScreencast', {
        format: 'jpeg',
        quality: 60,
        maxWidth: 1440,
        maxHeight: 1200,
        everyNthFrame: 1,
      });
      await streamer.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('publishes a current-page capture when the natural initial frame is late', async () => {
    vi.useFakeTimers();
    try {
      const send = vi.fn().mockImplementation(async (method: string) => {
        if (method === 'Page.captureScreenshot') {
          return { data: 'captured-current-page' };
        }
        return undefined;
      });
      const sessionEvents = new EventEmitter();
      const session = Object.assign(sessionEvents, {
        send,
        detach: vi.fn().mockResolvedValue(undefined),
      }) as unknown as CDPSession;
      const newCDPSession = vi.fn().mockResolvedValue(session);
      const ws = { send: vi.fn() } as unknown as WebSocket;
      const streamer = new CdpStreamer({
        getPage: async () =>
          ({
            context: () => ({ newCDPSession }),
            url: () => 'https://example.com/',
          }) as unknown as Page,
        ws,
        logger: {
          info: vi.fn(),
          warn: vi.fn(),
          debug: vi.fn(),
        } as unknown as Logger,
      });

      await streamer.start();
      await vi.advanceTimersByTimeAsync(1_500);

      expect(send).toHaveBeenCalledWith('Page.captureScreenshot', {
        format: 'jpeg',
        quality: 60,
        fromSurface: true,
        captureBeyondViewport: false,
      });
      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'frame',
          data: 'captured-current-page',
          metadata: {},
        }),
      );
      expect(newCDPSession).toHaveBeenCalledTimes(1);
      await streamer.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('refreshes the visible page after input when the screencast emits no update', async () => {
    vi.useFakeTimers();
    try {
      const send = vi.fn().mockImplementation(async (method: string) => {
        if (method === 'Page.captureScreenshot') {
          return { data: 'post-input-page' };
        }
        return undefined;
      });
      const sessionEvents = new EventEmitter();
      const session = Object.assign(sessionEvents, {
        send,
        detach: vi.fn().mockResolvedValue(undefined),
      }) as unknown as CDPSession;
      const ws = { send: vi.fn() } as unknown as WebSocket;
      const streamer = new CdpStreamer({
        getPage: async () =>
          ({
            context: () => ({
              newCDPSession: vi.fn().mockResolvedValue(session),
            }),
            url: () => 'https://example.com/',
          }) as unknown as Page,
        ws,
        logger: {
          info: vi.fn(),
          warn: vi.fn(),
          debug: vi.fn(),
        } as unknown as Logger,
      });

      await streamer.start();
      sessionEvents.emit('Page.screencastFrame', {
        data: 'natural-frame',
        metadata: {},
        sessionId: 1,
      });
      ws.send = vi.fn();

      streamer.requestFrameRefresh();
      await vi.advanceTimersByTimeAsync(250);

      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'frame',
          data: 'post-input-page',
          metadata: {},
        }),
      );
      await streamer.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not let a late fallback capture overwrite a newer natural frame', async () => {
    vi.useFakeTimers();
    try {
      let resolveCapture!: (value: { data: string }) => void;
      const capture = new Promise<{ data: string }>((resolve) => {
        resolveCapture = resolve;
      });
      const send = vi.fn().mockImplementation(async (method: string) => {
        if (method === 'Page.captureScreenshot') return capture;
        return undefined;
      });
      const sessionEvents = new EventEmitter();
      const session = Object.assign(sessionEvents, {
        send,
        detach: vi.fn().mockResolvedValue(undefined),
      }) as unknown as CDPSession;
      const ws = { send: vi.fn() } as unknown as WebSocket;
      const streamer = new CdpStreamer({
        getPage: async () =>
          ({
            context: () => ({
              newCDPSession: vi.fn().mockResolvedValue(session),
            }),
            url: () => 'https://example.com/',
          }) as unknown as Page,
        ws,
        logger: {
          info: vi.fn(),
          warn: vi.fn(),
          debug: vi.fn(),
        } as unknown as Logger,
      });

      await streamer.start();
      sessionEvents.emit('Page.screencastFrame', {
        data: 'initial-frame',
        metadata: {},
        sessionId: 1,
      });
      ws.send = vi.fn();
      streamer.requestFrameRefresh();
      await vi.advanceTimersByTimeAsync(200);
      sessionEvents.emit('Page.screencastFrame', {
        data: 'newer-natural-frame',
        metadata: {},
        sessionId: 2,
      });
      resolveCapture({ data: 'stale-capture' });
      await vi.runAllTicks();

      const sentFrames = vi
        .mocked(ws.send)
        .mock.calls.map(
          ([payload]) => JSON.parse(String(payload)) as { type: string; data?: string },
        );
      expect(sentFrames).toContainEqual({
        type: 'frame',
        data: 'newer-natural-frame',
        metadata: {},
      });
      expect(sentFrames.some((frame) => frame.data === 'stale-capture')).toBe(false);
      await streamer.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not publish a fallback capture from the page before navigation', async () => {
    vi.useFakeTimers();
    try {
      let resolveCapture!: (value: { data: string }) => void;
      const capture = new Promise<{ data: string }>((resolve) => {
        resolveCapture = resolve;
      });
      const send = vi.fn().mockImplementation((method: string) => {
        if (method === 'Page.captureScreenshot') return capture;
        return Promise.resolve(undefined);
      });
      const sessionEvents = new EventEmitter();
      const session = Object.assign(sessionEvents, {
        send,
        detach: vi.fn().mockResolvedValue(undefined),
      }) as unknown as CDPSession;
      const ws = { send: vi.fn() } as unknown as WebSocket;
      const streamer = new CdpStreamer({
        getPage: async () =>
          ({
            context: () => ({
              newCDPSession: vi.fn().mockResolvedValue(session),
            }),
            url: () => 'https://example.com/next',
          }) as unknown as Page,
        ws,
        logger: {
          info: vi.fn(),
          warn: vi.fn(),
          debug: vi.fn(),
        } as unknown as Logger,
      });

      await streamer.start();
      sessionEvents.emit('Page.screencastFrame', {
        data: 'initial-frame',
        metadata: {},
        sessionId: 1,
      });
      ws.send = vi.fn();
      streamer.requestFrameRefresh();
      await vi.advanceTimersByTimeAsync(200);
      sessionEvents.emit('Page.frameNavigated', {
        frame: { id: 'main', url: 'https://example.com/next' },
      });
      resolveCapture({ data: 'previous-page-capture' });
      await vi.runAllTicks();

      const sentFrames = vi
        .mocked(ws.send)
        .mock.calls.map(
          ([payload]) => JSON.parse(String(payload)) as { type: string; data?: string },
        );
      expect(sentFrames.some((frame) => frame.data === 'previous-page-capture')).toBe(false);
      await streamer.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps fallback captures single-flight and lets the latest request win', async () => {
    vi.useFakeTimers();
    try {
      let resolveFirstCapture!: (value: { data: string }) => void;
      const firstCapture = new Promise<{ data: string }>((resolve) => {
        resolveFirstCapture = resolve;
      });
      let captureCalls = 0;
      const send = vi.fn().mockImplementation((method: string) => {
        if (method === 'Page.captureScreenshot') {
          captureCalls += 1;
          return captureCalls === 1 ? firstCapture : Promise.resolve({ data: 'latest-capture' });
        }
        return Promise.resolve(undefined);
      });
      const sessionEvents = new EventEmitter();
      const session = Object.assign(sessionEvents, {
        send,
        detach: vi.fn().mockResolvedValue(undefined),
      }) as unknown as CDPSession;
      const ws = { send: vi.fn() } as unknown as WebSocket;
      const streamer = new CdpStreamer({
        getPage: async () =>
          ({
            context: () => ({
              newCDPSession: vi.fn().mockResolvedValue(session),
            }),
            url: () => 'https://example.com/',
          }) as unknown as Page,
        ws,
        logger: {
          info: vi.fn(),
          warn: vi.fn(),
          debug: vi.fn(),
        } as unknown as Logger,
      });

      await streamer.start();
      sessionEvents.emit('Page.screencastFrame', {
        data: 'initial-frame',
        metadata: {},
        sessionId: 1,
      });
      ws.send = vi.fn();
      streamer.requestFrameRefresh();
      await vi.advanceTimersByTimeAsync(200);
      streamer.requestFrameRefresh();
      await vi.advanceTimersByTimeAsync(200);

      expect(
        send.mock.calls.filter(([method]) => method === 'Page.captureScreenshot'),
      ).toHaveLength(1);
      resolveFirstCapture({ data: 'first-capture' });
      await vi.runAllTicks();
      await vi.waitFor(() => {
        expect(
          send.mock.calls.filter(([method]) => method === 'Page.captureScreenshot'),
        ).toHaveLength(2);
      });
      const sentFrames = vi
        .mocked(ws.send)
        .mock.calls.map(
          ([payload]) => JSON.parse(String(payload)) as { type: string; data?: string },
        );
      expect(sentFrames.some((frame) => frame.data === 'first-capture')).toBe(false);
      expect(sentFrames.some((frame) => frame.data === 'latest-capture')).toBe(true);
      await streamer.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('drains the latest fallback capture after an earlier capture times out', async () => {
    vi.useFakeTimers();
    try {
      const neverSettles = new Promise<never>(() => undefined);
      let captureCalls = 0;
      const send = vi.fn().mockImplementation((method: string) => {
        if (method === 'Page.captureScreenshot') {
          captureCalls += 1;
          return captureCalls === 1
            ? neverSettles
            : Promise.resolve({ data: 'capture-after-timeout' });
        }
        return Promise.resolve(undefined);
      });
      const sessionEvents = new EventEmitter();
      const session = Object.assign(sessionEvents, {
        send,
        detach: vi.fn().mockResolvedValue(undefined),
      }) as unknown as CDPSession;
      const ws = { send: vi.fn() } as unknown as WebSocket;
      const streamer = new CdpStreamer({
        getPage: async () =>
          ({
            context: () => ({
              newCDPSession: vi.fn().mockResolvedValue(session),
            }),
            url: () => 'https://example.com/',
          }) as unknown as Page,
        ws,
        logger: {
          info: vi.fn(),
          warn: vi.fn(),
          debug: vi.fn(),
        } as unknown as Logger,
      });

      await streamer.start();
      sessionEvents.emit('Page.screencastFrame', {
        data: 'initial-frame',
        metadata: {},
        sessionId: 1,
      });
      ws.send = vi.fn();
      streamer.requestFrameRefresh();
      await vi.advanceTimersByTimeAsync(200);
      streamer.requestFrameRefresh();
      await vi.advanceTimersByTimeAsync(2_700);

      expect(
        send.mock.calls.filter(([method]) => method === 'Page.captureScreenshot'),
      ).toHaveLength(2);
      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'frame',
          data: 'capture-after-timeout',
          metadata: {},
        }),
      );
      await streamer.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores late frames from a CDP session that has already been replaced', async () => {
    vi.useFakeTimers();
    try {
      const firstSessionEvents = new EventEmitter();
      const firstSession = Object.assign(firstSessionEvents, {
        send: vi.fn().mockResolvedValue(undefined),
        detach: vi.fn().mockResolvedValue(undefined),
      }) as unknown as CDPSession;
      const secondSession = Object.assign(new EventEmitter(), {
        send: vi.fn().mockResolvedValue(undefined),
        detach: vi.fn().mockResolvedValue(undefined),
      }) as unknown as CDPSession;
      const newCDPSession = vi
        .fn()
        .mockResolvedValueOnce(firstSession)
        .mockResolvedValueOnce(secondSession);
      const ws = { send: vi.fn() } as unknown as WebSocket;
      const streamer = new CdpStreamer({
        getPage: async () =>
          ({
            context: () => ({ newCDPSession }),
            url: () => 'https://example.com/',
          }) as unknown as Page,
        ws,
        logger: {
          info: vi.fn(),
          warn: vi.fn(),
          debug: vi.fn(),
        } as unknown as Logger,
      });

      await streamer.start();
      await vi.advanceTimersByTimeAsync(6_100);
      ws.send = vi.fn();
      firstSessionEvents.emit('Page.screencastFrame', {
        data: 'stale-session-frame',
        metadata: {},
        sessionId: 9,
      });

      expect(ws.send).not.toHaveBeenCalled();
      await streamer.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not overlap watchdog health checks while one is still pending', async () => {
    vi.useFakeTimers();
    try {
      let resolveHealthCheck!: (value: { result: { value: string } }) => void;
      const healthCheck = new Promise<{ result: { value: string } }>((resolve) => {
        resolveHealthCheck = resolve;
      });
      const send = vi.fn().mockImplementation((method: string) => {
        if (method === 'Runtime.evaluate') return healthCheck;
        return Promise.resolve(undefined);
      });
      const sessionEvents = new EventEmitter();
      const session = Object.assign(sessionEvents, {
        send,
        detach: vi.fn().mockResolvedValue(undefined),
      }) as unknown as CDPSession;
      const streamer = new CdpStreamer({
        getPage: async () =>
          ({
            context: () => ({
              newCDPSession: vi.fn().mockResolvedValue(session),
            }),
            url: () => 'https://example.com/',
          }) as unknown as Page,
        ws: { send: vi.fn() } as unknown as WebSocket,
        logger: {
          info: vi.fn(),
          warn: vi.fn(),
          debug: vi.fn(),
        } as unknown as Logger,
      });

      await streamer.start();
      sessionEvents.emit('Page.screencastFrame', {
        data: 'initial-frame',
        metadata: {},
        sessionId: 1,
      });
      await vi.advanceTimersByTimeAsync(6_200);

      expect(send.mock.calls.filter(([method]) => method === 'Runtime.evaluate')).toHaveLength(1);
      resolveHealthCheck({ result: { value: 'https://example.com/' } });
      await vi.runAllTicks();
      await streamer.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a natural frame that arrives before a re-arm command resolves', async () => {
    vi.useFakeTimers();
    try {
      let resolveRearm!: () => void;
      const rearm = new Promise<void>((resolve) => {
        resolveRearm = resolve;
      });
      let startCalls = 0;
      const send = vi.fn().mockImplementation((method: string) => {
        if (method === 'Page.startScreencast') {
          startCalls += 1;
          return startCalls === 1 ? Promise.resolve(undefined) : rearm;
        }
        if (method === 'Page.captureScreenshot') {
          return Promise.resolve({ data: 'unnecessary-fallback' });
        }
        return Promise.resolve(undefined);
      });
      const sessionEvents = new EventEmitter();
      const session = Object.assign(sessionEvents, {
        send,
        detach: vi.fn().mockResolvedValue(undefined),
      }) as unknown as CDPSession;
      const streamer = new CdpStreamer({
        getPage: async () =>
          ({
            context: () => ({
              newCDPSession: vi.fn().mockResolvedValue(session),
            }),
            url: () => 'https://example.com/next',
          }) as unknown as Page,
        ws: { send: vi.fn() } as unknown as WebSocket,
        logger: {
          info: vi.fn(),
          warn: vi.fn(),
          debug: vi.fn(),
        } as unknown as Logger,
      });

      await streamer.start();
      sessionEvents.emit('Page.screencastFrame', {
        data: 'initial-frame',
        metadata: {},
        sessionId: 1,
      });
      sessionEvents.emit('Page.frameNavigated', {
        frame: { id: 'main', url: 'https://example.com/next' },
      });
      sessionEvents.emit('Page.screencastFrame', {
        data: 'frame-during-rearm',
        metadata: {},
        sessionId: 2,
      });
      resolveRearm();
      await vi.runAllTicks();
      await vi.advanceTimersByTimeAsync(1_500);

      expect(
        send.mock.calls.filter(([method]) => method === 'Page.captureScreenshot'),
      ).toHaveLength(0);
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

it('V2 publishes the already-open URL and refreshes static pixels before input expires', async () => {
  vi.useFakeTimers();
  const send = vi.fn(async (method: string) =>
    method === 'Page.captureScreenshot' ? { data: 'fixture' } : undefined,
  );
  const session = Object.assign(new EventEmitter(), {
    send,
    detach: vi.fn(),
  }) as unknown as CDPSession;
  const ws = { send: vi.fn() } as unknown as WebSocket;
  const streamer = new CdpStreamer({
    viewportV2: true,
    ws,
    logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() } as unknown as Logger,
    getPage: async () =>
      ({
        url: () => 'https://example.com/already-open',
        context: () => ({ newCDPSession: async () => session }),
      }) as unknown as Page,
  });
  try {
    await streamer.start();
    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'url-changed', url: 'https://example.com/already-open' }),
    );
    expect(send).toHaveBeenCalledWith('Page.startScreencast', {
      format: 'jpeg',
      quality: 90,
      everyNthFrame: 1,
    });
    (session as unknown as EventEmitter).emit('Page.screencastFrame', {
      data: 'fixture',
      metadata: {},
      sessionId: 1,
    });
    await vi.advanceTimersByTimeAsync(2100);
    expect(send).toHaveBeenCalledWith('Page.captureScreenshot', expect.any(Object));
  } finally {
    await streamer.stop();
    vi.useRealTimers();
  }
});

it('uses CSS layout units when Retina screencast metadata contains physical pixels', async () => {
  const sharp = (await import('sharp')).default;
  const data = (
    await sharp({ create: { width: 800, height: 600, channels: 3, background: 'white' } })
      .jpeg()
      .toBuffer()
  ).toString('base64');
  const send = vi.fn(async (method: string) =>
    method === 'Page.getLayoutMetrics'
      ? { cssLayoutViewport: { clientWidth: 400, clientHeight: 300 } }
      : method === 'Page.captureScreenshot'
        ? { data }
        : undefined,
  );
  const session = Object.assign(new EventEmitter(), {
    send,
    detach: vi.fn(),
  }) as unknown as CDPSession;
  const onFrame = vi.fn();
  const streamer = new CdpStreamer({
    viewportV2: true,
    onFrame,
    ws: { send: vi.fn() } as unknown as WebSocket,
    logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() } as unknown as Logger,
    getPage: async () =>
      ({
        url: () => 'https://example.com',
        context: () => ({ newCDPSession: async () => session }),
      }) as unknown as Page,
  });
  try {
    await streamer.start();
    streamer.setCaptureScale(2);
    (session as unknown as EventEmitter).emit('Page.screencastFrame', {
      data,
      metadata: { deviceWidth: 800, deviceHeight: 600, pageScaleFactor: 1 },
      sessionId: 1,
    });
    await vi.waitFor(() => expect(onFrame).toHaveBeenCalled());
    expect(onFrame).toHaveBeenCalledWith(
      expect.objectContaining({ cssWidth: 400, cssHeight: 300, imageWidth: 800, imageHeight: 600 }),
    );
  } finally {
    await streamer.stop();
  }
});

it('serializes input behind a capture so emulation is stable', async () => {
  const streamer = new CdpStreamer({
    getPage: async () => ({}) as Page,
    ws: {} as WebSocket,
    logger: {} as Logger,
  });
  const events: string[] = [];
  let release!: () => void;
  const capture = streamer.runWithStableViewport(async () => {
    events.push('capture');
    await new Promise<void>((r) => {
      release = r;
    });
    events.push('restored');
  });
  const input = streamer.runWithStableViewport(async () => {
    events.push('input');
  });
  await Promise.resolve();
  expect(events).toEqual(['capture']);
  release();
  await capture;
  await input;
  expect(events).toEqual(['capture', 'restored', 'input']);
});
