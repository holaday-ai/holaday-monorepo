import { describe, expect, it } from 'vitest';
import {
  followUpParentReasonLabel,
  followUpTerminalGuardMessage,
} from './task-followup-copy.js';

describe('task follow-up copy', () => {
  it('uses review-needed language for partial-success follow-up eligibility', () => {
    expect(followUpTerminalGuardMessage()).toBe(
      '只能追问已完成/需复核/失败/取消的任务，正在执行的任务请用回复',
    );
  });

  it('labels partial-success parent context as review-needed instead of partial-complete', () => {
    expect(followUpParentReasonLabel('failed')).toBe('失败原因');
    expect(followUpParentReasonLabel('partial_success')).toBe('需复核原因');
    expect(followUpParentReasonLabel('cancelled')).toBe('终止原因');
  });
});
