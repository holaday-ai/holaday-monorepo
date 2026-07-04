import { describe, expect, it } from 'vitest';
import {
  batchConfirmActionLabel,
  batchConfirmQuestion,
  batchConfirmSummary,
  singleConfirmActionLabel,
  singleConfirmQuestion,
  singleConfirmSummary,
} from './batch-confirm-copy';

describe('batch-confirm copy', () => {
  it('formats the batch question with a human 1-based index', () => {
    expect(
      batchConfirmQuestion({
        stepId: 'stp_batch',
        batchIndex: 2,
        batchTotal: 3,
        risk: 'high',
        summary: '回复 5 条差评',
        items: [{ label: '评论 #1', preview: '您好，感谢反馈。' }],
      }),
    ).toBe('确认第 2/3 批：回复 5 条差评');
  });

  it('keeps zero-based server indexes readable', () => {
    expect(
      batchConfirmQuestion({
        stepId: 'stp_batch',
        batchIndex: 0,
        batchTotal: 4,
        risk: 'medium',
        items: [{ label: '评论 #1', preview: '您好，感谢反馈。' }],
      }),
    ).toBe('确认第 1/4 批');
  });

  it('summarizes risk and item count without hiding the decision', () => {
    expect(
      batchConfirmSummary({
        stepId: 'stp_batch',
        batchIndex: 1,
        batchTotal: 1,
        risk: 'high',
        items: [
          { label: '评论 #1', preview: '您好，感谢反馈。' },
          { label: '评论 #2', preview: '抱歉体验不佳。' },
        ],
      }),
    ).toBe('高风险操作 · 2 项待确认');
    expect(batchConfirmActionLabel('approve')).toBe('确认执行');
    expect(batchConfirmActionLabel('skip')).toBe('跳过本批');
    expect(batchConfirmActionLabel('reject')).toBe('取消任务');
  });

  it('formats single-step confirmations as an explicit user decision', () => {
    const confirm = {
      stepId: 'stp_submit',
      prompt: '请确认是否继续：点击提交按钮。',
      risk: 'high' as const,
    };
    expect(singleConfirmQuestion(confirm)).toBe('请确认是否继续：点击提交按钮。');
    expect(singleConfirmSummary(confirm)).toBe('高风险操作 · 需要你确认后继续');
    expect(singleConfirmActionLabel('approve')).toBe('我已确认，继续');
    expect(singleConfirmActionLabel('reject')).toBe('取消任务');
  });
});
