import { describe, expect, it } from 'vitest';
import {
  extensionNoClientMessage,
  extensionSocketClosedMessage,
  extensionToolTimeoutMessage,
} from './extension-tool-copy.js';

describe('extension tool copy', () => {
  it('keeps missing-extension errors user-facing', () => {
    expect(extensionNoClientMessage()).toBe('浏览器扩展未连接，请打开 HOLA DAY 扩展后重试');
  });

  it('keeps mid-call disconnect errors actionable', () => {
    expect(extensionSocketClosedMessage()).toBe('浏览器扩展连接已断开，请重新打开 HOLA DAY 扩展后重试');
  });

  it('keeps timeout errors free of tool-call jargon', () => {
    expect(extensionToolTimeoutMessage(30_000)).toBe(
      '浏览器扩展响应超时（已等待 30 秒）。页面可能仍在加载，请稍后重试',
    );
  });
});
