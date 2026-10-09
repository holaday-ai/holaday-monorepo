// @vitest-environment happy-dom

import { ToastProvider } from '@/components/ui/toast';
import { clearAccessToken } from '@/lib/auth';
import type { AppRouter } from '@/lib/trpc';
import { ProjectsPage } from '@/pages/ProjectsPage';
import { useTaskStore } from '@/stores/task-store';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { inferRouterClient } from '@trpc/client';
import type { inferRouterOutputs } from '@trpc/server';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from './AppShell';

type Client = inferRouterClient<AppRouter>;
type RouterOutputs = inferRouterOutputs<AppRouter>;

async function chooseWorkspace(user: ReturnType<typeof userEvent.setup>, name: RegExp | string) {
  await user.click(screen.getByTitle('切换工作区'));
  await user.click(await screen.findByRole('menuitem', { name }));
}

const api = vi.hoisted(() => ({
  logout: vi.fn(),
  authMe: vi.fn<Client['auth']['me']['query']>(),
  unsuccessfulCount: vi.fn<Client['tasks']['unsuccessfulCount']['query']>(),
  tasksList: vi.fn<Client['tasks']['list']['query']>(),
  organizationsList: vi.fn<Client['organizations']['list']['query']>(),
  organizationMembers: vi.fn<Client['organizations']['members']['query']>(),
  projectsList: vi.fn<Client['projects']['list']['query']>(),
}));

vi.mock('@/lib/auth', () => ({
  clearAccessToken: vi.fn(),
  getAccessToken: () => 'integration-token',
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    auth: { me: { query: api.authMe }, logout: { mutate: api.logout } },
    tasks: {
      unsuccessfulCount: { query: api.unsuccessfulCount },
      list: { query: api.tasksList },
    },
    organizations: {
      list: { query: api.organizationsList },
      members: { query: api.organizationMembers },
    },
    projects: { list: { query: api.projectsList } },
  },
}));

vi.mock('@/lib/ws', () => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  onServerMessage: () => () => undefined,
  onStatus: (listener: (status: 'idle') => void) => {
    listener('idle');
    return () => undefined;
  },
}));

vi.mock('@/components/ConfirmDialog', () => ({ ConfirmDialog: () => null }));
vi.mock('@/components/FeedbackDialog', () => ({ FeedbackDialog: () => null }));
vi.mock('@/components/LoginGate', () => ({ LoginGate: () => null }));
vi.mock('@/components/notifications/NotificationBell', () => ({ NotificationBell: () => null }));
vi.mock('@/components/QuotaIndicator', () => ({ QuotaIndicator: () => null }));
vi.mock('@/components/SearchOverlay', () => ({ SearchOverlay: () => null }));
vi.mock('@/components/Skeleton', () => ({ AppSkeleton: () => <div>启动中</div> }));
vi.mock('@/components/UpdateBanner', () => ({ UpdateBanner: () => null }));
vi.mock('@/components/UserMenu', () => ({
  UserMenu: ({ onLogout }: { onLogout: () => void }) => (
    <button type="button" onClick={onLogout}>测试退出登录</button>
  ),
}));

const AUTH_ME = {
  userId: 'usr_current',
  email: 'owner@example.test',
  phone: null,
  displayName: 'Owner',
  avatarUrl: null,
  plan: 'pro',
  planExpiresAt: null,
  multiUser: false,
  selectedRoles: [],
  role: 'user',
  videoEnabled: false,
  mediaModels: { image: [], video: [], petVideo: [] },
  teamProjectsEnabled: true,
  teamTaskLifecycleEnabled: false,
  modelDataRegion: null,
} satisfies RouterOutputs['auth']['me'];

const PERSONAL_PROJECT = {
  projectId: 'prj_personal',
  name: '个人研究',
  description: '个人项目',
  createdAt: '2026-08-20T00:00:00.000Z',
  updatedAt: '2026-08-21T00:00:00.000Z',
  taskCount: 1,
} satisfies RouterOutputs['projects']['list'][number];

