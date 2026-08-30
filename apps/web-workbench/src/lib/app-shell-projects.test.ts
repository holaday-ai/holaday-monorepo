import type { AppRouter } from '@/lib/trpc';
import type { inferRouterClient } from '@trpc/client';
import { describe, expect, it, vi } from 'vitest';
import { loadAppShellPersonalProjects } from './app-shell-projects';

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

describe('AppShell personal project loading', () => {
  it('uses the no-input AppRouter query and excludes normalized team rows', async () => {
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
});
