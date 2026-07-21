import { describe, expect, it } from 'vitest';
import { appendBrowserStreamToken } from './browser-stream-url';

describe('browser stream URL', () => {
  it('adds the latest short-lived token only when opening a socket', () => {
    expect(
      appendBrowserStreamToken(
        'wss://holaday.ai/screencast-ws/tsk_1',
        'token-2',
      ),
    ).toBe('wss://holaday.ai/screencast-ws/tsk_1?token=token-2');
  });

  it('does not produce a socket URL without both inputs', () => {
    expect(appendBrowserStreamToken(null, 'token')).toBeNull();
    expect(
      appendBrowserStreamToken('wss://holaday.ai/screencast-ws/tsk_1', null),
    ).toBeNull();
  });
});
