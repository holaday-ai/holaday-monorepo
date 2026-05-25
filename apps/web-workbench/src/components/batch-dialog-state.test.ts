import { describe, expect, it } from 'vitest';
import {
  batchCreateButtonLabel,
  batchCreateDisabled,
  batchPromptCountCopy,
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
});
