import { describe, expect, it } from 'vitest';
import {
  batchActiveIndexAfterRemove,
  batchCreateButtonLabel,
  batchCreateDisabled,
  batchPromptCountCopy,
  normalizeBatchCreateResult,
} from './batch-dialog-state';

describe('batch dialog state helpers', () => {
  it('keeps submit disabled while invalid, over limit, or busy', () => {
    expect(
      batchCreateDisabled({ submitting: false, promptCount: 0, overLimit: false }),
    ).toBe(true);
    expect(
      batchCreateDisabled({ submitting: false, promptCount: 3, overLimit: true }),
    ).toBe(true);
    expect(
      batchCreateDisabled({ submitting: true, promptCount: 3, overLimit: false }),
    ).toBe(true);
    expect(
      batchCreateDisabled({ submitting: false, promptCount: 3, overLimit: false }),
    ).toBe(false);
  });

  it('builds count copy with dedupe and limit warnings', () => {
    expect(
      batchPromptCountCopy({
        promptCount: 50,
        maxItems: 50,
        duplicateCount: 2,
        overLimit: true,
      }),
    ).toBe('50 / 50 · 已去重 2 项 · 超过上限 50 项');
  });

  it('names the busy submit state', () => {
    expect(batchCreateButtonLabel(false)).toBe('创建并开始');
    expect(batchCreateButtonLabel(true)).toBe('创建中…');
  });

  it('keeps the guided task card focused after removing cards', () => {
    expect(
      batchActiveIndexAfterRemove({ activeIndex: 0, removedIndex: 0, itemCount: 1 }),
    ).toBe(0);
    expect(
      batchActiveIndexAfterRemove({ activeIndex: 2, removedIndex: 2, itemCount: 4 }),
    ).toBe(1);
    expect(
      batchActiveIndexAfterRemove({ activeIndex: 3, removedIndex: 1, itemCount: 4 }),
    ).toBe(2);
    expect(
      batchActiveIndexAfterRemove({ activeIndex: 0, removedIndex: 3, itemCount: 4 }),
    ).toBe(0);
  });

  it('normalizes successful batch creation results', () => {
    expect(
      normalizeBatchCreateResult({
        batchId: ' batch_123 ',
        itemsTotal: 3,
        concurrency: 2,
      }),
    ).toEqual({
      batchId: 'batch_123',
      itemsTotal: 3,
      concurrency: 2,
    });
  });

  it('rejects malformed batch creation results before navigation', () => {
    expect(() => normalizeBatchCreateResult(null)).toThrow('结果暂时无法确认');
    expect(() =>
      normalizeBatchCreateResult({ batchId: '', itemsTotal: 3, concurrency: 2 }),
    ).toThrow('结果暂时无法确认');
    expect(() =>
      normalizeBatchCreateResult({ batchId: 'batch_123', itemsTotal: 0, concurrency: 2 }),
    ).toThrow('结果暂时无法确认');
  });
});
