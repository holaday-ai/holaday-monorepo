import { describe, expect, it } from 'vitest';
import { classifyBrowserErrorKind } from './browser-error-kind';

describe('classifyBrowserErrorKind', () => {
  it('classifies common Chromium navigation failures', () => {
    expect(classifyBrowserErrorKind('net::ERR_NAME_NOT_RESOLVED at https://nope.example')).toBe('dns');
    expect(classifyBrowserErrorKind('net::ERR_CERT_AUTHORITY_INVALID')).toBe('ssl');
    expect(classifyBrowserErrorKind('net::ERR_CONNECTION_REFUSED')).toBe('connection');
    expect(classifyBrowserErrorKind('net::ERR_ABORTED; maybe frame navigated')).toBe('page_switch');
  });

  it('keeps extension, transport, and timeout failures distinct', () => {
    expect(classifyBrowserErrorKind('扩展工具调用超时（已等待 30 秒）')).toBe('extension_timeout');
    expect(classifyBrowserErrorKind('扩展未连接，无法走 Mode B')).toBe('extension_missing');
    expect(classifyBrowserErrorKind('Could not establish connection. Receiving end does not exist.')).toBe(
      'extension_missing',
    );
    expect(classifyBrowserErrorKind('浏览器扩展连接已断开，请重新打开 HOLA DAY 扩展后重试')).toBe(
      'extension_disconnected',
    );
    expect(classifyBrowserErrorKind('Unchecked runtime.lastError: The message port closed before a response was received.')).toBe(
      'extension_disconnected',
    );
    expect(classifyBrowserErrorKind('Cannot access contents of url "https://example.com/". Extension manifest must request permission.')).toBe(
      'extension_permission',
    );
    expect(classifyBrowserErrorKind('Protocol error (Page.navigate): Target closed')).toBe('transport_closed');
    expect(classifyBrowserErrorKind('Navigation timeout of 15000 ms exceeded')).toBe('timeout');
  });
});