const ORGANIZATION = {
  organizationId: 'org_design',
  name: '设计团队',
  role: 'owner',
  managerDisplayName: null,
  activeMemberCount: 1,
  modelDataRegion: null,
} satisfies RouterOutputs['organizations']['list'][number];

const TEAM_PROJECT = {
  projectId: 'prj_team',
  name: '团队增长',
  description: '团队项目',
  createdAt: '2026-08-22T00:00:00.000Z',
  updatedAt: '2026-08-23T00:00:00.000Z',
  taskCount: 0,
  scope: 'organization',
  organizationId: 'org_design',
  organizationName: '设计团队',
  memberRole: 'lead',
} satisfies RouterOutputs['projects']['get'];

const TASKS = {
  tasks: [
    {
      executionId: null,
      executionRevision: 0,
      taskId: 'tsk_personal',
      intent: '整理个人研究',
      title: '个人项目任务',
      status: 'completed',
      awaitingKind: null,
      awaitingQuestion: null,
      pauseReason: null,
      errorCode: null,
      errorMessage: null,
      result: { summary: '完成' },
      starred: false,
      starredAt: null,
      projectId: 'prj_personal',
      createdAt: '2026-08-30T00:00:00.000Z',
      updatedAt: '2026-08-30T00:01:00.000Z',
      completedAt: '2026-08-30T00:01:00.000Z',
      verificationPassed: true,
      failureLevel: null,
      stockContext: null,
    },
  ],
  nextCursor: null,
} satisfies RouterOutputs['tasks']['list'];

beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset();
  useTaskStore.getState().reset();
  api.authMe.mockResolvedValue(AUTH_ME);
  api.unsuccessfulCount.mockResolvedValue({ count: 0 });
  api.tasksList.mockResolvedValue(TASKS);
  api.organizationsList.mockResolvedValue([ORGANIZATION]);
  api.organizationMembers.mockResolvedValue([]);
  api.projectsList.mockImplementation((input) =>
    Promise.resolve(input?.organizationId ? [TEAM_PROJECT] : [PERSONAL_PROJECT]),
  );
});

afterEach(() => {
  cleanup();
  useTaskStore.getState().reset();
});

describe('AppShell personal project collection isolation', () => {
  it('keeps the Sidebar filter and move menu personal after ProjectsPage refreshes a team workspace', async () => {
    const user = userEvent.setup();
    const router = createMemoryRouter(
      [
        {
          element: <AppShell />,
          children: [
            { path: '/', element: <main>任务工作台</main> },
            { path: '/projects', element: <ProjectsPage /> },
          ],
        },
      ],
      { initialEntries: ['/projects'] },
    );

    render(
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>,
    );

    await screen.findByRole('button', { name: '打开项目 个人研究' });
    await chooseWorkspace(user, /设计团队/);
    await screen.findByText('团队增长');

    await act(async () => {
      await router.navigate('/?project=prj_personal');
    });

    expect(await screen.findByText('项目：个人研究')).toBeTruthy();
    await user.click(await screen.findByRole('button', { name: '任务菜单' }));
    const moveToProject = await screen.findByRole('menuitem', { name: '移到项目' });
    await user.hover(moveToProject);

    expect(await screen.findByRole('menuitem', { name: '个人研究' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: '团队增长' })).toBeNull();
  });
});

