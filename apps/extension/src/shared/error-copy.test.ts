import { describe, expect, it } from 'vitest';
import { humanizeExtensionError } from './error-copy.js';

describe('humanizeExtensionError', () => {
  it('hides raw technical English errors', () => {
    expect(humanizeExtensionError('TypeError: Failed to fetch')).toBe(
      '网络连接失败，请检查网络后重试。',
    );
    expect(humanizeExtensionError('InternalServerError: stack trace line 42')).toBe(
      '操作没有完成，请稍后重试。如果反复出现，可以重新加载 HOLA DAY 扩展。',
    );
  });

  it('preserves already-friendly Chinese errors', () => {
    expect(humanizeExtensionError('请先输入任务内容')).toBe('请先输入任务内容');
  });

  it('maps extension connection failures to actionable copy', () => {
    expect(humanizeExtensionError('Could not establish connection. Receiving end does not exist.')).toBe(
      '浏览器扩展未连接，请重新加载 HOLA DAY 扩展后重试。',
    );
    expect(humanizeExtensionError('sidepanel_create_task_timeout')).toBe(
      '请求超时，页面或服务可能仍在加载，请稍后重试。',
    );
  });

  it('maps websocket gateway failures to a non-technical recovery hint', () => {
    expect(
      humanizeExtensionError(
        "WebSocket connection failed: Error during WebSocket handshake: Unexpected response code: 502",
      ),
    ).toBe('浏览器代理服务暂时不可用，请稍后重试；如果刚更新扩展，请重新加载 HOLA DAY。');
  });

  it('maps websocket connection closed errors to a recovery hint', () => {
    expect(
      humanizeExtensionError(
        "WebSocket connection to 'wss://holaday.ai/ws' failed: Error in connection establishment: net::ERR_CONNECTION_CLOSED",
      ),
    ).toBe('浏览器连接中断，请重新打开 HOLA DAY 扩展后重试。');
    expect(
      humanizeExtensionError(
        "WebSocket connection to 'wss://holaday.ai/ws' failed: Error in connection establishment: net::ERR_CONNECTION_RESET",
      ),
    ).toBe('浏览器连接中断，请重新打开 HOLA DAY 扩展后重试。');
  });
});
