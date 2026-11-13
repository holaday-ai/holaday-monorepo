// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CdpScreencastViewport } from './CdpScreencastViewport';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type Sent = {
  type?: string;
  controlLease?: unknown;
  payload?: { type: string; x?: number; y?: number; text?: string; width?: number };
  observation?: { frameId?: string; tabId?: string; viewportRevision?: number };
};

/**
 * REBUILD-4 共同操作: a v2 screen on a host of the given size, with a socket and an image decoder
 * the test drives. Frames are of the fixed 1280x800 page (a 100x60 image) unless told otherwise.
 */
function sharedScreen(
  host: { width: number; height: number } = { width: 640, height: 420 },
  props: Partial<React.ComponentProps<typeof CdpScreencastViewport>> = {},
) {
  const sent: Sent[] = [];
  const sockets: Array<{ onmessage: ((e: { data: string }) => void) | null }> = [];
  class Socket {
    static OPEN = 1;
    static CONNECTING = 0;
    readyState = 1;
    onmessage: ((e: { data: string }) => void) | null = null;
    constructor() {
      sockets.push(this);
    }
    send(raw: string) {
      sent.push(JSON.parse(raw));
    }
    close() {}
  }
  const images: Array<{ onload: (() => void) | null }> = [];
  class FakeImage {
    src = '';
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    width = 100;
    height = 60;
    constructor() {
      images.push(this);
    }
  }
  vi.stubGlobal('WebSocket', Socket);
  vi.stubGlobal('Image', FakeImage);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage() {},
  } as never);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(host.width);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(host.height);
  const onInputRefused = vi.fn();
  const onUserInput = vi.fn();
  const view = render(
    <CdpScreencastViewport
      wsUrl="ws://localhost/screencast-ws/tsk_test"
      streamToken="test"
      viewportV2
      viewOnly={false}
      onInputRefused={onInputRefused}
      onUserInput={onUserInput}
      {...props}
    />,
  );
  const socket = sockets.at(-1);
  if (!socket?.onmessage) throw new Error('socket not connected');
  const receive = (m: unknown) => socket.onmessage?.({ data: JSON.stringify(m) });
  let n = 0;
  const frame = (scrollY = 0, cssWidth = 1280, cssHeight = 800) => {
    n++;
    receive({
      type: 'frame',
      data: `f${n}`,
      metadata: {},
      geometry: {
        frameId: `f${n}`,
        tabId: 't',
        viewportRevision: n,
        cssWidth,
        cssHeight,
        imageWidth: 100,
        imageHeight: 60,
        pageScaleFactor: 1,
        offsetTop: 0,
        scrollOffset: { x: 0, y: scrollY },
        capturedAt: Date.now(),
      },
    });
    images.at(-1)?.onload?.();
  };
  const canvas = view.container.querySelector('canvas');
  const input = view.container.querySelector('input');
  if (!canvas || !input) throw new Error('screen missing');
  canvas.setPointerCapture = () => {};
  canvas.releasePointerCapture = () => {};
  canvas.hasPointerCapture = () => false;
  canvas.getBoundingClientRect = () =>
    ({ left: 0, top: 0, x: 0, y: 0, width: 100, height: 60, right: 100, bottom: 60 }) as DOMRect;
  const press = (clientX = 20, clientY = 30) => {
    const pointer = { clientX, clientY, button: 0, detail: 1, pointerId: 1, pointerType: 'mouse' };
    fireEvent.pointerDown(canvas, pointer);
    fireEvent.pointerUp(canvas, pointer);
  };
  const pointer = () => sent.filter((m) => /^mouse(Down|Up)$/.test(m.payload?.type ?? ''));
  return {
    ...view,
    sent,
    receive,
    frame,
    canvas,
    input,
    press,
    pointer,
    onInputRefused,
    onUserInput,
  };
}

it('REBUILD-4 (a): a press goes straight to the page with no lease and names the frame it was made on', () => {
  const screen = sharedScreen();
  screen.receive({ type: 'viewport-v2-ready' });
  screen.frame();
  screen.press();
  const pointer = screen.pointer();
  expect(pointer.map((m) => m.payload?.type)).toEqual(['mouseDown', 'mouseUp']);
  for (const m of pointer) {
    expect(m.type).toBe('input');
    expect('controlLease' in m).toBe(false);
    expect(m.observation).toEqual({ frameId: 'f1', tabId: 't', viewportRevision: 1 });
  }
  expect(screen.onUserInput).toHaveBeenCalled();
});

it('REBUILD-4 (a): keys go straight to the page too, with no first click to take control', () => {
  const screen = sharedScreen();
  screen.frame();
  fireEvent.keyDown(screen.input, { key: 'x', code: 'KeyX', keyCode: 88 });
  expect(screen.sent.filter((m) => m.payload?.type === 'keyDown')).toMatchObject([
    { type: 'input', observation: { frameId: 'f1' } },
  ]);
  expect(screen.sent.some((m) => 'controlLease' in m)).toBe(false);
});

