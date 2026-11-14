// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CdpScreencastViewport } from './CdpScreencastViewport';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function captchaScreen() {
  const sockets: Array<{ onmessage: ((e: { data: string }) => void) | null }> = [];
  class Socket {
    static OPEN = 1;
    static CONNECTING = 0;
    readyState = 1;
    onmessage: ((e: { data: string }) => void) | null = null;
    constructor() {
      sockets.push(this);
    }
    send() {}
    close() {}
  }
  const images: Array<{ onload: (() => void) | null }> = [];
  class FakeImage {
    src = '';
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    width = 1280;
    height = 800;
    constructor() {
      images.push(this);
    }
  }
  vi.stubGlobal('WebSocket', Socket);
  vi.stubGlobal('Image', FakeImage);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage() {} } as never);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(640);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(420);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    x: 0,
    y: 0,
    width: 640,
    height: 420,
    right: 640,
    bottom: 420,
  } as DOMRect);
  const view = render(
    <CdpScreencastViewport
      wsUrl="ws://localhost/screencast-ws/tsk_test"
      streamToken="test"
      viewportV2
      viewOnly={false}
    />,
  );
  const socket = sockets.at(-1)!;
  const receive = (m: unknown) => act(() => socket.onmessage?.({ data: JSON.stringify(m) }));
  receive({
    type: 'frame',
    data: 'f1',
    metadata: {},
    geometry: {
      frameId: 'f1',
      tabId: 't',
      viewportRevision: 1,
      cssWidth: 1280,
      cssHeight: 800,
      imageWidth: 1280,
      imageHeight: 800,
      pageScaleFactor: 1,
      offsetTop: 0,
      scrollOffset: { x: 0, y: 0 },
      capturedAt: Date.now(),
    },
  });
  act(() => images.at(-1)?.onload?.());
  const canvas = view.container.querySelector('canvas')!;
  const scale = () => Number(canvas.style.getPropertyValue('--hd-scale'));
  return { receive, scale };
}

it('CAPTCHA-UX-1: the screen zooms on the captcha box, can be zoomed out, and restores when it is gone', () => {
  const { receive, scale } = captchaScreen();
  const whole = scale();
  expect(whole).toBeCloseTo(0.5); // 640/1280: the whole page
  expect(screen.queryByTestId('captcha-zoom-hint')).toBeNull();
  receive({ type: 'captcha-box', rect: { x: 100, y: 120, width: 400, height: 580 } });
  expect(screen.getByTestId('captcha-zoom-hint').textContent).toContain('耳机图标改听语音');
  const zoomed = scale();
  expect(zoomed).toBeCloseTo(420 / (580 + 48));
  expect(zoomed).toBeGreaterThan(whole);
  // 缩小 → the whole page; 放大 → back on the box.
  fireEvent.click(screen.getByTestId('captcha-zoom-toggle'));
  expect(screen.getByTestId('captcha-zoom-toggle').textContent).toBe('放大');
  expect(scale()).toBeCloseTo(whole);
  fireEvent.click(screen.getByTestId('captcha-zoom-toggle'));
  expect(scale()).toBeCloseTo(zoomed);
  // A second round moves the box: the picture follows.
  receive({ type: 'captcha-box', rect: { x: 300, y: 80, width: 300, height: 200 } });
  expect(scale()).toBeCloseTo(Math.min(640 / 348, 420 / 248));
  // Passed: the box is gone, the whole page comes back and the controls go away.
  receive({ type: 'captcha-box', rect: null });
  expect(scale()).toBeCloseTo(whole);
  expect(screen.queryByTestId('captcha-zoom-toggle')).toBeNull();
});

it('CAPTCHA-UX-1: a new verification zooms in again after the last one was zoomed out', () => {
  const { receive, scale } = captchaScreen();
  receive({ type: 'captcha-box', rect: { x: 100, y: 120, width: 400, height: 580 } });
  fireEvent.click(screen.getByTestId('captcha-zoom-toggle'));
  expect(scale()).toBeCloseTo(0.5);
  receive({ type: 'captcha-box', rect: null });
  receive({ type: 'captcha-box', rect: { x: 100, y: 120, width: 400, height: 580 } });
  expect(scale()).toBeGreaterThan(0.5);
  // A malformed box is no box.
  receive({ type: 'captcha-box', rect: { x: 'a', y: 0, width: 10, height: 10 } });
  expect(screen.queryByTestId('captcha-zoom-hint')).toBeNull();
});
