import { describe, expect, it } from 'vitest';
import { taskListElapsedLabel, taskListItemSubtitle } from './TaskListItem';

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

  it('adds a long-running hint to live task subtitles after two minutes', () => {
    expect(
      taskListItemSubtitle(
        { status: 'executing', tickCount: 4 },
        { subStatus: 'browsing', since: 1_000 },
        121_000,
      ),
    ).toBe('正在操作浏览器 · 已运行 2分+');
    expect(
      taskListItemSubtitle(
        { status: 'executing', tickCount: 4 },
        { subStatus: 'extracting', since: 1_000 },
        301_000,
      ),
    ).toBe('正在提取数据 · 已运行 5分+');
  });

  it('keeps the live task elapsed badge quiet for short runs', () => {
    expect(taskListElapsedLabel({ subStatus: 'browsing', since: 1_000 }, 60_000)).toBeNull();
    expect(taskListElapsedLabel({ subStatus: 'browsing', since: 1_000 }, 121_000)).toBe('2分+');
  });

  it('keeps the existing executing fallback when no live phase exists', () => {
    expect(taskListItemSubtitle({ status: 'executing', tickCount: 0 })).toBe(
      '正在启动…',
    );
    expect(taskListItemSubtitle({ status: 'executing', tickCount: 3 })).toBe(
      '执行中 · 第 3 步',
    );
  });

  it('uses the awaiting kind in task rows so action-needed tasks are scannable', () => {
    expect(
      taskListItemSubtitle({
        status: 'awaiting_user',
        tickCount: 4,
        awaitingKind: 'login',
      }),
    ).toBe('需要登录');
    expect(
      taskListItemSubtitle({
        status: 'awaiting_user',
        tickCount: 4,
        awaitingKind: 'captcha',
      }),
    ).toBe('需要验证');
    expect(
      taskListItemSubtitle({
        status: 'awaiting_user',
        tickCount: 4,
      }),
    ).toBe('需要你回复');
  });
});
