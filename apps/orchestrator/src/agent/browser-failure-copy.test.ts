import { describe, expect, it } from 'vitest';
import { friendlyBrowserFailureReason } from './browser-failure-copy.js';

describe('friendlyBrowserFailureReason', () => {
  it('normalizes missing extension runtime errors', () => {
    expect(
      friendlyBrowserFailureReason(
        'Could not establish connection. Receiving end does not exist.',
      ),
    ).toBe('浏览器扩展未连接。请打开 HOLA DAY 扩展后重试。');
    expect(friendlyBrowserFailureReason('浏览器扩展未连接，请打开 HOLA DAY 扩展后重试')).toBe(
      '浏览器扩展未连接。请打开 HOLA DAY 扩展后重试。',
    );
  });

  it('normalizes extension host permission errors', () => {
    expect(
      friendlyBrowserFailureReason(
        'Cannot access contents of url "https://example.com/". Extension manifest must request permission.',
      ),
    ).toBe('浏览器扩展缺少当前网站权限。请在扩展里允许访问该网站后重试。');
  });

  it('normalizes closed message ports as extension disconnects', () => {
    expect(friendlyBrowserFailureReason('The message port closed before a response was received.')).toBe(
      '浏览器扩展连接已断开。请重新打开 HOLA DAY 扩展后重试。',
    );
  });

  it('normalizes hibernated and raw browser session failures', () => {
    expect(friendlyBrowserFailureReason('browser not allocated: idle-timeout hibernated')).toBe(
      '浏览器已休眠。重新执行任务会打开新的浏览器。',
    );
    expect(friendlyBrowserFailureReason('Protocol error (Page.navigate): Target closed')).toBe(
      '浏览器连接中断。请重新执行任务。',
    );
  });

  it('returns null for unrelated application errors', () => {
    expect(friendlyBrowserFailureReason('missing ANTHROPIC_API_KEY')).toBeNull();
  });
});
