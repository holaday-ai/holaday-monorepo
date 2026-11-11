// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CdpScreencastViewport } from './CdpScreencastViewport';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('requires and transmits the current lease on actual viewport keyboard input', () => {
  const sent: Array<{ controlLease?: string; payload: { type: string } }> = [];
  class Socket {
    static OPEN = 1;
    readyState = 1;
    send(raw: string) {
      sent.push(JSON.parse(raw));
    }
    close() {}
  }
  vi.stubGlobal('WebSocket', Socket);
  const props = {
    wsUrl: 'ws://localhost/screencast-ws/tsk_test',
    streamToken: 'test',
    viewOnly: false,
  };
  const { container, rerender } = render(<CdpScreencastViewport {...props} controlLease={null} />);
  const input = container.querySelector('input');
  if (!input) throw new Error('input missing');
  fireEvent.keyDown(input, { key: 'x', code: 'KeyX', keyCode: 88 });
  expect(sent).toEqual([]);
  rerender(<CdpScreencastViewport {...props} controlLease="current" />);
  fireEvent.keyDown(input, { key: 'x', code: 'KeyX', keyCode: 88 });
  expect(sent).toMatchObject([{ controlLease: 'current', payload: { type: 'keyDown' } }]);
  rerender(<CdpScreencastViewport {...props} controlLease={null} />);
  fireEvent.keyDown(input, { key: 'x', code: 'KeyX', keyCode: 88 });
  expect(sent).toHaveLength(1);
});

it('FIX-61: typing on a view-only screen asks for control and is delivered once control arrives', () => {
  const sent: Array<{ controlLease?: string; payload: { type: string } }> = [];
  class Socket {
    static OPEN = 1;
    readyState = 1;
    send(raw: string) {
      sent.push(JSON.parse(raw));
    }
    close() {}
  }
  vi.stubGlobal('WebSocket', Socket);
  const onRequestControl = vi.fn();
  const props = { wsUrl: 'ws://localhost/screencast-ws/tsk_test', streamToken: 'test' };
  const { container, rerender } = render(
    <CdpScreencastViewport
      {...props}
      viewOnly
      controlLease={null}
      onRequestControl={onRequestControl}
    />,
  );
  const input = container.querySelector('input');
  if (!input) throw new Error('input missing');
  fireEvent.keyDown(input, { key: 'h', code: 'KeyH', keyCode: 72 });
  fireEvent.keyDown(input, { key: 'i', code: 'KeyI', keyCode: 73 });
  expect(onRequestControl).toHaveBeenCalledTimes(1);
  expect(sent.filter((m) => m.payload?.type !== 'viewport')).toEqual([]);
  rerender(
    <CdpScreencastViewport
      {...props}
      viewOnly={false}
      controlLease="granted"
      onRequestControl={onRequestControl}
    />,
  );
  const keys = sent.filter((m) => m.payload?.type === 'keyDown');
  expect(keys).toHaveLength(2);
  expect(keys.every((m) => m.controlLease === 'granted')).toBe(true);
});

it('FIX-61: input waiting for control is dropped when control does not come within 4 seconds', () => {
  vi.useFakeTimers();
  try {
    const sent: Array<{ payload: { type: string } }> = [];
    class Socket {
      static OPEN = 1;
      readyState = 1;
      send(raw: string) {
        sent.push(JSON.parse(raw));
      }
      close() {}
    }
    vi.stubGlobal('WebSocket', Socket);
    const props = { wsUrl: 'ws://localhost/screencast-ws/tsk_test', streamToken: 'test' };
    const { container, rerender } = render(
      <CdpScreencastViewport {...props} viewOnly controlLease={null} onRequestControl={vi.fn()} />,
    );
    const input = container.querySelector('input');
    if (!input) throw new Error('input missing');
    fireEvent.keyDown(input, { key: 'p', code: 'KeyP', keyCode: 80 });
    vi.advanceTimersByTime(4_500);
    rerender(
      <CdpScreencastViewport
        {...props}
        viewOnly={false}
        controlLease="late"
        onRequestControl={vi.fn()}
      />,
    );
    expect(sent.filter((m) => m.payload?.type === 'keyDown')).toEqual([]);
  } finally {
    vi.useRealTimers();
  }
});

