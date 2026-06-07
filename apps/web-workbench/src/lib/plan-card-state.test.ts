import { describe, expect, it } from 'vitest';
import { planProgressSummary } from './plan-card-state';

describe('planProgressSummary', () => {
  it('summarizes active plans', () => {
    expect(
      planProgressSummary([
        { status: 'done' },
        { status: 'running' },
        { status: 'pending' },
      ]),
    ).toEqual({
      total: 3,
      done: 1,
      failed: 0,
      running: 1,
      percent: 33,
      label: '1/3 阶段完成',
      tone: 'running',
    });
  });

  it('prioritizes failed plan state', () => {
    expect(
      planProgressSummary([
        { status: 'done' },
        { status: 'failed' },
        { status: 'running' },
      ]),
    ).toMatchObject({
      failed: 1,
      running: 1,
      percent: 33,
      label: '1/3 阶段完成 · 1 阶段失败',
      tone: 'failed',
    });
  });

  it('handles empty plans', () => {
    expect(planProgressSummary(null)).toEqual({
      total: 0,
      done: 0,
      failed: 0,
      running: 0,
      percent: 0,
      label: '等待计划步骤',
      tone: 'idle',
    });
  });
});
