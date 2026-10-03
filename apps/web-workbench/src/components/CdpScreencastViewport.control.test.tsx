// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CdpScreencastViewport } from './CdpScreencastViewport';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('requires and transmits the current lease on actual viewport keyboard input', () => {
  const sent: Array<{ controlLease?: string; payload: { type: string } }> = [];
  class Socket {
    static OPEN = 1;
    readyState = 1;
    send(raw: string) { sent.push(JSON.parse(raw)); }
    close() {}
  }
  vi.stubGlobal('WebSocket', Socket);
  const props = { wsUrl: 'ws://localhost/screencast-ws/tsk_test', streamToken: 'test', viewOnly: false };
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
