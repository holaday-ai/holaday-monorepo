// @vitest-environment happy-dom

import type { AppRouter } from '@/lib/trpc';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { inferRouterClient } from '@trpc/client';
import type { inferRouterOutputs } from '@trpc/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { TeamProjectPage } from './TeamProjectPage';

type WorkspaceClient = inferRouterClient<AppRouter>;
type RouterOutputs = inferRouterOutputs<AppRouter>;
type TeamProjectOutput = RouterOutputs['projects']['get'];
type ProjectMembersOutput = RouterOutputs['projects']['members'];

const api = vi.hoisted(() => ({
  projectGet: vi.fn<WorkspaceClient['projects']['get']['query']>(),
  projectMembers: vi.fn<WorkspaceClient['projects']['members']['query']>(),
}));

const shell = vi.hoisted(() => ({
  teamProjectsEnabled: true,
  refreshProjects: vi.fn(),
}));

vi.mock('@/components/AppShell', async () => {
  const { Outlet } = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  const appShellContext = () => ({
    me: {
      userId: 'usr_current',
      email: 'viewer@example.test',
      phone: null,
      displayName: 'Viewer',
      plan: 'pro',
      multiUser: false,
      selectedRoles: [],
      role: 'user',
      videoEnabled: false,
      teamProjectsEnabled: shell.teamProjectsEnabled,
    },
    projects: [],
    refreshProjects: shell.refreshProjects,
  });
  return {
    AppShell: () => <Outlet context={appShellContext()} />,
    useAppShellContext: appShellContext,
  };
});

vi.mock('@/lib/trpc', () => ({
  trpc: {
    projects: {
      get: { query: api.projectGet },
      members: { query: api.projectMembers },
    },
  },
}));

const TEAM_PROJECT = {
  projectId: 'prj_team',
  name: '增长计划',
  description: '梳理团队下一阶段的发布节奏',
  createdAt: '2026-08-22T00:00:00.000Z',
  updatedAt: '2026-08-23T00:00:00.000Z',
  taskCount: 4,
  scope: 'organization',
  organizationId: 'org_design',
  organizationName: '设计团队',
  memberRole: 'viewer',
} satisfies TeamProjectOutput;

const PROJECT_MEMBERS: ProjectMembersOutput = [
  {
    projectMemberId: 'pmem_lead',
    userId: 'usr_lead',
    displayName: 'Lin',
    avatarUrl: null,
    role: 'lead',
  },
  {
    projectMemberId: 'pmem_viewer',
    userId: 'usr_current',
    displayName: 'Viewer',
    avatarUrl: null,
    role: 'viewer',
  },
];

function trpcError(code: 'NOT_FOUND' | 'FORBIDDEN' | 'UNAUTHORIZED'): Error {
  return Object.assign(new Error(code.toLowerCase()), { data: { code } });
}

beforeEach(() => {
  shell.teamProjectsEnabled = true;
  api.projectGet.mockReset().mockResolvedValue(TEAM_PROJECT);
  api.projectMembers.mockReset().mockResolvedValue(PROJECT_MEMBERS);
});

afterEach(cleanup);

