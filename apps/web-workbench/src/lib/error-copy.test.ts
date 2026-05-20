import { describe, expect, it } from 'vitest';
import { humaniseTaskError, taskActionError } from './error-copy';

describe('error-copy', () => {
  it('hides raw English technical failures behind friendly copy', () => {
    expect(humaniseTaskError('connect ECONNREFUSED 127.0.0.1:9222')).toBe(
      '任务执行出错，请重试。如果反复出现请联系 sales@holaday.ai。',
    );
  });

  it('formats action toasts with the humanised task error', () => {
    expect(taskActionError('发送失败', 'browser unavailable')).toBe(
      '发送失败：浏览器服务暂时不可用，请稍后重试。',
    );
  });
});
