import { describe, expect, it } from 'vitest';
import {
  PROJECT_NAME_MAX_LENGTH,
  normalizeProjectName,
  normalizeProjectRows,
  projectCountSummary,
  projectNameState,
} from './project-page-state';

describe('project page state helpers', () => {
  it('normalizes project names by trimming surrounding whitespace', () => {
    expect(normalizeProjectName('  Campaign plan  ')).toBe('Campaign plan');
  });

  it('rejects blank names', () => {
    const state = projectNameState('   ');

    expect(state.name).toBe('');
    expect(state.error).toBe('请输入项目名称');
    expect(state.canSubmit).toBe(false);
  });

  it('rejects names over the product limit', () => {
    const state = projectNameState('x'.repeat(PROJECT_NAME_MAX_LENGTH + 1));

    expect(state.length).toBe(PROJECT_NAME_MAX_LENGTH + 1);
    expect(state.remaining).toBe(-1);
    expect(state.error).toBe(`项目名称不能超过 ${PROJECT_NAME_MAX_LENGTH} 个字符`);
    expect(state.canSubmit).toBe(false);
  });

  it('rejects duplicate names case-insensitively after trimming', () => {
    const state = projectNameState('  launch ops  ', ['Launch Ops']);

    expect(state.name).toBe('launch ops');
    expect(state.error).toBe('已有同名项目');
    expect(state.canSubmit).toBe(false);
  });

  it('allows a unique project name', () => {
    const state = projectNameState('Research', ['Launch Ops']);

    expect(state.error).toBeNull();
    expect(state.canSubmit).toBe(true);
  });

  it('summarizes loading, failed, empty, and populated project lists', () => {
    expect(projectCountSummary({ count: 0, loading: true, error: null })).toBe('项目加载中…');
    expect(projectCountSummary({ count: 3, loading: true, error: null })).toBe(
      '正在刷新 3 个项目…',
    );
    expect(projectCountSummary({ count: 0, loading: false, error: 'offline' })).toBe('项目加载失败');
    expect(projectCountSummary({ count: 3, loading: false, error: 'offline' })).toBe(
      '共 3 个项目，上次刷新失败',
    );
    expect(projectCountSummary({ count: 0, loading: false, error: null })).toBe('尚无项目');
    expect(projectCountSummary({ count: 3, loading: false, error: null })).toBe('共 3 个项目');
  });

  it('normalizes project list rows before shell/menu rendering', () => {
    expect(
      normalizeProjectRows([
        null,
        {
          projectId: ' proj_a ',
          name: ' Launch ',
          description: ' Growth work ',
          createdAt: '2026-05-25T00:00:00.000Z',
          updatedAt: '2026-05-25T01:00:00.000Z',
          taskCount: 3.8,
        },
        {
          projectId: 'proj_b',
          name: { unsafe: true },
          description: { unsafe: true },
          createdAt: 'bad-date',
          updatedAt: Number.POSITIVE_INFINITY,
          taskCount: Number.NaN,
        },
        {
          projectId: '',
          name: 'missing id',
          taskCount: 2,
        },
      ]),
    ).toEqual([
      {
        projectId: 'proj_a',
        name: 'Launch',
        description: 'Growth work',
        createdAt: '2026-05-25T00:00:00.000Z',
        updatedAt: '2026-05-25T01:00:00.000Z',
        taskCount: 3,
      },
      {
        projectId: 'proj_b',
        name: '未命名项目',
        description: null,
        createdAt: new Date(0),
        updatedAt: new Date(0),
        taskCount: 0,
      },
    ]);
  });
});
