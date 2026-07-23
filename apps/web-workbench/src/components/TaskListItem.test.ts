import { describe, expect, it } from 'vitest';
import type { UiTask } from '@/types/task';
import {
  taskDisplaySource,
  taskDisplayTitle,
  taskListElapsedLabel,
  taskListItemSubtitle,
} from './TaskListItem';

function task(overrides: Partial<UiTask> = {}): UiTask {
  return {
    taskId: 'tsk_sidebar',
    intent: '帮我整理今天的科技新闻',
    title: null,
    status: 'completed',
    tickCount: 3,
    createdAt: new Date('2026-07-23T00:00:00.000Z'),
    ...overrides,
  };
}

describe('taskDisplayTitle', () => {
  const lockedSubjectIntent = [
    '生成图片：让同一只西高地坐在海边。',
    '图片风格要求：电影感、柔和逆光。',
    '主体一致性要求：请以用户上传的第一张图片作为锁定主角。',
    '尽量保持主角身份、脸型五官和毛色不变。',
  ].join('\n\n');

  it('keeps the user image prompt but hides internal generation instructions', () => {
    const row = task({ intent: lockedSubjectIntent });

    expect(taskDisplaySource(row)).toBe('让同一只西高地坐在海边。');
    expect(taskDisplayTitle(row, 40)).toBe('让同一只西高地坐在海边。');
  });

  it('does not trust a generated title that contains only internal instructions', () => {
    const row = task({
      title: '主体一致性要求：请以用户上传的第一张图片作为锁定主角。',
      intent: lockedSubjectIntent,
    });

    expect(taskDisplayTitle(row, 40)).toBe('让同一只西高地坐在海边。');
  });

  it('removes image settings while preserving a normal user-created title', () => {
    expect(
      taskDisplayTitle(
        task({
          title: '夏日新品主视觉',
          intent: '生成一张图片：夏日新品主视觉。图片设置：模型 Nano Banana 2，比例 4:3。',
        }),
        40,
      ),
    ).toBe('夏日新品主视觉');

    expect(
      taskDisplayTitle(
        task({
          intent: '生成一张图片：夏日新品主视觉。图片设置：模型 Nano Banana 2，比例 4:3。',
        }),
        40,
      ),
    ).toBe('夏日新品主视觉。');
  });
});

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

  it('lets queued and waiting-user lifecycle override stale live phases', () => {
    expect(
      taskListItemSubtitle(
        {
          status: 'executing',
          tickCount: 0,
          queuePosition: 2,
        },
        'browsing',
      ),
    ).toBe('排队中 · 第 2 位');
    expect(
      taskListItemSubtitle(
        {
          status: 'executing',
          tickCount: 4,
          awaitingKind: 'login',
        },
        'browsing',
      ),
    ).toBe('需要登录');
  });

  it('does not present unknown statuses as executing', () => {
    expect(taskListItemSubtitle({ status: 'unknown', tickCount: 0 })).toBe(
      '未知状态',
    );
  });

  it('surfaces partial-success rows as review-needed instead of completed work', () => {
    expect(taskListItemSubtitle({ status: 'partial_success', tickCount: 0 })).toBe(
      '需复核',
    );
    expect(taskListItemSubtitle({ status: 'partial_success', tickCount: 4 })).toBe(
      '需复核 · 4 步',
    );
  });
});
