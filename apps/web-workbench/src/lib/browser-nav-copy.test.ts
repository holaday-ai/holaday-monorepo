import { describe, expect, it } from 'vitest';
import {
  browserNavExceptionMessage,
  browserNavFailureMessage,
} from './browser-nav-copy';

describe('browserNavFailureMessage', () => {
  it('keeps unsupported URL schemes specific', () => {
    expect(browserNavFailureMessage('bad_scheme', 'goto')).toBe(
      '只支持打开 http(s) 链接',
    );
  });

  it('explains disconnected browser sessions', () => {
    expect(browserNavFailureMessage('no_executor', 'reload')).toBe(
      '当前没有可操作的浏览器，请重新执行任务',
    );
    expect(browserNavFailureMessage('no_executor', 'goto')).toBe(
      '当前没有可操作的浏览器，重新执行任务后再打开链接',
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

  it('explains navigation timeouts by direction', () => {
    expect(browserNavFailureMessage('nav_failed', 'goto')).toBe(
      '页面跳转超时，可能仍在加载。请稍后重试或换一个网址',
    );
    expect(browserNavFailureMessage('nav_failed', 'reload')).toBe(
      '刷新超时，页面可能仍在加载。请稍后重试',
    );
  });

  it('hides raw browser exception messages from navigation toasts', () => {
    expect(browserNavExceptionMessage(new Error('Navigation timeout of 15000 ms exceeded'), 'goto')).toBe(
      '页面跳转超时，可能仍在加载。请稍后重试或换一个网址',
    );
    expect(browserNavExceptionMessage(new Error('CDP session closed'), 'reload')).toBe(
      '浏览器连接中断，请重新执行任务',
    );
    expect(browserNavExceptionMessage(new Error('socket_closed: 浏览器扩展连接已断开'), 'reload')).toBe(
      '浏览器扩展连接已断开，请重新打开 HOLA DAY 扩展后重试',
    );
    expect(browserNavExceptionMessage(new Error('The message port closed before a response was received.'), 'reload')).toBe(
      '浏览器扩展连接已断开，请重新打开 HOLA DAY 扩展后重试',
    );
    expect(
      browserNavExceptionMessage(
        new Error('Cannot access contents of url. Extension manifest must request permission.'),
        'goto',
      ),
    ).toBe('浏览器扩展缺少当前网站权限，请在扩展里允许访问该网站后重试');
    expect(browserNavExceptionMessage(new Error('浏览器当前没有活动标签页'), 'goto')).toBe(
      '浏览器当前没有活动标签页，请打开一个网页后重试',
    );
    expect(browserNavExceptionMessage(new Error('Unexpected protocol error'), 'back')).toBe(
      '后退失败，请稍后重试',
    );
  });

  it('maps raw Chromium navigation failures to specific toasts', () => {
    expect(browserNavExceptionMessage(new Error('net::ERR_NAME_NOT_RESOLVED'), 'goto')).toBe(
      '无法访问该网址，请检查是否拼写正确',
    );
    expect(browserNavExceptionMessage(new Error('net::ERR_CERT_DATE_INVALID'), 'goto')).toBe(
      '该网站证书有问题，无法安全连接',
    );
    expect(browserNavExceptionMessage(new Error('net::ERR_CONNECTION_REFUSED'), 'reload')).toBe(
      '无法连接到该站点，请稍后重试或换一个站点',
    );
    expect(browserNavExceptionMessage(new Error('net::ERR_ABORTED'), 'goto')).toBe(
      '页面正在切换，请稍后再试',
    );
  });

  it('maps hibernated browser sessions to fresh-run guidance', () => {
    expect(browserNavExceptionMessage(new Error('browser not allocated: idle-timeout hibernated'), 'goto')).toBe(
      '当前浏览器已休眠，重新执行任务后再打开链接',
    );
    expect(browserNavExceptionMessage(new Error('browser not allocated: idle-timeout hibernated'), 'reload')).toBe(
      '当前浏览器已休眠，请重新执行任务',
    );
  });
});
