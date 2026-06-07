import { describe, expect, it } from 'vitest';
import {
  historyEmptyCopy,
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
    expect(taskStatusLabel('planning')).toBe('规划中');
  });

  it('surfaces unknown statuses instead of dropping them', () => {
    expect(taskStatusLabel('archived')).toBe('archived');
    expect(taskStatusLabel('')).toBe('未知状态');
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
