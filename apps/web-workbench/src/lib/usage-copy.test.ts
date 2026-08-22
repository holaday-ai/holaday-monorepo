import { describe, expect, it } from 'vitest';
import {
  usageOutcomeLoadingSubcopy,
  usageOutcomeSubcopy,
  usageQuotaPolicyCopy,
} from './usage-copy';

describe('usageOutcomeSubcopy', () => {
  it('surfaces partial-success counts separately from hard failures', () => {
    expect(
      usageOutcomeSubcopy({
        partialSuccess: 2,
        failed: 1,
        cancelled: 0,
        executing: 3,
      }),
    ).toBe('需复核 2 · 失败 1 · 取消 0 · 进行中 3');
  });

  it('keeps failed and cancelled month counts separate', () => {
    expect(usageOutcomeSubcopy({ failed: 2, cancelled: 1, executing: 3 })).toBe(
      '失败 2 · 取消 1 · 进行中 3',
    );
  });

  it('keeps the visible outcome labels separate even when a caller omits cancelled', () => {
    expect(usageOutcomeSubcopy({ failed: 3, executing: 1 })).toBe('失败 3 · 取消 0 · 进行中 1');
  });

  it('explains quota consumption by submission instead of final success', () => {
    expect(usageQuotaPolicyCopy('metered')).toBe(
      '额度按任务提交计入；系统任务不计入。任务后续进入需复核、失败或取消，也会保留本次提交占用。',
    );
  });

  it('explains why production test accounts have execution records without quota usage', () => {
    expect(usageQuotaPolicyCopy('unmetered_test')).toBe(
      '当前为生产测试账号，任务执行记录会正常统计，但不会扣减套餐额度。',
    );
  });

  it('keeps the loading placeholder aligned with visible outcome categories', () => {
    expect(usageOutcomeLoadingSubcopy()).toBe('需复核 — · 失败 — · 取消 — · 进行中 —');
  });
});