describe('approved sidebar disclosure', () => {
  it('opens Projects from another page, toggles the whole row, and keeps global task history', async () => {
    const user = userEvent.setup();
    const router = createMemoryRouter(
      [
        {
          element: <AppShell />,
          children: [
            { path: '/files', element: <main>文件库内容</main> },
            { path: '/projects', element: <main>项目内容</main> },
            { path: '/', element: <main>任务工作台</main> },
          ],
        },
      ],
      { initialEntries: ['/files'] },
    );
    render(
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>,
    );
    const projects = await screen.findByRole('button', { name: '项目' });
    await user.click(projects);
    expect(router.state.location.pathname).toBe('/projects');
    expect(projects.getAttribute('aria-expanded')).toBe('true');
    expect(await screen.findByRole('button', { name: '个人研究' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '文件库' }).getAttribute('data-active')).toBe(
      'false',
    );
    await user.click(projects);
    expect(projects.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('button', { name: '个人研究' })).toBeNull();
    await user.click(projects);
    expect(projects.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: '个人项目任务' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '个人研究' }));
    expect(router.state.location.search).toBe('?project=prj_personal');
  });
});

describe('approved shell review navigation', () => {
  it.each([
    ['设置', '/settings'],
    ['本月用量', '/usage'],
  ])('routes %s through the application router', async (label, path) => {
    const user = userEvent.setup();
    const router = createMemoryRouter(
      [
        {
          element: <AppShell />,
          children: [
            { path: '/files', element: <main>文件库内容</main> },
            { path: '/settings', element: <main>设置内容</main> },
            { path: '/usage', element: <main>用量内容</main> },
          ],
        },
      ],
      { initialEntries: ['/files'] },
    );
    render(
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>,
    );
    await user.click(await screen.findByTitle('更多操作'));
    await user.click(await screen.findByRole('menuitem', { name: label }));
    expect(router.state.location.pathname).toBe(path);
    expect(screen.queryByRole('menuitem', { name: label })).toBeNull();
  });

  it('shows the energy breadcrumb on the actual cosmic route', async () => {
    const router = createMemoryRouter(
      [{ element: <AppShell />, children: [{ path: '/cosmic', element: <main>能量内容</main> }] }],
      { initialEntries: ['/cosmic'] },
    );
    render(
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>,
    );
    await screen.findByText('能量内容');
    expect(
      screen.getByText('今日能量', { selector: '.hd-workbench-breadcrumb strong' }),
    ).toBeTruthy();
  });
});

it('replaces load more with an honest visible-task limit message', async () => {
  const router = createMemoryRouter(
    [{ element: <AppShell />, children: [{ path: '/files', element: <main>文件库内容</main> }] }],
    { initialEntries: ['/files'] },
  );
  render(
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>,
  );
  await screen.findByText('文件库内容');
  act(() =>
    useTaskStore.setState({
      tasksHasMore: true,
      tasksCursor: 301,
      tasksVisiblePageLimitReached: true,
    }),
  );
  expect(screen.getByText('没有更多可见任务')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '加载更多任务' })).toBeNull();
});

describe('D10 server logout', () => {
  it('waits for revocation before clearing local credentials', async () => {
    vi.mocked(clearAccessToken).mockClear();
    let revoke!: () => void;
    api.logout.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          revoke = resolve;
        }),
    );
    const router = createMemoryRouter([
      { element: <AppShell />, children: [{ path: '/', element: <main>任务</main> }] },
    ]);
    render(
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>,
    );
    await userEvent.click(await screen.findByRole('button', { name: '测试退出登录' }));
    expect(api.logout).toHaveBeenCalledTimes(1);
    expect(clearAccessToken).not.toHaveBeenCalled();
    await act(async () => revoke());
    expect(clearAccessToken).toHaveBeenCalledTimes(1);
  });
  it('keeps credentials available for retry if server revocation fails', async () => {
    vi.mocked(clearAccessToken).mockClear();
    api.logout.mockRejectedValue(new Error('synthetic outage'));
    const router = createMemoryRouter([
      { element: <AppShell />, children: [{ path: '/', element: <main>任务</main> }] },
    ]);
    render(
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>,
    );
    await userEvent.click(await screen.findByRole('button', { name: '测试退出登录' }));
    expect(await screen.findByText('退出未完成，请重试。')).toBeTruthy();
    expect(clearAccessToken).not.toHaveBeenCalled();
  });
});
