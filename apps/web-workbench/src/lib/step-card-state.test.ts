import { describe, expect, it } from 'vitest';
import { stepDetailSummary, stepStatusLabel, stepStatusText } from './step-card-state';

describe('step-card-state', () => {
  it('summarizes mixed detail steps for the collapsed detail toggle', () => {
    expect(
      stepDetailSummary([
        { status: 'done' },
        { status: 'running' },
        { status: 'failed' },
        { status: 'cancelled' },
      ]),
    ).toEqual({
      total: 4,
      done: 1,
      failed: 1,
      running: 1,
      cancelled: 1,
      label: '1/4 步完成 · 1 执行中 · 1 失败 · 1 取消',
      tone: 'failed',
    });
  });

  it('treats a cancelled-only terminal list as cancelled, not failed', () => {
    expect(
      stepDetailSummary([
        { status: 'done' },
        { status: 'cancelled' },
      ]),
    ).toMatchObject({
      label: '1/2 步完成 · 1 取消',
      tone: 'cancelled',
    });
  });

  it('provides localized status labels for step badges', () => {
    expect(stepStatusText('running')).toBe('执行中');
    expect(stepStatusLabel('failed', 2)).toBe('步骤 3 · 失败');
  });
});
