// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CdpScreencastViewport } from './CdpScreencastViewport';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
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
    <CdpScreencastViewport {...props} viewOnly controlLease={null} onRequestControl={onRequestControl} />,
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
      <CdpScreencastViewport {...props} viewOnly={false} controlLease="late" onRequestControl={vi.fn()} />,
    );
    expect(sent.filter((m) => m.payload?.type === 'keyDown')).toEqual([]);
  } finally {
    vi.useRealTimers();
  }
});
