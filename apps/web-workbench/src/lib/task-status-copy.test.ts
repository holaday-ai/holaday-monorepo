import { describe, expect, it } from 'vitest';
import {
  historyEmptyCopy,
  pausedTaskNoticeCopy,
  taskSearchEmptyCopy,
  taskStatusLabel,
} from './task-status-copy';

describe('taskStatusLabel', () => {
  it('covers terminal and active task statuses', () => {
    expect(taskStatusLabel('completed')).toBe('已完成');
    expect(taskStatusLabel('partial_success')).toBe('部分完成');
    expect(taskStatusLabel('awaiting_user')).toBe('需要你回复');
    expect(taskStatusLabel('awaiting_user', 'login')).toBe('需要登录');
    expect(taskStatusLabel('awaiting_user', 'browser_action')).toBe('需要确认');
    expect(taskStatusLabel('executing', 'login')).toBe('需要登录');
    expect(taskStatusLabel('completed', 'login')).toBe('已完成');
    expect(taskStatusLabel('planning')).toBe('规划中');
    expect(taskStatusLabel('unknown')).toBe('未知状态');
  });

  it('surfaces unknown statuses instead of dropping them', () => {
    expect(taskStatusLabel('archived')).toBe('archived');
    expect(taskStatusLabel('')).toBe('未知状态');
  });
});

describe('pausedTaskNoticeCopy', () => {
  it('keeps paused copy recoverable and preserves the backend reason', () => {
    expect(pausedTaskNoticeCopy('达到最大步骤数，请确认下一步。')).toEqual({
      title: '任务已暂停',
      body: '达到最大步骤数，请确认下一步。',
      hint: '当前进度已保留，可以补充说明或稍后继续处理。',
    });
  });

  it('uses neutral fallback copy when no reason is available', () => {
    expect(pausedTaskNoticeCopy()).toEqual({
      title: '任务已暂停',
      body: '执行已暂停，当前进度已保留。',
      hint: '可以补充说明或稍后继续处理。',
    });
  });
});

describe('historyEmptyCopy', () => {
  it('uses an onboarding empty state without filters', () => {
    expect(historyEmptyCopy({ query: '', status: 'all', range: 'all' })).toEqual({
      title: '还没有历史任务',
      body: '开始一个任务后，执行记录会出现在这里。',
    });
  });

  it('uses query-specific empty copy when searching', () => {
    expect(historyEmptyCopy({ query: '竞品', status: 'all', range: '30d' }).title).toBe(
      '没有找到匹配任务',
    );
  });
});

describe('taskSearchEmptyCopy', () => {
  it('separates loading, error, and empty results', () => {
    expect(taskSearchEmptyCopy({ query: 'a', searching: true, error: false }).title).toBe(
      '正在搜索…',
    );
    expect(taskSearchEmptyCopy({ query: 'a', searching: false, error: true }).title).toBe(
      '搜索失败',
    );
    expect(taskSearchEmptyCopy({ query: 'a', searching: false, error: false }).title).toBe(
      '没有匹配的任务',
    );
  });
});
