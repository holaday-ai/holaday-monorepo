import { describe, expect, it } from 'vitest';
import { browserNavFailureMessage } from './browser-nav-copy';

describe('browserNavFailureMessage', () => {
  it('keeps unsupported URL schemes specific', () => {
    expect(browserNavFailureMessage('bad_scheme', 'goto')).toBe(
      '只支持打开 http(s) 链接',
    );
  });

  it('explains disconnected browser sessions', () => {
    expect(browserNavFailureMessage('no_executor', 'reload')).toContain(
      '浏览器会话已断开',
    );
  });

  it('uses directional copy for browser history misses', () => {
    expect(browserNavFailureMessage('no_history', 'back')).toBe(
      '没有可后退的页面',
    );
    expect(browserNavFailureMessage('no_history', 'forward')).toBe(
      '没有可前进的页面',
    );
    expect(browserNavFailureMessage('no_history', 'reload')).toBeNull();
  });

  it('falls back for unknown browser navigation failures', () => {
    expect(browserNavFailureMessage('anything_else', 'goto')).toBe(
      '浏览器操作失败，请稍后重试',
    );
  });
});
