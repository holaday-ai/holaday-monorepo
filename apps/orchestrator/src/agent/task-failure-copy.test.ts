import { describe, expect, it } from 'vitest';
import { friendlyTaskFailureReason } from './task-failure-copy.js';

describe('friendlyTaskFailureReason', () => {
  it('keeps known browser failures specific', () => {
    expect(
      friendlyTaskFailureReason(
        'failed',
        'Cannot access contents of url. Extension manifest must request permission.',
      ),
    ).toBe('浏览器扩展缺少当前网站权限。请在扩展里允许访问该网站后重试。');
  });

  it('keeps known quota and auth failures actionable', () => {
    expect(friendlyTaskFailureReason('failed', 'Anthropic API error: 429 too many requests')).toBe(
      'AI 服务当前繁忙（限速），请稍后再试。',
    );
    expect(friendlyTaskFailureReason('failed', 'missing ANTHROPIC_API_KEY')).toBe(
      'AI 服务未配置。请联系管理员检查部署。',
    );
  });

  it('does not leak raw English stack-like failures', () => {
    expect(
      friendlyTaskFailureReason(
        'failed',
        'TypeError: Cannot read properties of undefined\n    at runTask (file:///app/runner.js:10:2)',
      ),
    ).toBe('任务执行出错。请重试；如果反复出现，请联系 support@holaday.ai。');
  });

  it('turns supercar timeout sentinels into user-facing copy', () => {
    expect(
      friendlyTaskFailureReason('failed', 'VISION_GAVE_UP task timeout (600s) elapsed'),
    ).toBe('任务超时。可能原因：目标网站响应缓慢或被反爬拦截。建议：重试，或把任务描述简化后再试。');
  });

  it('does not leak unknown English technical failures', () => {
    expect(friendlyTaskFailureReason('failed', 'Unexpected protocol invariant violation')).toBe(
      '任务执行出错。请重试；如果反复出现，请联系 support@holaday.ai。',
    );
  });

  it('preserves non-technical localized reasons', () => {
    expect(friendlyTaskFailureReason('failed', '输入内容缺少店铺名称')).toBe(
      '任务执行失败：输入内容缺少店铺名称。建议：简化任务描述后重试。',
    );
  });
});
