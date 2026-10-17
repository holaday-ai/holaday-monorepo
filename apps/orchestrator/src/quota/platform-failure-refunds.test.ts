import { describe, expect, it } from 'vitest';
import { platformFailureReason } from './platform-failure-refunds.js';

describe('platform failure refunds', () => {
  it.each([
    ['provider_error', null],
    ['EXECUTION_TIMEOUT', null],
    ['ORCHESTRATOR_RESTART', null],
    ['CORE_GENERATION_FAILED', null],
    ['REGION_SERVICE_NOT_CONFIGURED', null],
  ])('refunds a failed task caused by %s', (errorCode, errorMessage) => {
    expect(platformFailureReason({ status: 'failed', errorCode, errorMessage })).toBe(errorCode);
  });

  it('refunds core generation-only and local failures but not quality rejections', () => {
    const core = (errorMessage: string) =>
      platformFailureReason({ status: 'failed', errorCode: 'CORE_EXECUTION_FAILED', errorMessage });
    expect(core('生成未完成，请稍后重试')).toBe('CORE_PLATFORM_FAILURE');
    expect(core('系统繁忙，任务未能开始执行，请稍后重试。')).toBe('CORE_PLATFORM_FAILURE');
    expect(core('结果核验过程出错，未能保存结果，请重试。')).toBe('CORE_PLATFORM_FAILURE');
    expect(core('质量校验未通过')).toBeNull();
  });

  it('never refunds user cancellations, successes or content failures', () => {
    expect(
      platformFailureReason({
        status: 'cancelled',
        errorCode: 'EXECUTION_TIMEOUT',
        errorMessage: null,
      }),
    ).toBeNull();
    expect(
      platformFailureReason({ status: 'completed', errorCode: null, errorMessage: null }),
    ).toBeNull();
    expect(
      platformFailureReason({ status: 'failed', errorCode: 'CONTENT_POLICY', errorMessage: null }),
    ).toBeNull();
  });
});
