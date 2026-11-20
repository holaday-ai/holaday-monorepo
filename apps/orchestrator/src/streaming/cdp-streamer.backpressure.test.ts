import { EventEmitter } from 'node:events';
import type { BrowserFrameGeometry } from '@holaday/shared-types';
import { pino } from 'pino';
import type { CDPSession, Page } from 'playwright';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import { CdpStreamer } from './cdp-streamer.js';

/**
 * STREAM-1 step 1 (G2h): a viewer whose link is slower than Chromium's frame rate must never make
 * the server queue frames. While the socket still holds unsent bytes, only the newest frame waits;
 * older waiting frames are dropped. Chromium is still acked at once (it never starves the page).
 */
function fixture(viewportV2 = false) {
  const session = Object.assign(new EventEmitter(), {
    send: vi.fn(async (method: string) =>
      method === 'Page.getFrameTree'
        ? { frameTree: { frame: { id: 'main', loaderId: 'l1' } } }
        : {},
    ),
    detach: vi.fn(async () => {}),
  });
  const page = {
    context: () => ({ newCDPSession: async () => session }),
    url: () => 'https://example.com/',
    isClosed: () => false,
  } as unknown as Page;
  const sent: string[] = [];
  const ws = {
    bufferedAmount: 0,
    readyState: 1,
    send: vi.fn((data: string) => {
      sent.push(data);
    }),
  };
  const frames: BrowserFrameGeometry[] = [];
  const streamer = new CdpStreamer({
    getPage: async () => page,
    ws: ws as unknown as WebSocket,
    logger: pino({ level: 'silent' }),
    viewportV2,
    onFrame: (geometry) => frames.push(geometry),
  });
  const frameMessages = () =>
    sent
      .map((raw) => JSON.parse(raw) as { type: string; data?: string; geometry?: unknown })
      .filter((m) => m.type === 'frame');
  const acks = () =>
    session.send.mock.calls.filter(([method]) => method === 'Page.screencastFrameAck').length;
  const emitFrame = (data: string, sessionId: number, metadata: Record<string, number> = {}) =>
    session.emit('Page.screencastFrame', { data, metadata, sessionId });
  return {
    session: session as unknown as CDPSession & EventEmitter,
    ws,
    streamer,
    frames,
    frameMessages,
    acks,
    emitFrame,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('CdpStreamer on a slow viewer socket', () => {
  it('keeps no backlog: only the newest frame waits, and it is sent once the socket drains', async () => {
    vi.useFakeTimers();
    const f = fixture();
    await f.streamer.start();
    f.emitFrame('frame-0', 1);
    expect(f.frameMessages().map((m) => m.data)).toEqual(['frame-0']);

    // The link is congested: the socket still holds megabytes it could not send yet.
    f.ws.bufferedAmount = 4 * 1024 * 1024;
    for (let i = 1; i <= 50; i++) f.emitFrame(`frame-${i}`, i + 1);
    await vi.advanceTimersByTimeAsync(200);
    expect(f.frameMessages()).toHaveLength(1);
    // Chromium is never held back: every frame was acked as it arrived.
    expect(f.acks()).toBe(51);

    f.ws.bufferedAmount = 0;
    await vi.advanceTimersByTimeAsync(50);
    expect(f.frameMessages().map((m) => m.data)).toEqual(['frame-0', 'frame-50']);
    expect(f.streamer.frameStats()).toEqual({ sent: 2, dropped: 49 });

    // Nothing more waits once the newest frame went out.
    await vi.advanceTimersByTimeAsync(200);
    expect(f.frameMessages()).toHaveLength(2);
    await f.streamer.stop();
  });

  it('sends at once while the socket keeps up (no added delay)', async () => {
    const f = fixture();
    await f.streamer.start();
    for (let i = 0; i < 5; i++) f.emitFrame(`frame-${i}`, i + 1);
    expect(f.frameMessages().map((m) => m.data)).toEqual([
      'frame-0',
      'frame-1',
      'frame-2',
      'frame-3',
      'frame-4',
    ]);
    expect(f.streamer.frameStats()).toEqual({ sent: 5, dropped: 0 });
    await f.streamer.stop();
  });

  it('drops a waiting frame of the previous document on navigation', async () => {
    vi.useFakeTimers();
    const f = fixture();
    await f.streamer.start();
    f.ws.bufferedAmount = 1024 * 1024;
    f.emitFrame('old-document', 1);
    f.session.emit('Page.frameNavigated', {
      frame: { id: 'main', loaderId: 'l2', url: 'https://example.com/next' },
    });
    f.ws.bufferedAmount = 0;
    await vi.advanceTimersByTimeAsync(100);
    expect(f.frameMessages()).toHaveLength(0);
    await f.streamer.stop();
  });

  it('a waiting frame is dropped when the stream stops', async () => {
    vi.useFakeTimers();
    const f = fixture();
    await f.streamer.start();
    f.ws.bufferedAmount = 1024 * 1024;
    f.emitFrame('late', 1);
    await f.streamer.stop();
    f.ws.bufferedAmount = 0;
    await vi.advanceTimersByTimeAsync(100);
    expect(f.frameMessages()).toHaveLength(0);
  });

  it('V2: the geometry sent (and reported) is the one of the frame actually sent', async () => {
    const f = fixture(true);
    await f.streamer.start();
    const jpeg = async (width: number) =>
      (
        await sharp({
          create: { width, height: 10, channels: 3, background: '#808080' },
        })
          .jpeg()
          .toBuffer()
      ).toString('base64');
    const meta = { cssWidth: 100, cssHeight: 50 };
    f.emitFrame(await jpeg(20), 1, meta);
    await vi.waitFor(() => expect(f.frameMessages()).toHaveLength(1));

    f.ws.bufferedAmount = 4 * 1024 * 1024;
    // One at a time, so each frame's size is read before the next arrives.
    for (const width of [21, 22, 23]) {
      f.emitFrame(await jpeg(width), width, meta);
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(f.frameMessages()).toHaveLength(1);
    expect(f.streamer.frameStats()).toEqual({ sent: 1, dropped: 2 });
    expect(f.frames.map((g) => g.imageWidth)).toEqual([20]);

    f.ws.bufferedAmount = 0;
    await vi.waitFor(() => expect(f.frameMessages()).toHaveLength(2));
    const last = f.frameMessages()[1] as { data: string; geometry: BrowserFrameGeometry };
    const shown = await sharp(Buffer.from(last.data, 'base64')).metadata();
    expect(shown.width).toBe(23);
    expect(last.geometry.imageWidth).toBe(23);
    expect(f.frames.map((g) => g.imageWidth)).toEqual([20, 23]);
    expect(f.frames[1]).toEqual(last.geometry);
    await f.streamer.stop();
  });
});