it.each([
  ['desktop panel', { width: 1280, height: 800 }],
  ['narrow side panel', { width: 471, height: 835 }],
  ['phone sheet', { width: 390, height: 760 }],
])('REBUILD-4 (b): no viewport message is ever sent (%s)', async (_label, host) => {
  const screen = sharedScreen(host);
  screen.receive({ type: 'viewport-v2-ready' });
  screen.frame();
  window.dispatchEvent(new Event('resize'));
  await new Promise((resolve) => setTimeout(resolve, 250));
  screen.press();
  expect(screen.sent.some((m) => m.payload?.type === ('viewport' as string))).toBe(false);
  expect(screen.pointer()).toHaveLength(2);
});

it('REBUILD-4 (c): a frame is accepted and scaled without any viewport request — even on a phone', () => {
  const screen = sharedScreen({ width: 390, height: 760 });
  // The page stays 1280x800 whatever this screen's size; no viewport-applied ever comes.
  screen.frame();
  expect(screen.canvas.dataset.frameId).toBe('f1');
  screen.press();
  expect(screen.pointer()).toHaveLength(2);
  expect(Number(screen.canvas.style.getPropertyValue('--hd-scale'))).toBeLessThan(1);
});

it('REBUILD-4: the first frame with geometry makes the stream write-ready without viewport-v2-ready', () => {
  const screen = sharedScreen();
  screen.frame();
  screen.press();
  expect(screen.pointer()).toHaveLength(2);
});

it('REBUILD-4: a press is mapped from the displayed frame to the fixed page', () => {
  const screen = sharedScreen();
  screen.frame();
  screen.press(20, 30);
  // 20,30 on a 100x60 image of the 1280x800 page: the image covers the top 768 rows at its
  // own scale (12.8 page px per image px) → 256,384.
  expect(screen.pointer()[0]?.payload).toMatchObject({ x: 256, y: 384 });
});

it('REBUILD-4: a view-only screen sends nothing', () => {
  const screen = sharedScreen(undefined, { viewOnly: true });
  screen.frame();
  screen.press();
  fireEvent.keyDown(screen.input, { key: 'x', code: 'KeyX', keyCode: 88 });
  expect(screen.sent.filter((m) => m.type === 'input')).toEqual([]);
  expect(screen.onUserInput).not.toHaveBeenCalled();
});

it('REBUILD-4: nothing painted yet → asks for a frame; a press made on no picture is never sent', () => {
  const screen = sharedScreen();
  screen.press();
  expect(screen.pointer()).toEqual([]);
  expect(screen.sent.some((m) => m.type === 'observe')).toBe(true);
  screen.frame();
  // The press was not made on this page's picture: it is not replayed on it.
  expect(screen.pointer()).toEqual([]);
  expect(screen.onInputRefused).toHaveBeenCalledWith('pointer');
});

it('REBUILD-4: a stale frame is never used to name input; a fresh one is asked for first', () => {
  const now = vi.spyOn(Date, 'now');
  const start = 1_000_000;
  now.mockReturnValue(start);
  const screen = sharedScreen();
  screen.frame();
  // 6 seconds later, nothing new painted: the frame is too old for the server.
  now.mockReturnValue(start + 6_000);
  screen.press();
  expect(screen.pointer()).toEqual([]);
  expect(screen.sent.filter((m) => m.type === 'observe').length).toBeGreaterThan(0);
  screen.frame();
  expect(screen.pointer().every((m) => m.observation?.frameId === 'f2')).toBe(true);
  expect(screen.pointer()).toHaveLength(2);
});

it('REBUILD-4: the page scrolled before a waiting press could go out — not delivered, 「再点一次」', () => {
  const now = vi.spyOn(Date, 'now');
  const start = 1_000_000;
  now.mockReturnValue(start);
  const screen = sharedScreen();
  screen.frame(0);
  now.mockReturnValue(start + 6_000);
  screen.press();
  screen.frame(120);
  expect(screen.pointer()).toEqual([]);
  expect(screen.onInputRefused).toHaveBeenCalledWith('pointer');
});

it('REBUILD-4: a navigation invalidates the frame: input waits for the new page', () => {
  const screen = sharedScreen();
  screen.frame();
  screen.receive({ type: 'url-changed', url: 'https://example.com/next' });
  screen.press();
  expect(screen.pointer()).toEqual([]);
  screen.receive({ type: 'observation-invalidated' });
  expect(screen.canvas.dataset.frameId).toBeUndefined();
});

it('REBUILD-4: the server refusing input (the page changed) is said once per burst — keys and presses', () => {
  const screen = sharedScreen();
  screen.receive({ type: 'input-expired', input: 'key' });
  screen.receive({ type: 'input-expired', input: 'key' });
  screen.receive({ type: 'input-expired', input: 'pointer' });
  expect(screen.onInputRefused).toHaveBeenCalledTimes(1);
  expect(screen.onInputRefused).toHaveBeenCalledWith('key');
});

