import { describe, expect, it } from 'vitest';
import { humaniseTaskError, taskActionError } from './error-copy';

describe('error-copy', () => {
  it('hides raw English technical failures behind friendly copy', () => {
    expect(humaniseTaskError('connect ECONNREFUSED 127.0.0.1:9222')).toBe(
      '任务执行出错，请重试。如果反复出现请联系 support@holaday.ai。',
    );
  });

  it('formats action toasts with the humanised task error', () => {
    expect(taskActionError('发送失败', 'browser unavailable')).toBe(
      '发送失败：浏览器服务暂时不可用，请稍后重试。',
    );
  });

  it('maps extension timeouts to user-facing browser copy', () => {
    expect(humaniseTaskError('扩展工具调用超时（已等待 30 秒，请确认浏览器标签页仍在加载或重试）')).toBe(
      '浏览器响应超时，页面可能仍在加载。请稍后重试。',
    );
  });

  it('maps browser transport closures before the generic English fallback', () => {
    expect(humaniseTaskError('Protocol error (Page.navigate): Target closed')).toBe(
      '浏览器连接中断，请重新执行任务。',
    );
  });

  it('maps missing extension clients without internal mode names', () => {
    expect(humaniseTaskError('扩展未连接，无法走 Mode B')).toBe(
      '浏览器扩展未连接，请打开 HOLA DAY 扩展后重试。',
    );
    expect(humaniseTaskError('Could not establish connection. Receiving end does not exist.')).toBe(
      '浏览器扩展未连接，请打开 HOLA DAY 扩展后重试。',
    );
  });

  it('maps extension disconnects to reconnect guidance', () => {
    expect(humaniseTaskError('socket_closed: 浏览器扩展连接已断开')).toBe(
      '浏览器扩展连接已断开，请重新打开 HOLA DAY 扩展后重试。',
    );
    expect(humaniseTaskError('Unchecked runtime.lastError: The message port closed before a response was received.')).toBe(
      '浏览器扩展连接已断开，请重新打开 HOLA DAY 扩展后重试。',
    );
  });

  it('maps extension host permission failures to permission guidance', () => {
    expect(
      humaniseTaskError(
        'Cannot access contents of url "https://example.com/". Extension manifest must request permission.',
      ),
    ).toBe('浏览器扩展缺少当前网站权限，请在扩展里允许访问该网站后重试。');
  });

  it('maps invalid browser URLs without leaking schema jargon', () => {
    expect(humaniseTaskError('bad_args: expected http(s) URL')).toBe(
      '网址格式不支持，请使用 http(s) 开头的网页链接后重试。',
    );
  });

  it('maps missing active tab failures to an actionable browser hint', () => {
    expect(humaniseTaskError('浏览器当前没有活动标签页')).toBe(
      '浏览器当前没有活动标签页，请打开一个网页后重试。',
    );
  });

  it('maps raw Chromium navigation failures before the generic fallback', () => {
    expect(humaniseTaskError('net::ERR_NAME_NOT_RESOLVED at https://nope.example')).toBe(
      '无法访问该网址，请检查网址是否拼写正确。',
    );
    expect(humaniseTaskError('net::ERR_CERT_AUTHORITY_INVALID')).toBe(
      '该网站证书有问题，无法安全连接。请确认网址是否正确或换一个站点。',
    );
    expect(humaniseTaskError('net::ERR_CONNECTION_REFUSED')).toBe(
      '无法连接到该站点，请稍后重试或换一个站点。',
    );
  });

  it('maps hibernated browser sessions before the generic fallback', () => {
    expect(humaniseTaskError('browser not allocated: idle-timeout hibernated')).toBe(
      '浏览器已休眠，重新执行任务会打开新的浏览器。',
    );
  });
});