it('FIX-61: on a running task the press only asks for control and is not replayed later', () => {
  const sent: Array<{ payload: { type: string } }> = [];
  class Socket {
    static OPEN = 1;
    readyState = 1;
    send(raw: string) {
      sent.push(JSON.parse(raw));
    }
    close() {}
  }
  vi.stubGlobal('WebSocket', Socket);
  const onRequestControl = vi.fn();
  const props = { wsUrl: 'ws://localhost/screencast-ws/tsk_test', streamToken: 'test' };
  const { container, rerender } = render(
    <CdpScreencastViewport
      {...props}
      viewOnly
      controlLease={null}
      onRequestControl={onRequestControl}
      replayAfterControl={false}
    />,
  );
  const input = container.querySelector('input');
  if (!input) throw new Error('input missing');
  fireEvent.keyDown(input, { key: 'q', code: 'KeyQ', keyCode: 81 });
  expect(onRequestControl).toHaveBeenCalledTimes(1);
  rerender(
    <CdpScreencastViewport
      {...props}
      viewOnly={false}
      controlLease="granted"
      onRequestControl={onRequestControl}
      replayAfterControl={false}
    />,
  );
  expect(sent.filter((m) => m.payload?.type === 'keyDown')).toEqual([]);
  fireEvent.keyDown(input, { key: 'q', code: 'KeyQ', keyCode: 81 });
  expect(sent.filter((m) => m.payload?.type === 'keyDown')).toHaveLength(1);
});

it('FIX-61 复审 #2 #2: the press that asks for control and its release both land, though the panel withdraws the request while it is in flight', () => {
  const sent: Array<{ controlLease?: string; payload: { type: string } }> = [];
  class Socket {
    static OPEN = 1;
    readyState = 1;
    send(raw: string) {
      sent.push(JSON.parse(raw));
    }
    close() {}
  }
  vi.stubGlobal('WebSocket', Socket);
  const onRequestControl = vi.fn();
  const props = { wsUrl: 'ws://localhost/screencast-ws/tsk_test', streamToken: 'test' };
  const { container, rerender } = render(
    <CdpScreencastViewport
      {...props}
      viewOnly
      controlLease={null}
      onRequestControl={onRequestControl}
    />,
  );
  const canvas = container.querySelector('canvas');
  if (!canvas) throw new Error('canvas missing');
  fireEvent.mouseDown(canvas, { clientX: 20, clientY: 30, button: 0, detail: 1 });
  expect(onRequestControl).toHaveBeenCalledTimes(1);
  // BrowserPanel: the takeover is pending, so it no longer offers onRequestControl.
  rerender(<CdpScreencastViewport {...props} viewOnly controlLease={null} />);
  fireEvent.mouseUp(canvas, { clientX: 20, clientY: 30, button: 0, detail: 1 });
  expect(sent.filter((m) => /^mouse/.test(m.payload?.type))).toEqual([]);
  rerender(<CdpScreencastViewport {...props} viewOnly={false} controlLease="granted" />);
  const pointer = sent.filter((m) => /^mouse/.test(m.payload?.type));
  expect(pointer.map((m) => m.payload.type)).toEqual(['mouseDown', 'mouseUp']);
  expect(pointer.every((m) => m.controlLease === 'granted')).toBe(true);
});

it('FIX-61 复审 #2 #2: a press nobody asked control for is still not kept', () => {
  const sent: Array<{ payload: { type: string } }> = [];
  class Socket {
    static OPEN = 1;
    readyState = 1;
    send(raw: string) {
      sent.push(JSON.parse(raw));
    }
    close() {}
  }
  vi.stubGlobal('WebSocket', Socket);
  const props = { wsUrl: 'ws://localhost/screencast-ws/tsk_test', streamToken: 'test' };
  const { container, rerender } = render(
    <CdpScreencastViewport {...props} viewOnly controlLease={null} />,
  );
  const canvas = container.querySelector('canvas');
  if (!canvas) throw new Error('canvas missing');
  fireEvent.mouseDown(canvas, { clientX: 5, clientY: 5, button: 0, detail: 1 });
  fireEvent.mouseUp(canvas, { clientX: 5, clientY: 5, button: 0, detail: 1 });
  rerender(<CdpScreencastViewport {...props} viewOnly={false} controlLease="later" />);
  expect(sent.filter((m) => /^mouse/.test(m.payload?.type))).toEqual([]);
});