it('REBUILD-4: a refused press is said as a press; a refused move or scroll says nothing', () => {
  const screen = sharedScreen();
  screen.receive({ type: 'input-expired', input: 'mouseMove' });
  screen.receive({ type: 'input-expired', input: 'scroll' });
  expect(screen.onInputRefused).not.toHaveBeenCalled();
  screen.receive({ type: 'input-expired', input: 'mouseDown' });
  expect(screen.onInputRefused).toHaveBeenCalledWith('pointer');
});

it('REBUILD-4: hovering does not count as the person operating; a press does', () => {
  const screen = sharedScreen();
  screen.frame();
  fireEvent.pointerMove(screen.canvas, {
    clientX: 10,
    clientY: 10,
    buttons: 0,
    pointerType: 'mouse',
  });
  expect(screen.sent.some((m) => m.payload?.type === 'mouseMove')).toBe(true);
  expect(screen.onUserInput).not.toHaveBeenCalled();
  screen.press();
  expect(screen.onUserInput).toHaveBeenCalled();
});

it('REBUILD-4: a tap on a phone is a click on the page', () => {
  const screen = sharedScreen({ width: 390, height: 760 });
  screen.frame();
  const touch = { clientX: 20, clientY: 30 };
  fireEvent.touchStart(screen.canvas, { touches: [touch] });
  fireEvent.touchEnd(screen.canvas, { changedTouches: [touch] });
  expect(screen.pointer().map((m) => m.payload?.type)).toEqual(['mouseDown', 'mouseUp']);
  expect(screen.pointer()[0]?.payload).toMatchObject({ x: 256, y: 384 });
});

it('FIX-62 P1-4: the text bar channel (phone, Chinese) sends insertText, and says false when only watching', () => {
  const channel = { current: null as ((text: string) => boolean) | null };
  const watching = sharedScreen(undefined, { viewOnly: true, textChannel: channel });
  watching.frame();
  expect(channel.current?.('你好')).toBe(false);
  expect(watching.sent.filter((m) => m.payload?.type === 'insertText')).toEqual([]);
  watching.rerender(
    <CdpScreencastViewport
      wsUrl="ws://localhost/screencast-ws/tsk_test"
      streamToken="test"
      viewportV2
      viewOnly={false}
      textChannel={channel}
    />,
  );
  expect(channel.current?.('你好')).toBe(true);
  expect(watching.sent.filter((m) => m.payload?.type === 'insertText')).toMatchObject([
    {
      type: 'input',
      payload: { type: 'insertText', text: '你好' },
      observation: { frameId: 'f1' },
    },
  ]);
});

it('legacy (non-v2) stream: input goes out with no lease and no observation', () => {
  const sent: Sent[] = [];
  class Socket {
    static OPEN = 1;
    readyState = 1;
    send(raw: string) {
      sent.push(JSON.parse(raw));
    }
    close() {}
  }
  vi.stubGlobal('WebSocket', Socket);
  const { container } = render(
    <CdpScreencastViewport
      wsUrl="ws://localhost/screencast-ws/tsk_test"
      streamToken="test"
      viewOnly={false}
    />,
  );
  const input = container.querySelector('input');
  if (!input) throw new Error('input missing');
  fireEvent.keyDown(input, { key: 'x', code: 'KeyX', keyCode: 88 });
  expect(sent).toEqual([{ type: 'input', payload: expect.objectContaining({ type: 'keyDown' }) }]);
});

it('FIX-61 复审 #2 #2: frames arriving faster than one decode never starve the screen — the newest waiting frame paints next', () => {
  const sockets: Array<{ onmessage: ((e: { data: string }) => void) | null }> = [];
  class Socket {
    static OPEN = 1;
    readyState = 1;
    onmessage: ((e: { data: string }) => void) | null = null;
    constructor() {
      sockets.push(this);
    }
    send() {}
    close() {}
  }
  const images: Array<{ src: string; onload: (() => void) | null; width: number; height: number }> =
    [];
  class FakeImage {
    src = '';
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    width = 10;
    height = 10;
    constructor() {
      images.push(this);
    }
  }
  vi.stubGlobal('WebSocket', Socket);
  vi.stubGlobal('Image', FakeImage);
  render(
    <CdpScreencastViewport wsUrl="ws://localhost/screencast-ws/tsk_test" streamToken="test" />,
  );
  const socket = sockets.at(-1);
  if (!socket?.onmessage) throw new Error('socket not connected');
  const frame = (data: string) =>
    socket.onmessage?.({ data: JSON.stringify({ type: 'frame', data, metadata: {} }) });
  frame('f1');
  for (const n of [2, 3, 4, 5]) frame(`f${n}`);
  // One decode in flight; the four frames behind it did not cancel it.
  expect(images).toHaveLength(1);
  expect(images[0]?.src).toContain('f1');
  images[0]?.onload?.();
  // Then the newest waiting frame only (f2-f4 were superseded while waiting).
  expect(images).toHaveLength(2);
  expect(images[1]?.src).toContain('f5');
  images[1]?.onload?.();
  expect(images).toHaveLength(2);
  frame('f6');
  expect(images).toHaveLength(3);
});
