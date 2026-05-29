import { describe, expect, it } from 'vitest';
import { pageActionError, pageErrorMessage } from './page-error-copy';

describe('page-error-copy', () => {
  it('hides raw English technical errors on page surfaces', () => {
    expect(
      pageErrorMessage(new TypeError("Cannot read properties of undefined (reading 'id')")),
    ).toBe('任务执行出错，请重试。如果反复出现请联系 support@holaday.ai。');
  });

  it('uses browser-specific recovery copy for extension failures', () => {
    expect(
      pageActionError(
        '加载失败',
        'Unchecked runtime.lastError: The message port closed before a response was received.',
      ),
    ).toBe('加载失败：浏览器扩展连接已断开，请重新打开 HOLA DAY 扩展后重试。');
  });

  it('keeps localized validation messages intact', () => {
    expect(pageErrorMessage('项目名称不能为空')).toBe('项目名称不能为空');
  });

  it('falls back when the error is empty', () => {
    expect(pageActionError('保存失败', null)).toBe('保存失败：请稍后重试');
  });

  it('maps PayPal SDK failures to payment-specific copy', () => {
    expect(pageErrorMessage(new Error('PayPal SDK failed to load'))).toBe(
      'PayPal 加载失败，请刷新页面后重试。',
    );
  });
});
