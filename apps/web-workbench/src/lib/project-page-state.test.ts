// @vitest-environment happy-dom

import { loadAppShellPersonalProjects } from '@/components/AppShell';
import type { AppRouter } from '@/lib/trpc';
import type { inferRouterClient } from '@trpc/client';
import { describe, expect, it, vi } from 'vitest';
import {
  PROJECT_NAME_MAX_LENGTH,
  normalizeProjectName,
  normalizeProjectRows,
  projectCountSummary,
  projectLoadErrorCopy,
  projectNameState,
} from './project-page-state';

type ProjectsListQuery = inferRouterClient<AppRouter>['projects']['list']['query'];

const PERSONAL_PROJECT_RESPONSE = {
  projectId: 'prj_personal',
  name: ' Personal plan ',
  description: ' Legacy project ',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-02T00:00:00.000Z',
  taskCount: 3.8,
} as const;

const TEAM_PROJECT_RESPONSE = {
  projectId: 'prj_team',
  name: ' Team plan ',
  description: ' Organization project ',
  createdAt: '2026-08-03T00:00:00.000Z',
  updatedAt: '2026-08-04T00:00:00.000Z',
  taskCount: 5,
  scope: 'organization',
  organizationId: 'org_design',
  organizationName: ' Design ',
  memberRole: 'lead',
} as const;

describe('project page state helpers', () => {
  it('loads the AppShell collection through the no-input personal query and excludes team rows', async () => {
    const query = vi
      .fn<ProjectsListQuery>()
      .mockResolvedValue([PERSONAL_PROJECT_RESPONSE, TEAM_PROJECT_RESPONSE]);

    const projects = await loadAppShellPersonalProjects(query);

    expect(query.mock.calls).toEqual([[]]);
    expect(projects).toEqual([
      {
        projectId: 'prj_personal',
        name: 'Personal plan',
        description: 'Legacy project',
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-02T00:00:00.000Z',
        taskCount: 3,
        scope: 'personal',
        organizationId: null,
        organizationName: null,
        memberRole: null,
      },
    ]);
  });

  it('keeps a Task 12 team refresh separate from the AppShell personal collection', async () => {
    const query = vi
      .fn<ProjectsListQuery>()
      .mockResolvedValueOnce([PERSONAL_PROJECT_RESPONSE])
      .mockResolvedValueOnce([TEAM_PROJECT_RESPONSE]);

    const shellProjects = await loadAppShellPersonalProjects(query);
    const teamProjects = normalizeProjectRows(await query({ organizationId: 'org_design' }), {
      organizationId: 'org_design',
    });

    expect(query.mock.calls).toEqual([[], [{ organizationId: 'org_design' }]]);
    expect(shellProjects.map((project) => project.projectId)).toEqual(['prj_personal']);
    expect(teamProjects.map((project) => project.projectId)).toEqual(['prj_team']);
    expect(shellProjects.map((project) => project.projectId)).toEqual(['prj_personal']);
  });

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

  it('formats project load errors for user-facing surfaces', () => {
    expect(projectLoadErrorCopy('  Network Error  ')).toEqual({
      title: '项目暂时无法加载',
      body: 'Network Error',
    });
    expect(projectLoadErrorCopy('')).toEqual({
      title: '项目暂时无法加载',
      body: '请稍后重试，或刷新页面后再打开项目列表。',
    });
  });

  it('summarizes loading, failed, empty, and populated project lists', () => {
    expect(projectCountSummary({ count: 0, loading: true, error: null })).toBe('项目加载中…');
    expect(projectCountSummary({ count: 3, loading: true, error: null })).toBe(
      '正在刷新 3 个项目…',
    );
    expect(projectCountSummary({ count: 0, loading: false, error: 'offline' })).toBe(
      '项目暂时无法加载',
    );
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
        scope: 'personal',
        organizationId: null,
        organizationName: null,
        memberRole: null,
      },
      {
        projectId: 'proj_b',
        name: '未命名项目',
        description: null,
        createdAt: new Date(0),
        updatedAt: new Date(0),
        taskCount: 0,
        scope: 'personal',
        organizationId: null,
        organizationName: null,
        memberRole: null,
      },
    ]);
  });

  it('normalizes an organization project only with complete tenant metadata', () => {
    const raw = {
      projectId: ' prj_team ',
      name: ' Launch ',
      description: null,
      createdAt: '2026-08-10T00:00:00.000Z',
      updatedAt: '2026-08-11T00:00:00.000Z',
      taskCount: 4.9,
      scope: 'organization',
      organizationId: ' org_design ',
      organizationName: ' Design ',
      memberRole: 'lead',
    };

    const normalized = normalizeProjectRows([raw], { organizationId: 'org_design' });

    expect(normalized).toEqual([
      {
        projectId: 'prj_team',
        name: 'Launch',
        description: null,
        createdAt: '2026-08-10T00:00:00.000Z',
        updatedAt: '2026-08-11T00:00:00.000Z',
        taskCount: 4,
        scope: 'organization',
        organizationId: 'org_design',
        organizationName: 'Design',
        memberRole: 'lead',
      },
    ]);
    expect(normalized[0]).not.toBe(raw);
  });

  it('rejects malformed or cross-tenant organization project rows instead of downgrading them', () => {
    const inheritedTeam = Object.create({
      projectId: 'prj_inherited',
      name: 'Inherited',
      scope: 'organization',
      organizationId: 'org_design',
      memberRole: 'lead',
    });

    expect(
      normalizeProjectRows(
        [
          {
            projectId: 'prj_missing_org',
            name: 'Missing tenant',
            scope: 'organization',
            memberRole: 'lead',
          },
          {
            projectId: 'prj_bad_role',
            name: 'Truthy role',
            scope: 'organization',
            organizationId: 'org_design',
            memberRole: { lead: true },
          },
          {
            projectId: 'prj_other',
            name: 'Other tenant',
            scope: 'organization',
            organizationId: 'org_other',
            memberRole: 'viewer',
          },
          inheritedTeam,
        ],
        { organizationId: 'org_design' },
      ),
    ).toEqual([]);
  });
});