it('FIX-61 复审 #2 #2: held input on a still page asks for a fresh frame once control arrives', () => {
  const sent: Array<{ type?: string; payload?: { type: string } }> = [];
  class Socket {
    static OPEN = 1;
    readyState = 1;
    send(raw: string) {
      sent.push(JSON.parse(raw));
    }
    close() {}
  }
  vi.stubGlobal('WebSocket', Socket);
  const onRequestControl = vi.fn();
  const props = {
    wsUrl: 'ws://localhost/screencast-ws/tsk_test',
    streamToken: 'test',
    viewportV2: true,
  };
  const { container, rerender } = render(
    <CdpScreencastViewport
      {...props}
      viewOnly
      controlLease={null}
      onRequestControl={onRequestControl}
    />,
  );
  const input = container.querySelector('input');
  if (!input) throw new Error('input missing');
  fireEvent.keyDown(input, { key: 'h', code: 'KeyH', keyCode: 72 });
  expect(onRequestControl).toHaveBeenCalledTimes(1);
  expect(sent.filter((m) => m.type === 'observe')).toEqual([]);
  rerender(<CdpScreencastViewport {...props} viewOnly={false} controlLease="granted" />);
  expect(sent.filter((m) => m.type === 'observe').length).toBeGreaterThan(0);
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
    <CdpScreencastViewport
      wsUrl="ws://localhost/screencast-ws/tsk_test"
      streamToken="test"
      viewOnly
      controlLease={null}
    />,
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

/**
 * DEPLOY-61 第 0 步 #2: an ended task's screen whose size the server has not applied yet (the
 * assistant's 1280x800 page is shown). The user presses on it; taking control applies this
 * screen's size, then a fresh frame comes and the held press is delivered or not.
 * DEPLOY-61 重跑 第 0 步 #2: the held press now goes out on the layout the user saw, named by a
 * fresh frame asked for once control arrives, before this screen's size. `seenScrollY` moves the
 * page in that fresh frame (it no longer shows what was pressed on); `refused` has the server
 * refuse the replayed press as stale.
 */
async function heldPressAcrossTakeover(
  host: { width: number; height: number; mobile: boolean },
  { seenScrollY = 0, refused = false }: { seenScrollY?: number; refused?: boolean } = {},
) {
  const sent: Array<{
    type?: string;
    payload?: { type: string; width?: number; height?: number };
    observation?: { frameId?: string };
  }> = [];
  const sockets: Array<{ onmessage: ((e: { data: string }) => void) | null }> = [];
  class Socket {
    static OPEN = 1;
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
  const onRequestControl = vi.fn();
  const onHeldInputDropped = vi.fn();
  const props = {
    wsUrl: 'ws://localhost/screencast-ws/tsk_test',
    streamToken: 'test',
    viewportV2: true,
    replayAfterControl: true,
    mobileViewport: host.mobile,
    onHeldInputDropped,
  };
  const { container, rerender } = render(
    <CdpScreencastViewport
      {...props}
      viewOnly
      controlLease={null}
      onRequestControl={onRequestControl}
    />,
  );
  const socket = sockets.at(-1);
  if (!socket?.onmessage) throw new Error('socket not connected');
  const receive = (m: unknown) => socket.onmessage?.({ data: JSON.stringify(m) });
  receive({ type: 'viewport-v2-ready', controlReady: true });
  let n = 0;
  const frame = (cssWidth: number, cssHeight: number, scrollY = 0) => {
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
  const viewports = () => sent.filter((m) => m.payload?.type === 'viewport');
  await vi.waitFor(() => expect(viewports().length).toBe(1));
  // The server does not apply a watcher's size on an ended task: the frames still show the
  // assistant's 1280x800 page, and that is what the user presses on.
  frame(1280, 800);
  const canvas = container.querySelector('canvas');
  if (!canvas) throw new Error('canvas missing');
  canvas.setPointerCapture = () => {};
  canvas.releasePointerCapture = () => {};
  canvas.getBoundingClientRect = () =>
    ({ left: 0, top: 0, x: 0, y: 0, width: 100, height: 60, right: 100, bottom: 60 }) as DOMRect;
  const pointer = {
    clientX: 20,
    clientY: 30,
    button: 0,
    detail: 1,
    pointerId: 1,
    pointerType: 'mouse',
  };
  fireEvent.pointerDown(canvas, pointer);
  fireEvent.pointerUp(canvas, pointer);
  expect(onRequestControl).toHaveBeenCalledTimes(1);
  // Control arrives (the panel hands the lease over and lifts view-only in separate renders).
  rerender(
    <CdpScreencastViewport
      {...props}
      viewOnly
      controlLease="granted"
      onRequestControl={onRequestControl}
    />,
  );
  rerender(<CdpScreencastViewport {...props} viewOnly={false} controlLease="granted" />);
  // The size this screen sent while watching was never applied (nor confirmed): it changes
  // nothing on the page. The screen asks for a fresh frame, still the 1280x800 layout.
  await vi.waitFor(() => expect(sent.some((m) => m.type === 'observe')).toBe(true));
  expect(viewports()).toHaveLength(1);
  frame(1280, 800, seenScrollY);
  if (refused) receive({ type: 'input-expired' });
  // Then the screen's size is sent, applied, and a frame of the new layout comes.
  await vi.waitFor(() => expect(viewports().length).toBe(2), { timeout: 6000 });
  const size = viewports()[1]?.payload;
  receive({ type: 'viewport-applied', width: size?.width, height: size?.height });
  frame(size?.width ?? 0, size?.height ?? 0);
  const isPointer = (m: (typeof sent)[number]) => /^mouse/.test(m.payload?.type ?? '');
  const pointerIndexes = sent.flatMap((m, i) => (isPointer(m) ? [i] : []));
  return {
    size,
    pointer: sent.filter(isPointer),
    /** Every press/release went out before this screen's size message (under the lease). */
    pointerBeforeSize:
      pointerIndexes.length > 0 &&
      Math.max(...pointerIndexes) < sent.indexOf(viewports()[1] as (typeof sent)[number]),
    onHeldInputDropped,
  };
}

it('DEPLOY-61 重跑 #2: on a finished task the first press lands on the layout the user saw, then the phone width is applied', async () => {
  const { size, pointer, pointerBeforeSize, onHeldInputDropped } = await heldPressAcrossTakeover({
    width: 390,
    height: 760,
    mobile: true,
  });
  expect(size?.width).not.toBe(1280);
  expect(pointer.map((m) => m.payload?.type)).toEqual(['mouseDown', 'mouseUp']);
  // Named by the fresh 1280x800 frame asked for after control arrived (f2), same layout as seen.
  expect(pointer.every((m) => m.observation?.frameId === 'f2')).toBe(true);
  expect(pointerBeforeSize).toBe(true);
  expect(onHeldInputDropped).not.toHaveBeenCalled();
});

it('DEPLOY-61 重跑 #2: a taller desktop panel (the centred Google box would move) — the press lands first, on the layout seen', async () => {
  const { size, pointer, pointerBeforeSize, onHeldInputDropped } = await heldPressAcrossTakeover({
    width: 640,
    height: 420,
    mobile: false,
  });
  expect(size).toMatchObject({ width: 1280, height: 840 });
  expect(pointer.map((m) => m.payload?.type)).toEqual(['mouseDown', 'mouseUp']);
  expect(pointerBeforeSize).toBe(true);
  expect(onHeldInputDropped).not.toHaveBeenCalled();
});

it('DEPLOY-61 重跑 #2: the press is mapped on the layout seen (same point as before the re-layout)', async () => {
  const { pointer } = await heldPressAcrossTakeover({ width: 640, height: 420, mobile: false });
  // 20,30 on a 100x60 image of the 1280x800 page the user saw: at the image's own scale
  // (12.8 px per image px) it covers the top 768 rows → 256,384, the point shown under the press.
  expect(pointer[0]?.payload).toMatchObject({ x: 256, y: 384 });
});

it('DEPLOY-61 重跑 #2: the page moved before the press could go out — not delivered, 「请再点一次」', async () => {
  const { pointer, onHeldInputDropped } = await heldPressAcrossTakeover(
    { width: 640, height: 400, mobile: false },
    { seenScrollY: 120 },
  );
  expect(pointer).toEqual([]);
  expect(onHeldInputDropped).toHaveBeenCalledTimes(1);
});

it('DEPLOY-61 重跑 #2: the server refuses the replayed press as stale — 「请再点一次」', async () => {
  const { pointer, onHeldInputDropped } = await heldPressAcrossTakeover(
    { width: 640, height: 420, mobile: false },
    { refused: true },
  );
  expect(pointer.map((m) => m.payload?.type)).toEqual(['mouseDown', 'mouseUp']);
  expect(onHeldInputDropped).toHaveBeenCalledTimes(1);
});
