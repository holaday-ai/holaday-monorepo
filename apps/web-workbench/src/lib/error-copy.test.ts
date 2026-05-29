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
  });
});
