import { describe, expect, it } from 'vitest';
import { taskListItemSubtitle } from './TaskListItem';

describe('taskListItemSubtitle', () => {
  it('uses the live phase label for executing tasks before step ticks arrive', () => {
    expect(
      taskListItemSubtitle(
        { status: 'executing', tickCount: 0 },
        'generating',
      ),
    ).toBe('正在生成回答');
    expect(
      taskListItemSubtitle(
        { status: 'executing', tickCount: 0 },
        'verifying',
      ),
    ).toBe('正在验证结果');
  });

  it('keeps the existing executing fallback when no live phase exists', () => {
    expect(taskListItemSubtitle({ status: 'executing', tickCount: 0 })).toBe(
      '正在启动…',
    );
    expect(taskListItemSubtitle({ status: 'executing', tickCount: 3 })).toBe(
      '执行中 · 第 3 步',
    );
  });
});