function renderPage(projectId = 'prj_team'): void {
  render(
    <MemoryRouter initialEntries={[`/projects/${projectId}`]}>
      <Routes>
        <Route path="/projects/:projectId" element={<TeamProjectPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('TeamProjectPage normalized detail states', () => {
  it('starts project and member loads together, then shows overview, roster, and current role', async () => {
    let resolveProject: ((value: TeamProjectOutput) => void) | undefined;
    let resolveMembers: ((value: ProjectMembersOutput) => void) | undefined;
    api.projectGet.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveProject = resolve;
        }),
    );
    api.projectMembers.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveMembers = resolve;
        }),
    );

    renderPage();

    expect(screen.getByLabelText('项目详情加载中')).toBeTruthy();
    await waitFor(() => expect(api.projectGet).toHaveBeenCalledWith({ projectId: 'prj_team' }));
    expect(api.projectMembers).toHaveBeenCalledWith({ projectId: 'prj_team' });

    resolveProject?.(TEAM_PROJECT);
    resolveMembers?.(PROJECT_MEMBERS);

    expect(await screen.findByRole('heading', { name: '增长计划' })).toBeTruthy();
    expect(screen.getByText('设计团队')).toBeTruthy();
    expect(screen.getByText('梳理团队下一阶段的发布节奏')).toBeTruthy();
    expect(screen.getByRole('region', { name: '项目成员' })).toBeTruthy();
    expect(screen.getByText('Lin')).toBeTruthy();
    expect(screen.getByText('当前角色：仅查看')).toBeTruthy();
  });

  it('treats a malformed project payload as not found instead of rendering raw API state', async () => {
    api.projectGet.mockResolvedValue({
      projectId: 'prj_team',
      name: '不应显示',
      scope: 'organization',
      organizationId: 'org_design',
      memberRole: 'super-admin',
    } as never);

    renderPage();

    expect(await screen.findByRole('heading', { name: '找不到这个项目' })).toBeTruthy();
    expect(screen.queryByText('不应显示')).toBeNull();
  });

  it.each(['NOT_FOUND', 'FORBIDDEN', 'UNAUTHORIZED'] as const)(
    'fails closed without rendering detail after an initial hidden overview %s response',
    async (code) => {
      api.projectGet.mockRejectedValue(trpcError(code));

      renderPage();

      expect(await screen.findByRole('heading', { name: '找不到这个项目' })).toBeTruthy();
      expect(screen.queryByText('项目详情暂时无法加载')).toBeNull();
      expect(screen.queryByRole('region', { name: '项目概览' })).toBeNull();
      expect(screen.queryByRole('region', { name: '项目成员' })).toBeNull();
      expect(screen.queryByText('当前角色：仅查看')).toBeNull();
    },
  );

  it('shows a full detail error when the project has no prior normalized row', async () => {
    api.projectGet.mockRejectedValue(new Error('project offline'));

    renderPage();

    expect(await screen.findByText('项目详情暂时无法加载')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '增长计划' })).toBeNull();
  });

  it('shows an empty roster independently while keeping the project overview', async () => {
    api.projectMembers.mockResolvedValue([]);

    renderPage();

    expect(await screen.findByRole('heading', { name: '增长计划' })).toBeTruthy();
    expect(screen.getByText('项目还没有成员')).toBeTruthy();
  });

  it('shows member loading independently after the project overview is ready', async () => {
    let resolveMembers: ((value: ProjectMembersOutput) => void) | undefined;
    api.projectMembers.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveMembers = resolve;
        }),
    );

    renderPage();

    expect(await screen.findByRole('heading', { name: '增长计划' })).toBeTruthy();
    expect(screen.getByLabelText('项目成员加载中')).toBeTruthy();

    resolveMembers?.([]);
    expect(await screen.findByText('项目还没有成员')).toBeTruthy();
  });

  it('shows a member error independently while keeping the project overview', async () => {
    api.projectMembers.mockRejectedValue(new Error('members offline'));

    renderPage();

    expect(await screen.findByRole('heading', { name: '增长计划' })).toBeTruthy();
    expect(screen.getByText('项目成员暂时无法加载')).toBeTruthy();
  });

  it('keeps stale overview and roster rows visible after independent refresh failures', async () => {
    const user = userEvent.setup();
    api.projectGet
      .mockResolvedValueOnce(TEAM_PROJECT)
      .mockRejectedValueOnce(new Error('project offline'));
    api.projectMembers
      .mockResolvedValueOnce(PROJECT_MEMBERS)
      .mockRejectedValueOnce(new Error('members offline'));
    renderPage();
    expect(await screen.findByText('Lin')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '刷新项目详情' }));

    expect(await screen.findByText('项目概览更新失败，当前保留上次结果')).toBeTruthy();
    expect(screen.getByText('成员列表更新失败，当前保留上次结果')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '增长计划' })).toBeTruthy();
    expect(screen.getByText('Lin')).toBeTruthy();
  });

  it('clears stale overview and roster when a refreshed overview becomes unauthorized', async () => {
    const user = userEvent.setup();
    api.projectGet
      .mockResolvedValueOnce(TEAM_PROJECT)
      .mockRejectedValueOnce(trpcError('FORBIDDEN'));
    api.projectMembers.mockResolvedValue(PROJECT_MEMBERS);
    renderPage();
    expect(await screen.findByText('Lin')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '刷新项目详情' }));

    expect(await screen.findByRole('heading', { name: '找不到这个项目' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: '项目概览' })).toBeNull();
    expect(screen.queryByRole('region', { name: '项目成员' })).toBeNull();
    expect(screen.queryByText('Lin')).toBeNull();
    expect(screen.queryByText('当前角色：仅查看')).toBeNull();
  });

  it('invalidates the overview when the initial member request reports a hidden resource', async () => {
    api.projectMembers.mockRejectedValue(trpcError('UNAUTHORIZED'));

    renderPage();

    expect(await screen.findByRole('heading', { name: '找不到这个项目' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: '项目概览' })).toBeNull();
    expect(screen.queryByRole('region', { name: '项目成员' })).toBeNull();
    expect(screen.queryByText('当前角色：仅查看')).toBeNull();
  });

  it('clears stale overview and roster when a refreshed member request becomes hidden', async () => {
    const user = userEvent.setup();
    api.projectGet.mockResolvedValue(TEAM_PROJECT);
    api.projectMembers
      .mockResolvedValueOnce(PROJECT_MEMBERS)
      .mockRejectedValueOnce(trpcError('NOT_FOUND'));
    renderPage();
    expect(await screen.findByText('Lin')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '刷新项目详情' }));

    expect(await screen.findByRole('heading', { name: '找不到这个项目' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: '项目概览' })).toBeNull();
    expect(screen.queryByRole('region', { name: '项目成员' })).toBeNull();
    expect(screen.queryByText('Lin')).toBeNull();
  });

  it('keeps project-detail refresh and retry targets at least 44px tall', async () => {
    renderPage();

    const refresh = await screen.findByRole('button', { name: '刷新项目详情' });
    expect(refresh.classList.contains('h-11')).toBe(true);

    cleanup();
    api.projectGet.mockRejectedValue(new Error('project offline'));
    renderPage();

    const retry = await screen.findByRole('button', { name: '重新加载' });
    expect(retry.classList.contains('h-11')).toBe(true);
  });
});

describe('TeamProjectPage rollout and viewer boundaries', () => {
  it('is reached through the real App nested project-detail route', async () => {
    render(
      <MemoryRouter initialEntries={['/projects/prj_team']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: '增长计划' })).toBeTruthy();
    expect(api.projectGet).toHaveBeenCalledWith({ projectId: 'prj_team' });
    expect(api.projectMembers).toHaveBeenCalledWith({ projectId: 'prj_team' });
  });

  it('does not fetch or expose team detail while the rollout gate is off', async () => {
    shell.teamProjectsEnabled = false;

    renderPage();

    expect(await screen.findByRole('heading', { name: '找不到这个项目' })).toBeTruthy();
    expect(api.projectGet).not.toHaveBeenCalled();
    expect(api.projectMembers).not.toHaveBeenCalled();
  });

  it('keeps a viewer read-only and renders future team execution as explanatory copy only', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: '增长计划' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /重命名项目|删除项目|移除 Lin/ })).toBeNull();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByRole('button', { name: /团队任务|开始执行|新建任务/ })).toBeNull();
    const futureCopy = screen.getByText(
      '团队任务执行将在后续阶段开放。当前可先查看项目概览与成员。',
    );
    expect(futureCopy.tagName).toBe('P');
  });
});
