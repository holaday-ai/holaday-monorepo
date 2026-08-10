import { describe, expect, it } from 'vitest';
import { plannedSaveFeedback } from './planned-editor-state';

describe('planned editor schedule feedback', () => {
  it('names the effective time when a recurring schedule is advanced', () => {
    expect(
      plannedSaveFeedback({
        action: 'create',
        adjusted: true,
        nextRunAt: '2026-08-11T01:00:00.000Z',
        timezone: 'Asia/Shanghai',
      }),
    ).toBe('规划已创建，首次执行已调整为 08月11日 09:00');
  });

  it('keeps the existing quiet success copy when no adjustment occurred', () => {
    expect(
      plannedSaveFeedback({
        action: 'series',
        adjusted: false,
        nextRunAt: '2026-08-11T01:00:00.000Z',
        timezone: 'Asia/Shanghai',
      }),
    ).toBe('整个规划已保存');
  });
});
