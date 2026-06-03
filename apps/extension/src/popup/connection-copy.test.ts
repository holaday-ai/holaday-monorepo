import { describe, expect, it, vi } from 'vitest';
import {
  type ExtensionStatusResponse,
  formatWsCloseReason,
  getConnectionStatusCopy,
  mergeConnectionStatusPoll,
} from './connection-copy.js';

function status(ws: Partial<ExtensionStatusResponse['ws']>): ExtensionStatusResponse {
  return {
    lastWelcomeAt: null,
    ws: {
      connected: false,
      readyState: null,
      reconnectAttempt: 0,
      reconnectCapped: false,
      lastOpenAt: null,
      lastCloseAt: null,
      lastCloseCode: null,
      lastCloseReason: null,
      lastErrorAt: null,
      nextRetryAt: null,
      ...ws,
    },
  };
}

describe('getConnectionStatusCopy', () => {
  it('describes a healthy websocket with the last welcome time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-31T00:00:10Z'));

    expect(
      getConnectionStatusCopy({
        lastWelcomeAt: new Date('2026-05-31T00:00:00Z').getTime(),
        ws: {
          connected: true,
          readyState: 1,
          reconnectAttempt: 0,
          reconnectCapped: false,
          lastOpenAt: null,
          lastCloseAt: null,
          lastCloseCode: null,
          lastCloseReason: null,
          lastErrorAt: null,
          nextRetryAt: null,
        },
      }),
    ).toEqual({
      title: '浏览器代理已连接',
      detail: '最近确认：10 秒前',
    });

    vi.useRealTimers();
  });

  it('does not reuse an old welcome timestamp after a newer socket opens', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-31T00:01:00Z'));

    expect(
      getConnectionStatusCopy({
        lastWelcomeAt: new Date('2026-05-31T00:00:00Z').getTime(),
        ws: {
          connected: true,
          readyState: 1,
          reconnectAttempt: 0,
          reconnectCapped: false,
          lastOpenAt: new Date('2026-05-31T00:00:30Z').getTime(),
          lastCloseAt: null,
          lastCloseCode: null,
          lastCloseReason: null,
          lastErrorAt: null,
          nextRetryAt: null,
        },
      }),
    ).toEqual({
      title: '浏览器代理正在确认连接',
      detail: '连接已建立，正在等待服务确认',
    });

    vi.useRealTimers();
  });

  it('shows a clear connecting state before the websocket is open', () => {
    expect(getConnectionStatusCopy(status({ readyState: 0 }))).toEqual({
      title: '浏览器代理正在连接',
      detail: '正在检查服务并建立安全连接',
    });
  });

  it('keeps connecting recovery timing visible after a recent failure', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-31T00:00:00Z'));

    expect(
      getConnectionStatusCopy(
        status({
          readyState: 0,
          lastCloseReason: 'ws route check failed',
          nextRetryAt: new Date('2026-05-31T00:00:03Z').getTime(),
        }),
      ),
    ).toEqual({
      title: '浏览器代理正在连接',
      detail: '最近错误：代理服务暂时不可用；下次尝试：几秒后',
    });

    vi.useRealTimers();
  });

  it('humanizes health-check failures during reconnect', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-31T00:00:00Z'));

    expect(
      getConnectionStatusCopy(
        status({
          reconnectAttempt: 2,
          lastCloseReason: 'health check failed',
          nextRetryAt: new Date('2026-05-31T00:00:06Z').getTime(),
        }),
      ),
    ).toEqual({
      title: '浏览器代理正在重连（2/3）',
      detail: '最近错误：服务暂时不可用；下次尝试：6 秒后',
    });

    vi.useRealTimers();
  });

  it('does not describe a near-future retry as just now', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-31T00:00:00Z'));

    expect(
      getConnectionStatusCopy(
        status({
          reconnectAttempt: 1,
          lastCloseReason: 'network error',
          nextRetryAt: new Date('2026-05-31T00:00:03Z').getTime(),
        }),
      ),
    ).toEqual({
      title: '浏览器代理正在重连（1/3）',
      detail: '最近错误：网络连接被关闭；下次尝试：几秒后',
    });

    vi.useRealTimers();
  });

  it('uses websocket close codes when Chrome omits a close reason', () => {
    expect(
      getConnectionStatusCopy(
        status({
          reconnectAttempt: 1,
          lastCloseCode: 1006,
        }),
      ),
    ).toEqual({
      title: '浏览器代理正在重连（1/3）',
      detail: '最近错误：网络连接被关闭；等待下一次重连',
    });
  });

  it('keeps capped reconnects actionable', () => {
    expect(
      getConnectionStatusCopy(
        status({
          reconnectAttempt: 4,
          reconnectCapped: true,
          lastCloseReason: 'open timeout',
        }),
      ),
    ).toEqual({
      title: '浏览器代理连接已暂停',
      detail: '多次重连失败：连接握手超时。点击底部“重试连接”后会重新尝试',
    });
  });
});

describe('mergeConnectionStatusPoll', () => {
  it('keeps the last known status when a transient poll returns empty', () => {
    const previous = status({ connected: true, readyState: 1 });

    expect(mergeConnectionStatusPoll(previous, null)).toBe(previous);
  });

  it('uses a fresh status response when one is available', () => {
    const previous = status({ connected: true, readyState: 1 });
    const next = status({ connected: false, readyState: 0 });

    expect(mergeConnectionStatusPoll(previous, next)).toBe(next);
  });
});

describe('formatWsCloseReason', () => {
  it('maps technical websocket reasons to user-facing copy', () => {
    expect(formatWsCloseReason('network error')).toBe('网络连接被关闭');
    expect(formatWsCloseReason('health check failed')).toBe('服务暂时不可用');
    expect(formatWsCloseReason('open timeout')).toBe('连接握手超时');
    expect(formatWsCloseReason('send failed')).toBe('消息发送失败');
    expect(formatWsCloseReason('client requested disconnect')).toBe('后台刚重载，正在恢复');
    expect(formatWsCloseReason('token swap')).toBe('登录态已切换，正在确认');
    expect(formatWsCloseReason('policy violation')).toBe('服务拒绝了当前连接');
    expect(formatWsCloseReason('Error during WebSocket handshake: Unexpected response code: 502')).toBe(
      '代理服务暂时不可用',
    );
    expect(formatWsCloseReason('ws route check failed')).toBe('代理服务暂时不可用');
    expect(formatWsCloseReason('net::ERR_CONNECTION_CLOSED')).toBe('网络连接被关闭');
    expect(formatWsCloseReason('net::ERR_CONNECTION_RESET')).toBe('网络连接已重置');
    expect(formatWsCloseReason('net::ERR_CONNECTION_REFUSED')).toBe('代理服务暂时不可达');
    expect(formatWsCloseReason('net::ERR_INTERNET_DISCONNECTED')).toBe('本机网络已断开');
    expect(formatWsCloseReason('net::ERR_NAME_NOT_RESOLVED')).toBe('域名解析失败');
    expect(formatWsCloseReason('net::ERR_NETWORK_CHANGED')).toBe('网络环境刚变化');
  });

  it('hides unknown raw websocket and technical close reasons', () => {
    expect(
      formatWsCloseReason("WebSocket connection to 'wss://holaday.ai/ws?token=secret' failed"),
    ).toBe('连接异常，正在恢复');
    expect(formatWsCloseReason('连接失败 token=secret sessionId=sid')).toBe('连接异常，正在恢复');
    expect(formatWsCloseReason('Internal socket state machine failed at frame 42')).toBe(
      '连接异常，正在恢复',
    );
  });
});
