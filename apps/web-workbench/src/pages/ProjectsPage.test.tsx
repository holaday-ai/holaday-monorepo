// @vitest-environment happy-dom

import { ToastProvider } from '@/components/ui/toast';
import type { AppRouter } from '@/lib/trpc';
import type { UiProject } from '@/types/task';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { inferRouterClient } from '@trpc/client';
import type { inferRouterOutputs } from '@trpc/server';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectsPage } from './ProjectsPage';

type WorkspaceClient = inferRouterClient<AppRouter>;
type RouterOutputs = inferRouterOutputs<AppRouter>;
type OrganizationListOutput = RouterOutputs['organizations']['list'];
type OrganizationMembersOutput = RouterOutputs['organizations']['members'];
type InvitationOutput = RouterOutputs['organizations']['createInvitation'];
type ProjectListOutput = RouterOutputs['projects']['list'];
type TeamProjectOutput = RouterOutputs['projects']['get'];

const api = vi.hoisted(() => ({
  organizationsList: vi.fn<WorkspaceClient['organizations']['list']['query']>(),
  organizationsCreate: vi.fn<WorkspaceClient['organizations']['create']['mutate']>(),
  organizationMembers: vi.fn<WorkspaceClient['organizations']['members']['query']>(),
  createInvitation: vi.fn<WorkspaceClient['organizations']['createInvitation']['mutate']>(),
  updateReportingLine: vi.fn<WorkspaceClient['organizations']['updateReportingLine']['mutate']>(),
  updateMemberRole: vi.fn<WorkspaceClient['organizations']['updateMemberRole']['mutate']>(),
  deactivateMember: vi.fn<WorkspaceClient['organizations']['deactivateMember']['mutate']>(),
  projectsList: vi.fn<WorkspaceClient['projects']['list']['query']>(),
  projectsCreate: vi.fn<WorkspaceClient['projects']['create']['mutate']>(),
  projectsDelete: vi.fn<WorkspaceClient['projects']['delete']['mutate']>(),
}));

const shell = vi.hoisted(() => ({
  teamProjectsEnabled: false,
  projects: [] as UiProject[],
  refreshProjects: vi.fn(),
}));

vi.mock('@/components/AppShell', () => ({
  useAppShellContext: () => ({
    me: {
      userId: 'usr_current',
      email: 'owner@example.test',
      phone: null,
      displayName: 'Owner',
      plan: 'pro',
      multiUser: false,
      selectedRoles: [],
      role: 'user',
      videoEnabled: false,
      teamProjectsEnabled: shell.teamProjectsEnabled,
    },
    projects: shell.projects,
    refreshProjects: shell.refreshProjects,
  }),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    organizations: {
      list: { query: api.organizationsList },
      create: { mutate: api.organizationsCreate },
      members: { query: api.organizationMembers },
      createInvitation: { mutate: api.createInvitation },
      updateReportingLine: { mutate: api.updateReportingLine },
      updateMemberRole: { mutate: api.updateMemberRole },
      deactivateMember: { mutate: api.deactivateMember },
    },
    projects: {
      list: { query: api.projectsList },
      create: { mutate: api.projectsCreate },
      delete: { mutate: api.projectsDelete },
    },
  },
}));

const PERSONAL_PROJECT: UiProject = {
  projectId: 'prj_personal',
  name: '个人研究',
  description: '保留原来的个人项目卡片',
  createdAt: '2026-08-20T00:00:00.000Z',
  updatedAt: '2026-08-21T00:00:00.000Z',
  taskCount: 3,
  scope: 'personal',
  organizationId: null,
  organizationName: null,
  memberRole: null,
};

const ORGANIZATION_FIXTURES = {
  owner: {
    organizationId: 'org_design',
    name: '设计团队',
    role: 'owner',
    managerDisplayName: null,
    activeMemberCount: 3,
  },
  admin: {
    organizationId: 'org_design',
    name: '设计团队',
    role: 'admin',
    managerDisplayName: 'Owner',
    activeMemberCount: 3,
  },
  manager: {
    organizationId: 'org_design',
    name: '设计团队',
    role: 'manager',
    managerDisplayName: 'Owner',
    activeMemberCount: 3,
  },
  member: {
    organizationId: 'org_design',
    name: '设计团队',
    role: 'member',
    managerDisplayName: 'Manager',
    activeMemberCount: 3,
  },
} as const satisfies Record<string, OrganizationListOutput[number]>;

const ORGANIZATION_MEMBERS: OrganizationMembersOutput = [
  {
    memberId: 'omem_owner',
    userId: 'usr_owner',
    displayName: 'Owner',
    avatarUrl: null,
    role: 'owner',
    managerUserId: null,
    managerDisplayName: null,
    status: 'active',
  },
  {
    memberId: 'omem_manager',
    userId: 'usr_manager',
    displayName: 'Manager',
    avatarUrl: null,
    role: 'manager',
    managerUserId: 'usr_owner',
    managerDisplayName: 'Owner',
    status: 'active',
  },
  {
    memberId: 'omem_member',
    userId: 'usr_member',
    displayName: 'Member',
    avatarUrl: null,
    role: 'member',
    managerUserId: 'usr_manager',
    managerDisplayName: 'Manager',
    status: 'active',
  },
];

const TEAM_PROJECT_RESPONSE = {
  projectId: 'prj_team',
  name: '增长计划',
  description: '团队项目卡片',
  createdAt: '2026-08-22T00:00:00.000Z',
  updatedAt: '2026-08-23T00:00:00.000Z',
  taskCount: 0,
  scope: 'organization',
  organizationId: 'org_design',
  organizationName: '设计团队',
  memberRole: 'lead',
} satisfies TeamProjectOutput;

const OPERATIONS_ORGANIZATION = {
  organizationId: 'org_ops',
  name: '运营团队',
  role: 'member',
  managerDisplayName: 'Ops Manager',
  activeMemberCount: 2,
} as const satisfies OrganizationListOutput[number];

const OPERATIONS_PROJECT = {
  ...TEAM_PROJECT_RESPONSE,
  projectId: 'prj_ops',
  name: '运营节奏',
  organizationId: 'org_ops',
  organizationName: '运营团队',
  memberRole: 'member',
} satisfies TeamProjectOutput;

function trpcError(code: 'NOT_FOUND' | 'FORBIDDEN' | 'UNAUTHORIZED'): Error {
  return Object.assign(new Error(code.toLowerCase()), { data: { code } });
}

beforeEach(() => {
  shell.teamProjectsEnabled = false;
  shell.projects = [PERSONAL_PROJECT];
  shell.refreshProjects.mockReset().mockResolvedValue({
    ok: true,
    projects: [PERSONAL_PROJECT],
  });
  for (const mock of Object.values(api)) mock.mockReset();
  api.organizationsList.mockResolvedValue([]);
  api.organizationMembers.mockResolvedValue([]);
  api.projectsList.mockResolvedValue([]);
  api.organizationsCreate.mockResolvedValue({
    organizationId: 'org_new',
    name: '新团队',
    role: 'owner',
  });
  api.projectsCreate.mockResolvedValue({ projectId: 'prj_new', name: '新项目' });
  api.projectsDelete.mockResolvedValue({ ok: true, projectId: 'prj_deleted' });
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

afterEach(cleanup);

function pageElement(path = '/projects'): JSX.Element {
  return (
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <ProjectsPage />
        <LocationProbe />
      </ToastProvider>
    </MemoryRouter>
  );
}

function LocationProbe(): JSX.Element {
  const location = useLocation();
  return <output data-testid="location-probe">{`${location.pathname}${location.search}`}</output>;
}

function renderPage(path = '/projects'): ReturnType<typeof render> {
  return render(pageElement(path));
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
  readonly reject: (reason?: unknown) => void;
} {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

const OFFSCREEN_MUTATION_CASES = [
  ['team-project creation', 'create-project', '创建团队项目失败'],
  ['team-project deletion', 'delete-project', '删除失败'],
  ['reporting-line update', 'reporting-line', '更新直属上级失败'],
  ['member-role update', 'member-role', '更新成员角色失败'],
  ['member removal', 'remove-member', '移除成员失败'],
  ['invitation creation', 'invite', '邀请链接生成失败'],
] as const;

type OffscreenMutationAction = (typeof OFFSCREEN_MUTATION_CASES)[number][1];

function deferWorkspaceMutation(action: OffscreenMutationAction, promise: Promise<never>): void {
  if (action === 'create-project') {
    api.projectsCreate.mockImplementation(() => promise);
  } else if (action === 'delete-project') {
    api.projectsDelete.mockImplementation(() => promise);
  } else if (action === 'reporting-line') {
    api.updateReportingLine.mockImplementation(() => promise);
  } else if (action === 'member-role') {
    api.updateMemberRole.mockImplementation(() => promise);
  } else if (action === 'remove-member') {
    api.deactivateMember.mockImplementation(() => promise);
  } else {
    api.createInvitation.mockImplementation(() => promise);
  }
}

function deferSuccessfulWorkspaceMutation(action: OffscreenMutationAction): {
  readonly promise: Promise<unknown>;
  readonly resolve: () => void;
} {
  if (action === 'create-project') {
    const future = deferred<{ projectId: string; name: string }>();
    api.projectsCreate.mockImplementation(() => future.promise);
    return {
      promise: future.promise,
      resolve: () => future.resolve({ projectId: 'prj_late', name: '延迟项目' }),
    };
  }
  if (action === 'delete-project') {
    const future = deferred<{ ok: true; projectId: string }>();
    api.projectsDelete.mockImplementation(() => future.promise);
    return {
      promise: future.promise,
      resolve: () => future.resolve({ ok: true, projectId: 'prj_team' }),
    };
  }
  if (action === 'reporting-line') {
    const future = deferred<{ ok: true }>();
    api.updateReportingLine.mockImplementation(() => future.promise);
    return { promise: future.promise, resolve: () => future.resolve({ ok: true }) };
  }
  if (action === 'member-role') {
    const future = deferred<{ ok: true }>();
    api.updateMemberRole.mockImplementation(() => future.promise);
    return { promise: future.promise, resolve: () => future.resolve({ ok: true }) };
  }
  if (action === 'remove-member') {
    const future = deferred<{ ok: true }>();
    api.deactivateMember.mockImplementation(() => future.promise);
    return { promise: future.promise, resolve: () => future.resolve({ ok: true }) };
  }
  const future = deferred<InvitationOutput>();
  api.createInvitation.mockImplementation(() => future.promise);
  return {
    promise: future.promise,
    resolve: () =>
      future.resolve({
        invitationId: 'oinv_late_success',
        inviteUrl: '/organizations/invitations/accept?token=late-success-secret',
        expiresAt: '2026-09-06T00:00:00.000Z',
      }),
  };
}

function workspaceMutationSuccessCopy(action: OffscreenMutationAction): RegExp {
  if (action === 'create-project') return /已创建团队项目/;
  if (action === 'delete-project') return /项目已删除/;
  if (action === 'reporting-line') return /直属上级已更新/;
  if (action === 'member-role') return /成员角色已更新/;
  if (action === 'remove-member') return /已移除成员/;
  return /late-success-secret/;
}

function workspaceMutationCallCount(action: OffscreenMutationAction): number {
  if (action === 'create-project') return api.projectsCreate.mock.calls.length;
  if (action === 'delete-project') return api.projectsDelete.mock.calls.length;
  if (action === 'reporting-line') return api.updateReportingLine.mock.calls.length;
  if (action === 'member-role') return api.updateMemberRole.mock.calls.length;
  if (action === 'remove-member') return api.deactivateMember.mock.calls.length;
  return api.createInvitation.mock.calls.length;
}

async function beginWorkspaceMutation(
  user: ReturnType<typeof userEvent.setup>,
  action: OffscreenMutationAction,
): Promise<void> {
  if (action === 'create-project') {
    await user.click(screen.getByRole('button', { name: '新建团队项目' }));
    const dialog = screen.getByRole('dialog', { name: '新建团队项目' });
    await user.type(within(dialog).getByLabelText('项目名称'), '延迟项目');
    await user.click(within(dialog).getByRole('button', { name: '创建项目' }));
  } else if (action === 'delete-project') {
    await user.click(screen.getByRole('button', { name: '项目 增长计划 操作' }));
    await user.click(await screen.findByRole('menuitem', { name: '删除项目' }));
    await user.click(
      within(screen.getByRole('dialog', { name: '删除这个项目？' })).getByRole('button', {
        name: '删除项目',
      }),
    );
  } else if (action === 'reporting-line') {
    await user.selectOptions(screen.getByLabelText('设置 Member 的直属上级'), 'omem_owner');
  } else if (action === 'member-role') {
    await user.selectOptions(screen.getByLabelText('更改 Member 的角色'), 'manager');
  } else if (action === 'remove-member') {
    await user.click(screen.getByRole('button', { name: '移除 Member' }));
    await user.click(
      within(screen.getByRole('dialog', { name: '移除这位团队成员？' })).getByRole('button', {
        name: '移除成员',
      }),
    );
  } else {
    await user.click(screen.getByRole('button', { name: '邀请成员' }));
    await user.click(
      within(screen.getByRole('dialog', { name: '邀请成员加入设计团队' })).getByRole('button', {
        name: '生成邀请链接',
      }),
    );
  }
}

async function openDesignAlongsideOperations(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  shell.teamProjectsEnabled = true;
  api.organizationsList.mockResolvedValue([ORGANIZATION_FIXTURES.owner, OPERATIONS_ORGANIZATION]);
  api.projectsList.mockImplementation((input) =>
    Promise.resolve(
      input?.organizationId === OPERATIONS_ORGANIZATION.organizationId
        ? [OPERATIONS_PROJECT]
        : [TEAM_PROJECT_RESPONSE],
    ),
  );
  api.organizationMembers.mockResolvedValue(ORGANIZATION_MEMBERS);
  renderPage();
  await user.click(await screen.findByRole('button', { name: /设计团队/ }));
  await screen.findByText('增长计划');
  return user;
}

function expectPersonalSurfaceWithoutTeamControls(): void {
  expect(screen.getByText('按项目分组管理你的任务')).toBeTruthy();
  expect(screen.getByText('个人研究')).toBeTruthy();
  expect(screen.getByRole('button', { name: '新建项目' })).toBeTruthy();
  expect(screen.queryByRole('region', { name: '工作区切换' })).toBeNull();
  expect(screen.queryByRole('button', { name: '创建团队' })).toBeNull();
  expect(screen.queryByRole('button', { name: '邀请成员' })).toBeNull();
  expect(screen.queryByRole('button', { name: '新建团队项目' })).toBeNull();
  expect(screen.queryByRole('region', { name: '团队成员' })).toBeNull();
  expect(screen.queryByRole('region', { name: '团队项目' })).toBeNull();
}

async function openOrganization(
  role: keyof typeof ORGANIZATION_FIXTURES = 'owner',
): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  shell.teamProjectsEnabled = true;
  api.organizationsList.mockResolvedValue([ORGANIZATION_FIXTURES[role]]);
  api.projectsList.mockResolvedValue([TEAM_PROJECT_RESPONSE]);
  api.organizationMembers.mockResolvedValue(ORGANIZATION_MEMBERS);
  renderPage();
  await user.click(await screen.findByRole('button', { name: /设计团队/ }));
  await screen.findByText('增长计划');
  await screen.findByRole('region', { name: '团队成员' });
  return user;
}

async function selectOrganization(
  role: keyof typeof ORGANIZATION_FIXTURES = 'owner',
): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  shell.teamProjectsEnabled = true;
  api.organizationsList.mockResolvedValue([ORGANIZATION_FIXTURES[role]]);
  renderPage();
  await user.click(await screen.findByRole('button', { name: /设计团队/ }));
  return user;
}

describe('ProjectsPage team workspace gate', () => {
  it('preserves the personal description, creation affordance, and project cards while hiding organization controls', async () => {
    const user = userEvent.setup();
    renderPage();

    expect(screen.getByText('按项目分组管理你的任务')).toBeTruthy();
    expect(screen.getByRole('button', { name: '新建项目' })).toBeTruthy();
    expect(screen.getByText('个人研究')).toBeTruthy();
    expect(screen.queryByRole('region', { name: '工作区切换' })).toBeNull();
    expect(screen.queryByRole('button', { name: '创建团队' })).toBeNull();

    await waitFor(() => expect(shell.refreshProjects).toHaveBeenCalledTimes(1));
    expect(api.organizationsList).not.toHaveBeenCalled();
    expect(api.organizationMembers).not.toHaveBeenCalled();
    expect(api.projectsList).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '新建项目' }));
    const nameInput = screen.getByPlaceholderText('项目名称（≤100 字）');
    expect(document.activeElement).toBe(nameInput);
  });

  it('restores the gate-off personal grid to three columns at the 1024px lg breakpoint', () => {
    renderPage();

    const personalCard = screen.getByText('个人研究').closest('article');
    const projectGrid = personalCard?.parentElement;
    expect(projectGrid?.classList.contains('lg:grid-cols-3')).toBe(true);
    expect(projectGrid?.classList.contains('xl:grid-cols-3')).toBe(false);
  });

  it('shows the workspace switcher and starts personal and organization loads without waiting for either one', async () => {
    const user = userEvent.setup();
    let resolvePersonal: ((value: { ok: true; projects: UiProject[] }) => void) | undefined;
    let resolveOrganizations: ((value: OrganizationListOutput) => void) | undefined;
    shell.teamProjectsEnabled = true;
    shell.projects = [];
    shell.refreshProjects.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePersonal = resolve;
        }),
    );
    api.organizationsList.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveOrganizations = resolve;
        }),
    );

    renderPage();

    expect(screen.getByRole('region', { name: '工作区切换' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '个人空间' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '创建团队' })).toBeTruthy();
    expect(screen.getByLabelText('个人项目加载中')).toBeTruthy();
    expect(screen.getByText('团队工作区加载中…')).toBeTruthy();
    await waitFor(() => expect(shell.refreshProjects).toHaveBeenCalledTimes(1));
    expect(api.organizationsList).toHaveBeenCalledTimes(1);

    resolvePersonal?.({ ok: true, projects: [] });
    resolveOrganizations?.([]);
    await user.click(screen.getByRole('button', { name: '个人空间' }));
  });

  it('keeps the existing delete explanation that returns personal tasks to the default list', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: '项目 个人研究 操作' }));
    await user.click(await screen.findByRole('menuitem', { name: '删除项目' }));

    const dialog = screen.getByRole('dialog', { name: '删除这个项目？' });
    expect(within(dialog).getByText(/项目下的任务会移回默认列表/)).toBeTruthy();
    expect(within(dialog).getByText(/任务本身不会被删除/)).toBeTruthy();
  });

  it('keeps the legacy personal-card destination on the workbench project query', async () => {
    const user = userEvent.setup();
    renderPage();

    const personalProjectButton = screen.getByText('个人研究').closest('button');
    expect(personalProjectButton).toBeTruthy();
    await user.click(personalProjectButton as HTMLButtonElement);

    expect(screen.getByTestId('location-probe').textContent).toBe('/?project=prj_personal');
  });

  it('fails closed to the personal workspace if the rollout gate turns off after organization selection', async () => {
    const user = userEvent.setup();
    shell.teamProjectsEnabled = true;
    api.organizationsList.mockResolvedValue([ORGANIZATION_FIXTURES.owner]);
    api.projectsList.mockResolvedValue([TEAM_PROJECT_RESPONSE]);
    api.organizationMembers.mockResolvedValue(ORGANIZATION_MEMBERS);
    const view = renderPage();
    await user.click(await screen.findByRole('button', { name: /设计团队/ }));
    expect(await screen.findByText('增长计划')).toBeTruthy();

    shell.teamProjectsEnabled = false;
    view.rerender(pageElement());

    expect(screen.getByText('按项目分组管理你的任务')).toBeTruthy();
    expect(screen.getByText('个人研究')).toBeTruthy();
    expect(screen.queryByRole('region', { name: '工作区切换' })).toBeNull();
    expect(screen.queryByRole('button', { name: '邀请成员' })).toBeNull();
    expect(screen.queryByRole('button', { name: '新建团队项目' })).toBeNull();
    expect(screen.queryByRole('region', { name: '团队成员' })).toBeNull();
  });
});

describe('ProjectsPage organization workspace', () => {
  it('loads team projects and members in parallel after selecting an organization', async () => {
    const user = userEvent.setup();
    let resolveProjects: ((value: ProjectListOutput) => void) | undefined;
    let resolveMembers: ((value: OrganizationMembersOutput) => void) | undefined;
    shell.teamProjectsEnabled = true;
    api.organizationsList.mockResolvedValue([ORGANIZATION_FIXTURES.owner]);
    api.projectsList.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveProjects = resolve;
        }),
    );
    api.organizationMembers.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveMembers = resolve;
        }),
    );
    renderPage();

    expect(await screen.findByRole('heading', { name: '个人项目' })).toBeTruthy();
    await user.click(await screen.findByRole('button', { name: /设计团队/ }));

    await waitFor(() => expect(api.projectsList).toHaveBeenCalledTimes(1));
    expect(api.projectsList).toHaveBeenCalledWith({ organizationId: 'org_design' });
    expect(api.organizationMembers).toHaveBeenCalledTimes(1);
    expect(api.organizationMembers).toHaveBeenCalledWith({ organizationId: 'org_design' });
    expect(screen.getByLabelText('团队项目加载中')).toBeTruthy();
    expect(screen.getByLabelText('团队成员加载中')).toBeTruthy();

    resolveProjects?.([TEAM_PROJECT_RESPONSE]);
    resolveMembers?.(ORGANIZATION_MEMBERS);
    expect(await screen.findByText('增长计划')).toBeTruthy();
    expect(await screen.findByText('Member')).toBeTruthy();
  });

  it('renders a resolved team-project collection while the independent member request is still loading', async () => {
    let resolveMembers: ((value: OrganizationMembersOutput) => void) | undefined;
    api.projectsList.mockResolvedValue([TEAM_PROJECT_RESPONSE]);
    api.organizationMembers.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveMembers = resolve;
        }),
    );

    await selectOrganization();

    expect(await screen.findByText('增长计划')).toBeTruthy();
    expect(screen.getByLabelText('团队成员加载中')).toBeTruthy();

    resolveMembers?.([]);
    expect(await screen.findByText('还没有团队成员')).toBeTruthy();
  });

  it('lets a member see same-tenant people and projects without invite, removal, or project mutation controls', async () => {
    await openOrganization('member');

    expect(screen.getByText('Member')).toBeTruthy();
    expect(screen.getByText('增长计划')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '邀请成员' })).toBeNull();
    expect(screen.queryByRole('button', { name: '新建团队项目' })).toBeNull();
    expect(screen.queryByRole('button', { name: /移除 Member/ })).toBeNull();
    expect(screen.queryByLabelText(/更改 Member 的角色/)).toBeNull();
    expect(screen.queryByLabelText(/设置 Member 的直属上级/)).toBeNull();
  });

  it('shows a manager only project creation, permitted invite roles, and reporting-line actions', async () => {
    const user = await openOrganization('manager');

    expect(screen.getByRole('button', { name: '新建团队项目' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '邀请成员' })).toBeTruthy();
    expect(screen.getByLabelText('设置 Member 的直属上级')).toBeTruthy();
    expect(screen.queryByLabelText('更改 Member 的角色')).toBeNull();
    expect(screen.queryByRole('button', { name: '移除 Member' })).toBeNull();

    await user.click(screen.getByRole('button', { name: '邀请成员' }));
    const inviteDialog = screen.getByRole('dialog', { name: '邀请成员加入设计团队' });
    const roleSelect = within(inviteDialog).getByRole('combobox', { name: '成员角色' });
    expect(within(roleSelect).queryByRole('option', { name: '管理员' })).toBeNull();
    expect(within(roleSelect).getByRole('option', { name: '主管' })).toBeTruthy();
    expect(within(roleSelect).getByRole('option', { name: '成员' })).toBeTruthy();
  });

  it('fails closed to the next workspace invite roles when switching from owner to manager', async () => {
    const user = userEvent.setup();
    shell.teamProjectsEnabled = true;
    api.organizationsList.mockResolvedValue([
      ORGANIZATION_FIXTURES.owner,
      {
        organizationId: 'org_ops',
        name: '运营团队',
        role: 'manager',
        managerDisplayName: 'Owner',
        activeMemberCount: 2,
      },
    ]);
    renderPage();
    await user.click(await screen.findByRole('button', { name: /设计团队/ }));
    await user.click(screen.getByRole('button', { name: '邀请成员' }));
    const ownerDialog = screen.getByRole('dialog', { name: '邀请成员加入设计团队' });
    expect(
      (within(ownerDialog).getByRole('combobox', { name: '成员角色' }) as HTMLSelectElement).value,
    ).toBe('admin');
    await user.click(within(ownerDialog).getByRole('button', { name: '关闭邀请对话框' }));

    await user.click(screen.getByRole('button', { name: /运营团队/ }));
    api.createInvitation.mockResolvedValue({
      invitationId: 'oinv_manager',
      inviteUrl: '/organizations/invitations/accept?token=manager-secret',
      expiresAt: '2026-09-06T00:00:00.000Z',
    });
    await user.click(screen.getByRole('button', { name: '邀请成员' }));
    const managerDialog = screen.getByRole('dialog', { name: '邀请成员加入运营团队' });
    const managerRole = within(managerDialog).getByRole('combobox', {
      name: '成员角色',
    }) as HTMLSelectElement;
    expect(managerRole.value).toBe('manager');
    expect(within(managerRole).queryByRole('option', { name: '管理员' })).toBeNull();
    await user.click(within(managerDialog).getByRole('button', { name: '生成邀请链接' }));
    await waitFor(() =>
      expect(api.createInvitation).toHaveBeenCalledWith({
        organizationId: 'org_ops',
        role: 'manager',
      }),
    );
  });

  it.each(['admin', 'owner'] as const)(
    'shows reporting-line, role, and member-removal controls to an %s',
    async (role) => {
      await openOrganization(role);

      expect(screen.getByLabelText('设置 Member 的直属上级')).toBeTruthy();
      expect(screen.getByLabelText('更改 Member 的角色')).toBeTruthy();
      expect(screen.getByRole('button', { name: '移除 Member' })).toBeTruthy();
    },
  );

  it.each([
    ['reporting line', '设置 Member 的直属上级', 'omem_owner', 'updateReportingLine'],
    ['role', '更改 Member 的角色', 'manager', 'updateMemberRole'],
  ] as const)(
    'resets the controlled %s selection after a failed mutation',
    async (_label, accessibleName, value, mutationName) => {
      const user = await openOrganization('owner');
      api[mutationName].mockRejectedValue(new Error('mutation offline'));
      const select = screen.getByLabelText(accessibleName) as HTMLSelectElement;

      await user.selectOptions(select, value);

      await waitFor(() => expect(api[mutationName]).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(select.value).toBe(''));
    },
  );

  it('shows a visible focus ring when keyboard focus reaches a member select', async () => {
    const user = await openOrganization('owner');
    const select = screen.getByLabelText('设置 Member 的直属上级');

    for (let tabCount = 0; tabCount < 30 && document.activeElement !== select; tabCount += 1) {
      await user.tab();
    }

    expect(document.activeElement).toBe(select);
    expect(select.classList.contains('focus-visible:ring-2')).toBe(true);
    expect(select.classList.contains('focus-visible:ring-[#EA1F59]/30')).toBe(true);
  });

  it('keeps new workspace, member, invitation, and creation targets at least 44px tall', async () => {
    const user = await openOrganization('owner');
    const workspace = screen.getByRole('region', { name: '工作区切换' });
    const members = screen.getByRole('region', { name: '团队成员' });
    const workspaceTargets = [
      within(workspace).getByRole('button', { name: '刷新团队空间' }),
      within(workspace).getByRole('button', { name: '创建团队' }),
      within(workspace).getByRole('button', { name: '个人空间' }),
      within(workspace).getByRole('button', { name: /设计团队/ }),
    ];
    const memberTargets = [
      within(members).getByRole('button', { name: '刷新团队成员' }),
      within(members).getByLabelText('设置 Member 的直属上级'),
      within(members).getByLabelText('更改 Member 的角色'),
      within(members).getByRole('button', { name: '移除 Member' }),
    ];
    const organizationTargets = [
      screen.getByRole('button', { name: '邀请成员' }),
      screen.getByRole('button', { name: '新建团队项目' }),
      screen.getByRole('button', { name: '刷新工作区' }),
    ];

    for (const target of [...workspaceTargets, ...memberTargets, ...organizationTargets]) {
      expect(target.classList.contains('h-11')).toBe(true);
    }

    await user.click(screen.getByRole('button', { name: '邀请成员' }));
    const invitationDialog = screen.getByRole('dialog', { name: /邀请成员加入/ });
    const invitationTargets = [
      within(invitationDialog).getByRole('button', { name: '关闭邀请对话框' }),
      within(invitationDialog).getByLabelText('成员角色'),
      within(invitationDialog).getByLabelText('直属上级（可选）'),
      within(invitationDialog).getByRole('button', { name: '取消' }),
      within(invitationDialog).getByRole('button', { name: '生成邀请链接' }),
    ];
    for (const target of invitationTargets) {
      expect(target.classList.contains('h-11')).toBe(true);
    }

    await user.click(within(invitationDialog).getByRole('button', { name: '取消' }));
    await user.click(screen.getByRole('button', { name: '创建团队' }));
    const creationDialog = screen.getByRole('dialog', { name: '创建团队空间' });
    const creationTargets = [
      within(creationDialog).getByRole('button', { name: '关闭创建团队空间' }),
      within(creationDialog).getByLabelText('团队名称'),
      within(creationDialog).getByRole('button', { name: '取消' }),
      within(creationDialog).getByRole('button', { name: '创建团队' }),
    ];
    for (const target of creationTargets) {
      expect(target.classList.contains('h-11')).toBe(true);
    }
  });

  it('keeps the team-project card action trigger at least 44px tall', async () => {
    await openOrganization('owner');

    const actionTrigger = screen.getByRole('button', { name: '项目 增长计划 操作' });
    expect(actionTrigger.classList.contains('h-11')).toBe(true);
  });

  it.each([
    ['owner', 'lead', true],
    ['owner', 'member', true],
    ['owner', 'viewer', true],
    ['admin', 'lead', true],
    ['admin', 'member', true],
    ['admin', 'viewer', true],
    ['manager', 'lead', false],
    ['manager', 'member', false],
    ['manager', 'viewer', false],
    ['member', 'lead', false],
    ['member', 'member', false],
    ['member', 'viewer', false],
  ] as const)(
    'derives team-project delete for organization %s and project %s as %s',
    async (organizationRole, projectRole, canDelete) => {
      const user = userEvent.setup();
      const teamProject = {
        ...TEAM_PROJECT_RESPONSE,
        memberRole: projectRole,
      } satisfies TeamProjectOutput;
      shell.teamProjectsEnabled = true;
      api.organizationsList.mockResolvedValue([ORGANIZATION_FIXTURES[organizationRole]]);
      api.projectsList.mockResolvedValue([teamProject]);
      api.organizationMembers.mockResolvedValue(ORGANIZATION_MEMBERS);
      renderPage();
      await user.click(await screen.findByRole('button', { name: /设计团队/ }));
      await screen.findByText('增长计划');

      await user.click(screen.getByRole('button', { name: '项目 增长计划 操作' }));

      expect(screen.queryByRole('menuitem', { name: '删除项目' }) !== null).toBe(canDelete);
    },
  );

  it('creates an organization and a team project through scoped dialogs', async () => {
    const user = await openOrganization('manager');
    api.organizationsList.mockResolvedValueOnce([ORGANIZATION_FIXTURES.manager]).mockResolvedValue([
      ORGANIZATION_FIXTURES.manager,
      {
        organizationId: 'org_new',
        name: '新团队',
        role: 'owner',
        managerDisplayName: null,
        activeMemberCount: 1,
      },
    ]);

    await user.click(screen.getByRole('button', { name: '创建团队' }));
    const organizationDialog = screen.getByRole('dialog', { name: '创建团队空间' });
    await user.type(within(organizationDialog).getByLabelText('团队名称'), '新团队');
    await user.click(within(organizationDialog).getByRole('button', { name: '创建团队' }));
    await waitFor(() => expect(api.organizationsCreate).toHaveBeenCalledWith({ name: '新团队' }));

    await user.click(screen.getByRole('button', { name: /设计团队/ }));
    await user.click(screen.getByRole('button', { name: '新建团队项目' }));
    const projectDialog = screen.getByRole('dialog', { name: '新建团队项目' });
    await user.type(within(projectDialog).getByLabelText('项目名称'), '发布节奏');
    await user.click(within(projectDialog).getByRole('button', { name: '创建项目' }));
    await waitFor(() =>
      expect(api.projectsCreate).toHaveBeenCalledWith({
        name: '发布节奏',
        organizationId: 'org_design',
      }),
    );
  });
});

describe('ProjectsPage invitation plaintext lifecycle', () => {
  it('resets invite state across workspaces and ignores a late response from the previous workspace', async () => {
    const user = userEvent.setup();
    let resolveDesignInvite: ((value: InvitationOutput) => void) | undefined;
    let designInvitePromise: Promise<InvitationOutput> | undefined;
    shell.teamProjectsEnabled = true;
    api.organizationsList.mockResolvedValue([
      ORGANIZATION_FIXTURES.owner,
      {
        organizationId: 'org_ops',
        name: '运营团队',
        role: 'manager',
        managerDisplayName: 'Owner',
        activeMemberCount: 2,
      },
    ]);
    api.organizationMembers.mockResolvedValue(ORGANIZATION_MEMBERS);
    api.createInvitation.mockImplementation(() => {
      designInvitePromise = new Promise((resolve) => {
        resolveDesignInvite = resolve;
      });
      return designInvitePromise;
    });
    renderPage();

    const operationsWorkspace = await screen.findByRole('button', { name: /运营团队/ });
    await user.click(await screen.findByRole('button', { name: /设计团队/ }));
    await user.click(screen.getByRole('button', { name: '邀请成员' }));
    const designDialog = screen.getByRole('dialog', { name: '邀请成员加入设计团队' });
    await user.selectOptions(
      within(designDialog).getByRole('combobox', { name: /直属上级/ }),
      'omem_manager',
    );
    await user.click(within(designDialog).getByRole('button', { name: '生成邀请链接' }));

    fireEvent.click(operationsWorkspace);
    await user.click(await screen.findByRole('button', { name: '邀请成员' }));
    const operationsDialog = screen.getByRole('dialog', { name: '邀请成员加入运营团队' });
    expect(
      (within(operationsDialog).getByRole('combobox', { name: /直属上级/ }) as HTMLSelectElement)
        .value,
    ).toBe('');
    expect(
      (
        within(operationsDialog).getByRole('button', {
          name: '生成邀请链接',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);

    await act(async () => {
      resolveDesignInvite?.({
        invitationId: 'oinv_design',
        inviteUrl: '/organizations/invitations/accept?token=design-secret',
        expiresAt: '2026-09-06T00:00:00.000Z',
      });
      await designInvitePromise;
      await Promise.resolve();
    });
    expect(
      within(operationsDialog).queryByDisplayValue(
        '/organizations/invitations/accept?token=design-secret',
      ),
    ).toBeNull();
  });

  it('allows closing an invitation while it is being generated and discards the late plaintext', async () => {
    const user = await openOrganization('owner');
    let resolveInvite:
      | ((value: { invitationId: string; inviteUrl: string; expiresAt: string }) => void)
      | undefined;
    api.createInvitation.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveInvite = resolve;
        }),
    );

    await user.click(screen.getByRole('button', { name: '邀请成员' }));
    const dialog = screen.getByRole('dialog', { name: '邀请成员加入设计团队' });
    await user.click(within(dialog).getByRole('button', { name: '生成邀请链接' }));
    const closeButton = within(dialog).getByRole('button', { name: '关闭邀请对话框' });
    expect((closeButton as HTMLButtonElement).disabled).toBe(false);
    await user.click(closeButton);
    expect(screen.queryByRole('dialog', { name: '邀请成员加入设计团队' })).toBeNull();

    resolveInvite?.({
      invitationId: 'oinv_late',
      inviteUrl: '/organizations/invitations/accept?token=late-secret',
      expiresAt: '2026-09-06T00:00:00.000Z',
    });
    await user.click(screen.getByRole('button', { name: '邀请成员' }));
    const reopened = screen.getByRole('dialog', { name: '邀请成员加入设计团队' });
    await waitFor(() =>
      expect(
        within(reopened).queryByDisplayValue('/organizations/invitations/accept?token=late-secret'),
      ).toBeNull(),
    );
  });

  it('shows a valid invite URL and expiry, copies it, and clears plaintext when closed', async () => {
    const user = await openOrganization('owner');
    const writeText = vi.spyOn(navigator.clipboard, 'writeText');
    const inviteUrl = '/organizations/invitations/accept?token=one-time-secret';
    api.createInvitation.mockResolvedValue({
      invitationId: 'oinv_123',
      inviteUrl,
      expiresAt: '2026-09-06T00:00:00.000Z',
    });

    await user.click(screen.getByRole('button', { name: '邀请成员' }));
    const dialog = screen.getByRole('dialog', { name: '邀请成员加入设计团队' });
    await user.click(within(dialog).getByRole('button', { name: '生成邀请链接' }));

    expect(await within(dialog).findByDisplayValue(inviteUrl)).toBeTruthy();
    expect(within(dialog).getByText(/有效期至/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: '复制邀请链接' }));
    expect(writeText).toHaveBeenCalledWith(inviteUrl);

    await user.click(within(dialog).getByRole('button', { name: '关闭' }));
    await user.click(screen.getByRole('button', { name: '邀请成员' }));
    const reopened = screen.getByRole('dialog', { name: '邀请成员加入设计团队' });
    expect(within(reopened).queryByDisplayValue(inviteUrl)).toBeNull();
    expect(within(reopened).queryByRole('button', { name: '复制邀请链接' })).toBeNull();
  });

  it.each([
    {
      label: 'non-http URL',
      response: {
        invitationId: 'oinv_bad_url',
        inviteUrl: 'javascript:alert(1)',
        expiresAt: '2026-09-06T00:00:00.000Z',
      },
    },
    {
      label: 'URL without token',
      response: {
        invitationId: 'oinv_missing_token',
        inviteUrl: '/organizations/invitations/accept',
        expiresAt: '2026-09-06T00:00:00.000Z',
      },
    },
    {
      label: 'invalid expiry',
      response: {
        invitationId: 'oinv_bad_expiry',
        inviteUrl: '/organizations/invitations/accept?token=secret',
        expiresAt: 'not-a-date',
      },
    },
  ])('rejects a malformed invitation response with $label', async ({ response }) => {
    const user = await openOrganization('owner');
    api.createInvitation.mockResolvedValue(response);

    await user.click(screen.getByRole('button', { name: '邀请成员' }));
    const dialog = screen.getByRole('dialog', { name: '邀请成员加入设计团队' });
    await user.click(within(dialog).getByRole('button', { name: '生成邀请链接' }));

    expect(await within(dialog).findByText('邀请链接无效，请重新生成')).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: '复制邀请链接' })).toBeNull();
  });

  it('invalidates the current workspace and invitation state after hidden invite creation', async () => {
    const user = await openOrganization('owner');
    api.createInvitation.mockRejectedValue(trpcError('UNAUTHORIZED'));

    await user.click(screen.getByRole('button', { name: '邀请成员' }));
    const dialog = screen.getByRole('dialog', { name: '邀请成员加入设计团队' });
    await user.selectOptions(within(dialog).getByLabelText('直属上级（可选）'), 'omem_manager');
    await user.click(within(dialog).getByRole('button', { name: '生成邀请链接' }));

    expect(await screen.findByRole('heading', { name: '个人项目' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /设计团队/ })).toBeNull();
    expect(screen.queryByRole('dialog', { name: '邀请成员加入设计团队' })).toBeNull();
    expect(screen.queryByText('增长计划')).toBeNull();
    expect(screen.queryByText('Member')).toBeNull();
    expect(screen.queryByRole('button', { name: '邀请成员' })).toBeNull();
    expect(screen.queryByText(/token=/)).toBeNull();
  });
});

describe('ProjectsPage personal-project collection states', () => {
  it('shows an empty personal-project state independently of organizations', async () => {
    shell.teamProjectsEnabled = true;
    shell.projects = [];
    shell.refreshProjects.mockResolvedValue({ ok: true, projects: [] });
    renderPage();

    expect(await screen.findByText('还没有个人项目')).toBeTruthy();
    expect(screen.getByText('还没有团队工作区')).toBeTruthy();
  });

  it('shows a full personal-project error when no prior rows exist', async () => {
    shell.teamProjectsEnabled = true;
    shell.projects = [];
    shell.refreshProjects.mockResolvedValue({ error: 'personal offline' });
    renderPage();

    expect(await screen.findByText('个人项目暂时无法加载')).toBeTruthy();
    expect(screen.getByText(/任务执行出错，请重试/)).toBeTruthy();
  });

  it('keeps stale personal projects visible when refresh fails', async () => {
    shell.teamProjectsEnabled = true;
    shell.refreshProjects.mockResolvedValue({ error: 'personal offline' });
    renderPage();

    expect(await screen.findByText('个人项目更新失败，当前保留上次结果')).toBeTruthy();
    expect(screen.getByText('个人研究')).toBeTruthy();
  });
});

describe('ProjectsPage organization collection states', () => {
  it('shows the organization empty state without changing personal projects', async () => {
    shell.teamProjectsEnabled = true;
    api.organizationsList.mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText('还没有团队工作区')).toBeTruthy();
    expect(screen.getByText('个人研究')).toBeTruthy();
  });

  it('shows an initial organization error without replacing personal projects', async () => {
    shell.teamProjectsEnabled = true;
    api.organizationsList.mockRejectedValue(new Error('organization offline'));
    renderPage();

    expect(await screen.findByText('团队工作区暂时无法加载')).toBeTruthy();
    expect(screen.getByText('个人研究')).toBeTruthy();
  });

  it('keeps stale organizations selectable after a refresh error', async () => {
    const user = userEvent.setup();
    shell.teamProjectsEnabled = true;
    api.organizationsList
      .mockResolvedValueOnce([ORGANIZATION_FIXTURES.owner])
      .mockRejectedValueOnce(new Error('organization offline'));
    renderPage();
    const organizationButton = await screen.findByRole('button', { name: /设计团队/ });

    await user.click(screen.getByRole('button', { name: '刷新团队空间' }));

    expect(await screen.findByText('团队工作区列表更新失败，当前保留上次结果')).toBeTruthy();
    expect(organizationButton.isConnected).toBe(true);
  });

  it.each([
    ['NOT_FOUND', 'invite'],
    ['FORBIDDEN', 'removal'],
    ['UNAUTHORIZED', 'team-project'],
  ] as const)(
    'revokes the entire team surface after a hidden %s list refresh with an open %s dialog',
    async (code, openDialog) => {
      const user = await openOrganization('owner');
      api.organizationsList.mockRejectedValueOnce(trpcError(code));
      const refresh = screen.getByRole('button', { name: '刷新团队空间' });

      if (openDialog === 'invite') {
        api.createInvitation.mockResolvedValue({
          invitationId: 'oinv_revoked',
          inviteUrl: '/organizations/invitations/accept?token=revoked-secret',
          expiresAt: '2026-09-06T00:00:00.000Z',
        });
        await user.click(screen.getByRole('button', { name: '邀请成员' }));
        const dialog = screen.getByRole('dialog', { name: '邀请成员加入设计团队' });
        await user.click(within(dialog).getByRole('button', { name: '生成邀请链接' }));
        expect(
          await within(dialog).findByDisplayValue(
            '/organizations/invitations/accept?token=revoked-secret',
          ),
        ).toBeTruthy();
      } else if (openDialog === 'removal') {
        await user.click(screen.getByRole('button', { name: '移除 Member' }));
        expect(screen.getByRole('dialog', { name: '移除这位团队成员？' })).toBeTruthy();
      } else {
        await user.click(screen.getByRole('button', { name: '新建团队项目' }));
        expect(screen.getByRole('dialog', { name: '新建团队项目' })).toBeTruthy();
      }

      fireEvent.click(refresh);

      await waitFor(expectPersonalSurfaceWithoutTeamControls);
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.queryByText(/revoked-secret/)).toBeNull();
    },
  );

  it.each(['NOT_FOUND', 'FORBIDDEN', 'UNAUTHORIZED'] as const)(
    'revokes the entire team surface when organization creation returns %s',
    async (code) => {
      const user = userEvent.setup();
      shell.teamProjectsEnabled = true;
      api.organizationsList.mockResolvedValue([ORGANIZATION_FIXTURES.owner]);
      api.organizationsCreate.mockRejectedValue(trpcError(code));
      renderPage();

      await user.click(await screen.findByRole('button', { name: '创建团队' }));
      const dialog = screen.getByRole('dialog', { name: '创建团队空间' });
      await user.type(within(dialog).getByLabelText('团队名称'), '撤销中的团队');
      await user.click(within(dialog).getByRole('button', { name: '创建团队' }));

      await waitFor(expectPersonalSurfaceWithoutTeamControls);
      expect(screen.queryByRole('dialog', { name: '创建团队空间' })).toBeNull();
      expect(screen.queryByText(/创建团队失败/)).toBeNull();
    },
  );

  it.each(['success', 'failure'] as const)(
    'discards late organization creation %s after a hidden list revokes the team surface',
    async (settlement) => {
      const user = userEvent.setup();
      const lateCreate = deferred<{
        organizationId: string;
        name: string;
        role: 'owner';
      }>();
      shell.teamProjectsEnabled = true;
      api.organizationsList
        .mockResolvedValueOnce([ORGANIZATION_FIXTURES.owner])
        .mockRejectedValueOnce(trpcError('UNAUTHORIZED'));
      api.organizationsCreate.mockImplementation(() => lateCreate.promise);
      renderPage();

      const refreshOrganizations = await screen.findByRole('button', { name: '刷新团队空间' });
      await user.click(screen.getByRole('button', { name: '创建团队' }));
      const dialog = screen.getByRole('dialog', { name: '创建团队空间' });
      await user.type(within(dialog).getByLabelText('团队名称'), '幽灵团队');
      await user.click(within(dialog).getByRole('button', { name: '创建团队' }));
      await waitFor(() => expect(api.organizationsCreate).toHaveBeenCalledTimes(1));

      fireEvent.click(refreshOrganizations);
      await waitFor(expectPersonalSurfaceWithoutTeamControls);

      await act(async () => {
        if (settlement === 'success') {
          lateCreate.resolve({
            organizationId: 'org_ghost',
            name: '幽灵团队',
            role: 'owner',
          });
          await lateCreate.promise;
        } else {
          lateCreate.reject(new Error('late organization create offline'));
          await lateCreate.promise.catch(() => undefined);
        }
        await Promise.resolve();
        await Promise.resolve();
      });

      expectPersonalSurfaceWithoutTeamControls();
      expect(api.organizationsList).toHaveBeenCalledTimes(2);
      expect(screen.queryByText(/幽灵团队/)).toBeNull();
      expect(screen.queryByText(/已创建团队/)).toBeNull();
      expect(screen.queryByText(/创建团队失败/)).toBeNull();
      expect(screen.queryByRole('dialog', { name: '创建团队空间' })).toBeNull();
    },
  );

  it.each(['success', 'failure'] as const)(
    'discards late organization creation %s after the rollout gate cycles off and on',
    async (settlement) => {
      const user = userEvent.setup();
      const lateCreate = deferred<{
        organizationId: string;
        name: string;
        role: 'owner';
      }>();
      shell.teamProjectsEnabled = true;
      api.organizationsList.mockResolvedValue([ORGANIZATION_FIXTURES.owner]);
      api.organizationsCreate.mockImplementation(() => lateCreate.promise);
      const view = renderPage();

      await user.click(await screen.findByRole('button', { name: '创建团队' }));
      const dialog = screen.getByRole('dialog', { name: '创建团队空间' });
      await user.type(within(dialog).getByLabelText('团队名称'), '旧周期团队');
      await user.click(within(dialog).getByRole('button', { name: '创建团队' }));
      await waitFor(() => expect(api.organizationsCreate).toHaveBeenCalledTimes(1));

      shell.teamProjectsEnabled = false;
      view.rerender(pageElement());
      expectPersonalSurfaceWithoutTeamControls();
      shell.teamProjectsEnabled = true;
      view.rerender(pageElement());
      await screen.findByRole('region', { name: '工作区切换' });

      await act(async () => {
        if (settlement === 'success') {
          lateCreate.resolve({
            organizationId: 'org_old_generation',
            name: '旧周期团队',
            role: 'owner',
          });
          await lateCreate.promise;
        } else {
          lateCreate.reject(new Error('old generation create offline'));
          await lateCreate.promise.catch(() => undefined);
        }
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(await screen.findByRole('button', { name: /设计团队/ })).toBeTruthy();
      expect(api.organizationsList).toHaveBeenCalledTimes(2);
      expect(screen.queryByText(/旧周期团队/)).toBeNull();
      expect(screen.queryByText(/已创建团队/)).toBeNull();
      expect(screen.queryByText(/创建团队失败/)).toBeNull();
    },
  );
});

describe('ProjectsPage selected team-project collection states', () => {
  it('shows an empty team-project state while members remain independently readable', async () => {
    api.projectsList.mockResolvedValue([]);
    api.organizationMembers.mockResolvedValue(ORGANIZATION_MEMBERS);
    await selectOrganization();

    expect(await screen.findByText('还没有团队项目')).toBeTruthy();
    expect(await screen.findByText('Member')).toBeTruthy();
  });

  it('shows a team-project error while members still load', async () => {
    api.projectsList.mockRejectedValue(new Error('team projects offline'));
    api.organizationMembers.mockResolvedValue(ORGANIZATION_MEMBERS);
    await selectOrganization();

    expect(await screen.findByText('团队项目暂时无法加载')).toBeTruthy();
    expect(await screen.findByText('Member')).toBeTruthy();
  });

  it('keeps stale team projects after a workspace refresh error', async () => {
    api.projectsList
      .mockResolvedValueOnce([TEAM_PROJECT_RESPONSE])
      .mockRejectedValueOnce(new Error('team projects offline'));
    api.organizationMembers.mockResolvedValue(ORGANIZATION_MEMBERS);
    const user = await selectOrganization();
    expect(await screen.findByText('增长计划')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '刷新工作区' }));

    expect(await screen.findByText('团队项目更新失败，当前保留上次结果')).toBeTruthy();
    expect(screen.getByText('增长计划')).toBeTruthy();
  });

  it.each(['empty', 'initial-error', 'stale-error'] as const)(
    'keeps the %s team-project collection action at least 44px tall',
    async (state) => {
      const user = userEvent.setup();
      shell.teamProjectsEnabled = true;
      api.organizationsList.mockResolvedValue([ORGANIZATION_FIXTURES.owner]);
      api.organizationMembers.mockResolvedValue(ORGANIZATION_MEMBERS);
      if (state === 'empty') {
        api.projectsList.mockResolvedValue([]);
      } else if (state === 'initial-error') {
        api.projectsList.mockRejectedValue(new Error('projects offline'));
      } else {
        api.projectsList
          .mockResolvedValueOnce([TEAM_PROJECT_RESPONSE])
          .mockRejectedValueOnce(new Error('projects offline'));
      }
      renderPage();
      await user.click(await screen.findByRole('button', { name: /设计团队/ }));

      if (state === 'stale-error') {
        await screen.findByText('增长计划');
        await user.click(screen.getByRole('button', { name: '刷新工作区' }));
        await screen.findByText('团队项目更新失败，当前保留上次结果');
      }

      const collection = await screen.findByRole('region', { name: '团队项目' });
      const action = within(collection).getByRole('button', {
        name: state === 'empty' ? '新建团队项目' : '重试',
      });
      expect(action.classList.contains('h-11')).toBe(true);
    },
  );

  it.each(['NOT_FOUND', 'FORBIDDEN'] as const)(
    'invalidates a selected workspace and its open invite after a hidden-resource %s response',
    async (code) => {
      api.projectsList
        .mockResolvedValueOnce([TEAM_PROJECT_RESPONSE])
        .mockRejectedValueOnce(trpcError(code));
      api.organizationMembers.mockResolvedValue(ORGANIZATION_MEMBERS);
      const user = await selectOrganization();
      expect(await screen.findByText('增长计划')).toBeTruthy();
      const refreshWorkspace = screen.getByRole('button', { name: '刷新工作区' });

      await user.click(screen.getByRole('button', { name: '邀请成员' }));
      expect(screen.getByRole('dialog', { name: '邀请成员加入设计团队' })).toBeTruthy();
      fireEvent.click(refreshWorkspace);

      expect(await screen.findByRole('heading', { name: '个人项目' })).toBeTruthy();
      expect(screen.queryByText('增长计划')).toBeNull();
      expect(screen.queryByText('Member')).toBeNull();
      expect(screen.queryByRole('dialog', { name: '邀请成员加入设计团队' })).toBeNull();
      expect(screen.queryByRole('button', { name: '邀请成员' })).toBeNull();
      expect(screen.queryByRole('button', { name: '新建团队项目' })).toBeNull();
    },
  );
});

describe('ProjectsPage selected member collection states', () => {
  it('shows an empty member state while team projects remain independently readable', async () => {
    api.projectsList.mockResolvedValue([TEAM_PROJECT_RESPONSE]);
    api.organizationMembers.mockResolvedValue([]);
    await selectOrganization();

    expect(await screen.findByText('还没有团队成员')).toBeTruthy();
    expect(await screen.findByText('增长计划')).toBeTruthy();
  });

  it('shows a member error while team projects still load', async () => {
    api.projectsList.mockResolvedValue([TEAM_PROJECT_RESPONSE]);
    api.organizationMembers.mockRejectedValue(new Error('members offline'));
    await selectOrganization();

    expect(await screen.findByText('团队成员暂时无法加载')).toBeTruthy();
    expect(await screen.findByText('增长计划')).toBeTruthy();
  });

  it('keeps the member retry target at least 44px tall', async () => {
    api.projectsList.mockResolvedValue([TEAM_PROJECT_RESPONSE]);
    api.organizationMembers.mockRejectedValue(new Error('members offline'));
    await selectOrganization();

    const members = await screen.findByRole('region', { name: '团队成员' });
    const retry = within(members).getByRole('button', { name: '重试' });
    expect(retry.classList.contains('h-11')).toBe(true);
  });

  it('keeps stale members after a workspace refresh error', async () => {
    api.projectsList.mockResolvedValue([TEAM_PROJECT_RESPONSE]);
    api.organizationMembers
      .mockResolvedValueOnce(ORGANIZATION_MEMBERS)
      .mockRejectedValueOnce(new Error('members offline'));
    const user = await selectOrganization();
    expect(await screen.findByText('Member')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '刷新工作区' }));

    expect(await screen.findByText('成员列表更新失败，当前保留上次结果')).toBeTruthy();
    expect(screen.getByText('Member')).toBeTruthy();
  });
});

describe('ProjectsPage workspace mutation reconciliation', () => {
  it.each([
    ['team-project creation', 'NOT_FOUND', 'create-project'],
    ['team-project deletion', 'FORBIDDEN', 'delete-project'],
    ['reporting-line update', 'UNAUTHORIZED', 'reporting-line'],
    ['member-role update', 'NOT_FOUND', 'member-role'],
    ['member removal', 'FORBIDDEN', 'remove-member'],
  ] as const)(
    'invalidates the current workspace after hidden %s mutation failure',
    async (_label, code, action) => {
      const user = await openOrganization('owner');

      if (action === 'create-project') {
        api.projectsCreate.mockRejectedValue(trpcError(code));
        await user.click(screen.getByRole('button', { name: '新建团队项目' }));
        const dialog = screen.getByRole('dialog', { name: '新建团队项目' });
        await user.type(within(dialog).getByLabelText('项目名称'), '被撤销的项目');
        await user.click(within(dialog).getByRole('button', { name: '创建项目' }));
      } else if (action === 'delete-project') {
        api.projectsDelete.mockRejectedValue(trpcError(code));
        await user.click(screen.getByRole('button', { name: '项目 增长计划 操作' }));
        await user.click(await screen.findByRole('menuitem', { name: '删除项目' }));
        await user.click(
          within(screen.getByRole('dialog', { name: '删除这个项目？' })).getByRole('button', {
            name: '删除项目',
          }),
        );
      } else if (action === 'reporting-line') {
        api.updateReportingLine.mockRejectedValue(trpcError(code));
        await user.selectOptions(screen.getByLabelText('设置 Member 的直属上级'), 'omem_owner');
      } else if (action === 'member-role') {
        api.updateMemberRole.mockRejectedValue(trpcError(code));
        await user.selectOptions(screen.getByLabelText('更改 Member 的角色'), 'manager');
      } else {
        api.deactivateMember.mockRejectedValue(trpcError(code));
        await user.click(screen.getByRole('button', { name: '移除 Member' }));
        await user.click(
          within(screen.getByRole('dialog', { name: '移除这位团队成员？' })).getByRole('button', {
            name: '移除成员',
          }),
        );
      }

      expect(await screen.findByRole('heading', { name: '个人项目' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: /设计团队/ })).toBeNull();
      expect(screen.queryByText('增长计划')).toBeNull();
      expect(screen.queryByText('Member')).toBeNull();
      expect(screen.queryByRole('button', { name: '邀请成员' })).toBeNull();
      expect(screen.queryByRole('button', { name: '新建团队项目' })).toBeNull();
      expect(screen.queryByRole('dialog')).toBeNull();
    },
  );

  it('keeps workspace B controls enabled and ignores the late result from workspace A', async () => {
    const user = userEvent.setup();
    let resolveRoleUpdate: ((value: { ok: true }) => void) | undefined;
    let designRolePromise: Promise<{ ok: true }> | undefined;
    const operationsOrganization = {
      organizationId: 'org_ops',
      name: '运营团队',
      role: 'admin',
      managerDisplayName: 'Ops Owner',
      activeMemberCount: 3,
    } as const;
    const operationsProject = {
      ...TEAM_PROJECT_RESPONSE,
      projectId: 'prj_ops',
      name: '运营节奏',
      organizationId: 'org_ops',
      organizationName: '运营团队',
    } satisfies TeamProjectOutput;
    const operationsMembers: OrganizationMembersOutput = [
      {
        memberId: 'omem_ops_owner',
        userId: 'usr_ops_owner',
        displayName: 'Ops Owner',
        avatarUrl: null,
        role: 'owner',
        managerUserId: null,
        managerDisplayName: null,
        status: 'active',
      },
      {
        memberId: 'omem_ops_admin',
        userId: 'usr_current',
        displayName: 'Ops Admin',
        avatarUrl: null,
        role: 'admin',
        managerUserId: 'usr_ops_owner',
        managerDisplayName: 'Ops Owner',
        status: 'active',
      },
      {
        memberId: 'omem_ops_member',
        userId: 'usr_ops_member',
        displayName: 'Ops Member',
        avatarUrl: null,
        role: 'member',
        managerUserId: 'usr_ops_admin',
        managerDisplayName: 'Ops Admin',
        status: 'active',
      },
    ];
    shell.teamProjectsEnabled = true;
    api.organizationsList.mockResolvedValue([ORGANIZATION_FIXTURES.owner, operationsOrganization]);
    api.projectsList.mockImplementation((input) => {
      const organizationId = input?.organizationId;
      if (organizationId === 'org_ops') {
        return Promise.resolve([operationsProject]);
      }
      return Promise.resolve([TEAM_PROJECT_RESPONSE]);
    });
    api.organizationMembers.mockImplementation(({ organizationId }) => {
      if (organizationId === 'org_ops') {
        return Promise.resolve(operationsMembers);
      }
      return Promise.resolve(ORGANIZATION_MEMBERS);
    });
    api.updateMemberRole.mockImplementation(({ organizationId }) => {
      if (organizationId === 'org_design') {
        designRolePromise = new Promise((resolve) => {
          resolveRoleUpdate = resolve;
        });
        return designRolePromise;
      }
      return Promise.resolve({ ok: true });
    });
    renderPage();

    await user.click(await screen.findByRole('button', { name: /设计团队/ }));
    await screen.findByText('增长计划');
    await user.selectOptions(screen.getByLabelText('更改 Member 的角色'), 'manager');
    await waitFor(() => expect(api.updateMemberRole).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: /运营团队/ }));
    expect(await screen.findByText('运营节奏')).toBeTruthy();
    const operationsRole = screen.getByLabelText('更改 Ops Member 的角色') as HTMLSelectElement;
    expect(operationsRole.disabled).toBe(false);

    await user.selectOptions(operationsRole, 'manager');
    await waitFor(() =>
      expect(api.updateMemberRole).toHaveBeenCalledWith({
        organizationId: 'org_ops',
        memberId: 'omem_ops_member',
        role: 'manager',
      }),
    );
    await waitFor(() => expect(operationsRole.value).toBe(''));
    const organizationCallsBeforeDesignSettles = api.organizationsList.mock.calls.length;

    await act(async () => {
      resolveRoleUpdate?.({ ok: true });
      await designRolePromise;
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(api.organizationsList).toHaveBeenCalledTimes(organizationCallsBeforeDesignSettles);
    expect(screen.getByText('运营节奏')).toBeTruthy();
    expect(screen.getByText('Ops Member')).toBeTruthy();
    expect(operationsRole.disabled).toBe(false);
    expect(screen.queryByLabelText('团队项目加载中')).toBeNull();
    expect(screen.queryByLabelText('团队成员加载中')).toBeNull();
  });

  it('keeps an off-screen self-demotion uncertain until an authoritative organization refresh settles', async () => {
    const user = userEvent.setup();
    let resolveRoleUpdate: ((value: { ok: true }) => void) | undefined;
    let roleUpdatePromise: Promise<{ ok: true }> | undefined;
    let resolveAuthorityRefresh: ((value: OrganizationListOutput) => void) | undefined;
    let authorityRefreshPromise: Promise<OrganizationListOutput> | undefined;
    const currentAdmin: OrganizationMembersOutput[number] = {
      memberId: 'omem_current',
      userId: 'usr_current',
      displayName: 'Current Admin',
      avatarUrl: null,
      role: 'admin',
      managerUserId: 'usr_owner',
      managerDisplayName: 'Owner',
      status: 'active',
    };
    const operationsOrganization = {
      organizationId: 'org_ops',
      name: '运营团队',
      role: 'member',
      managerDisplayName: 'Ops Manager',
      activeMemberCount: 2,
    } as const;
    const memberOrganization = {
      ...ORGANIZATION_FIXTURES.member,
      managerDisplayName: 'Owner',
    };
    const operationsProject = {
      ...TEAM_PROJECT_RESPONSE,
      projectId: 'prj_ops',
      name: '运营节奏',
      organizationId: 'org_ops',
      organizationName: '运营团队',
      memberRole: 'member',
    } satisfies TeamProjectOutput;
    shell.teamProjectsEnabled = true;
    api.organizationsList
      .mockResolvedValueOnce([ORGANIZATION_FIXTURES.admin, operationsOrganization])
      .mockImplementationOnce(() => {
        authorityRefreshPromise = new Promise((resolve) => {
          resolveAuthorityRefresh = resolve;
        });
        return authorityRefreshPromise;
      });
    api.projectsList.mockImplementation((input) =>
      Promise.resolve(
        input?.organizationId === 'org_ops' ? [operationsProject] : [TEAM_PROJECT_RESPONSE],
      ),
    );
    api.organizationMembers.mockImplementation(({ organizationId }) =>
      Promise.resolve(
        organizationId === 'org_design'
          ? [ORGANIZATION_MEMBERS[0], currentAdmin, ORGANIZATION_MEMBERS[2]]
          : ORGANIZATION_MEMBERS,
      ),
    );
    api.updateMemberRole.mockImplementation(() => {
      roleUpdatePromise = new Promise((resolve) => {
        resolveRoleUpdate = resolve;
      });
      return roleUpdatePromise;
    });
    renderPage();

    await user.click(await screen.findByRole('button', { name: /设计团队/ }));
    await user.selectOptions(screen.getByLabelText('更改 Current Admin 的角色'), 'member');
    await waitFor(() => expect(api.updateMemberRole).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: /运营团队/ }));
    expect(await screen.findByText('运营节奏')).toBeTruthy();

    await act(async () => {
      resolveRoleUpdate?.({ ok: true });
      await roleUpdatePromise;
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(api.organizationsList).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole('button', { name: /设计团队/ }));
    expect(await screen.findByText('当前身份：管理员 · 3 位活跃成员')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '邀请成员' })).toBeNull();
    expect(screen.queryByRole('button', { name: '新建团队项目' })).toBeNull();
    expect(screen.queryByLabelText('更改 Current Admin 的角色')).toBeNull();

    await act(async () => {
      resolveAuthorityRefresh?.([memberOrganization, operationsOrganization]);
      await authorityRefreshPromise;
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(await screen.findByText('当前身份：成员 · 3 位活跃成员')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '邀请成员' })).toBeNull();
    expect(screen.queryByRole('button', { name: '新建团队项目' })).toBeNull();
  });

  it('keeps an off-screen self-deactivation uncertain until the authoritative list removes it', async () => {
    const user = userEvent.setup();
    const lateDeactivation = deferred<{ ok: true }>();
    const authorityRefresh = deferred<OrganizationListOutput>();
    const currentAdmin: OrganizationMembersOutput[number] = {
      memberId: 'omem_current',
      userId: 'usr_current',
      displayName: 'Current Admin',
      avatarUrl: null,
      role: 'admin',
      managerUserId: 'usr_owner',
      managerDisplayName: 'Owner',
      status: 'active',
    };
    shell.teamProjectsEnabled = true;
    api.organizationsList
      .mockResolvedValueOnce([ORGANIZATION_FIXTURES.admin, OPERATIONS_ORGANIZATION])
      .mockImplementationOnce(() => authorityRefresh.promise);
    api.projectsList.mockImplementation((input) =>
      Promise.resolve(
        input?.organizationId === OPERATIONS_ORGANIZATION.organizationId
          ? [OPERATIONS_PROJECT]
          : [TEAM_PROJECT_RESPONSE],
      ),
    );
    api.organizationMembers.mockImplementation(({ organizationId }) =>
      Promise.resolve(
        organizationId === 'org_design'
          ? [ORGANIZATION_MEMBERS[0], currentAdmin, ORGANIZATION_MEMBERS[2]]
          : ORGANIZATION_MEMBERS,
      ),
    );
    api.deactivateMember.mockImplementation(() => lateDeactivation.promise);
    renderPage();

    await user.click(await screen.findByRole('button', { name: /设计团队/ }));
    const operationsWorkspace = screen.getByRole('button', { name: /运营团队/ });
    await user.click(screen.getByRole('button', { name: '移除 Current Admin' }));
    await user.click(
      within(screen.getByRole('dialog', { name: '移除这位团队成员？' })).getByRole('button', {
        name: '移除成员',
      }),
    );
    await waitFor(() => expect(api.deactivateMember).toHaveBeenCalledTimes(1));
    fireEvent.click(operationsWorkspace);
    expect(await screen.findByText('运营节奏')).toBeTruthy();

    await act(async () => {
      lateDeactivation.resolve({ ok: true });
      await lateDeactivation.promise;
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(api.organizationsList).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole('button', { name: /设计团队/ }));
    expect(await screen.findByText('当前身份：管理员 · 3 位活跃成员')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '邀请成员' })).toBeNull();
    expect(screen.queryByRole('button', { name: '新建团队项目' })).toBeNull();
    expect(screen.queryByRole('button', { name: '移除 Current Admin' })).toBeNull();

    await act(async () => {
      authorityRefresh.resolve([OPERATIONS_ORGANIZATION]);
      await authorityRefresh.promise;
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(await screen.findByRole('heading', { name: '个人项目' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /设计团队/ })).toBeNull();
  });

  it.each(OFFSCREEN_MUTATION_CASES)(
    'tombstones workspace A after its late hidden %s failure settles under workspace B',
    async (_label, action) => {
      const lateMutation = deferred<never>();
      deferWorkspaceMutation(action, lateMutation.promise);
      const user = await openDesignAlongsideOperations();
      const operationsWorkspace = screen.getByRole('button', { name: /运营团队/ });

      await beginWorkspaceMutation(user, action);
      await waitFor(() => expect(workspaceMutationCallCount(action)).toBe(1));
      fireEvent.click(operationsWorkspace);
      expect(await screen.findByText('运营节奏')).toBeTruthy();

      await act(async () => {
        lateMutation.reject(trpcError('FORBIDDEN'));
        await lateMutation.promise.catch(() => undefined);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(screen.getByText('运营节奏')).toBeTruthy();
      expect(screen.queryByRole('button', { name: /设计团队/ })).toBeNull();
      expect(screen.queryByText(/失败/)).toBeNull();
    },
  );

  it('clears a workspace tombstone only after a later authoritative list includes the organization', async () => {
    const lateRoleUpdate = deferred<never>();
    api.updateMemberRole.mockImplementation(() => lateRoleUpdate.promise);
    const user = await openDesignAlongsideOperations();
    const designWorkspace = screen.getByRole('button', { name: /设计团队/ });
    const operationsWorkspace = screen.getByRole('button', { name: /运营团队/ });

    await user.selectOptions(screen.getByLabelText('更改 Member 的角色'), 'manager');
    await waitFor(() => expect(api.updateMemberRole).toHaveBeenCalledTimes(1));
    fireEvent.click(operationsWorkspace);
    expect(await screen.findByText('运营节奏')).toBeTruthy();
    await act(async () => {
      lateRoleUpdate.reject(trpcError('FORBIDDEN'));
      await lateRoleUpdate.promise.catch(() => undefined);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.queryByRole('button', { name: /设计团队/ })).toBeNull();
    fireEvent.click(designWorkspace);
    expect(screen.getByText('运营节奏')).toBeTruthy();
    expect(screen.queryByText('增长计划')).toBeNull();

    await user.click(screen.getByRole('button', { name: '刷新团队空间' }));

    const restoredWorkspace = await screen.findByRole('button', { name: /设计团队/ });
    await user.click(restoredWorkspace);
    expect(await screen.findByText('增长计划')).toBeTruthy();
  });

  it('does not let an organization list started before a hidden result clear the newer tombstone', async () => {
    const user = userEvent.setup();
    const lateRoleUpdate = deferred<never>();
    const olderOrganizationList = deferred<OrganizationListOutput>();
    shell.teamProjectsEnabled = true;
    api.organizationsList
      .mockResolvedValueOnce([ORGANIZATION_FIXTURES.owner, OPERATIONS_ORGANIZATION])
      .mockImplementationOnce(() => olderOrganizationList.promise)
      .mockResolvedValue([ORGANIZATION_FIXTURES.owner, OPERATIONS_ORGANIZATION]);
    api.projectsList.mockImplementation((input) =>
      Promise.resolve(
        input?.organizationId === OPERATIONS_ORGANIZATION.organizationId
          ? [OPERATIONS_PROJECT]
          : [TEAM_PROJECT_RESPONSE],
      ),
    );
    api.organizationMembers.mockResolvedValue(ORGANIZATION_MEMBERS);
    api.updateMemberRole.mockImplementation(() => lateRoleUpdate.promise);
    renderPage();

    await user.click(await screen.findByRole('button', { name: /设计团队/ }));
    await user.selectOptions(screen.getByLabelText('更改 Member 的角色'), 'manager');
    await waitFor(() => expect(api.updateMemberRole).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: /运营团队/ }));
    expect(await screen.findByText('运营节奏')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '刷新团队空间' }));
    await waitFor(() => expect(api.organizationsList).toHaveBeenCalledTimes(2));

    await act(async () => {
      lateRoleUpdate.reject(trpcError('FORBIDDEN'));
      await lateRoleUpdate.promise.catch(() => undefined);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.queryByRole('button', { name: /设计团队/ })).toBeNull();

    await act(async () => {
      olderOrganizationList.resolve([ORGANIZATION_FIXTURES.owner, OPERATIONS_ORGANIZATION]);
      await olderOrganizationList.promise;
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.queryByRole('button', { name: /设计团队/ })).toBeNull();

    await user.click(screen.getByRole('button', { name: '刷新团队空间' }));
    expect(await screen.findByRole('button', { name: /设计团队/ })).toBeTruthy();
  });

  it.each(OFFSCREEN_MUTATION_CASES)(
    'keeps workspace A available and workspace B silent after its late generic %s failure',
    async (_label, action, failureCopy) => {
      const lateMutation = deferred<never>();
      deferWorkspaceMutation(action, lateMutation.promise);
      const user = await openDesignAlongsideOperations();
      const operationsWorkspace = screen.getByRole('button', { name: /运营团队/ });

      await beginWorkspaceMutation(user, action);
      await waitFor(() => expect(workspaceMutationCallCount(action)).toBe(1));
      fireEvent.click(operationsWorkspace);
      expect(await screen.findByText('运营节奏')).toBeTruthy();

      await act(async () => {
        lateMutation.reject(new Error('workspace A mutation offline'));
        await lateMutation.promise.catch(() => undefined);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(screen.queryByText(new RegExp(failureCopy))).toBeNull();
      const designWorkspace = screen.getByRole('button', { name: /设计团队/ });
      await user.click(designWorkspace);
      expect(await screen.findByText('增长计划')).toBeTruthy();
    },
  );

  it.each(OFFSCREEN_MUTATION_CASES)(
    'keeps workspace B silent after workspace A late %s success',
    async (_label, action) => {
      const lateMutation = deferSuccessfulWorkspaceMutation(action);
      const user = await openDesignAlongsideOperations();
      const operationsWorkspace = screen.getByRole('button', { name: /运营团队/ });

      await beginWorkspaceMutation(user, action);
      await waitFor(() => expect(workspaceMutationCallCount(action)).toBe(1));
      fireEvent.click(operationsWorkspace);
      expect(await screen.findByText('运营节奏')).toBeTruthy();

      await act(async () => {
        lateMutation.resolve();
        await lateMutation.promise;
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(screen.getByText('运营节奏')).toBeTruthy();
      expect(screen.queryByText(workspaceMutationSuccessCopy(action))).toBeNull();
      expect(screen.getByRole('button', { name: /设计团队/ })).toBeTruthy();
    },
  );

  it('does not show a generic mutation failure from workspace A after selecting workspace B', async () => {
    const user = userEvent.setup();
    let rejectDesignRole: ((reason?: unknown) => void) | undefined;
    let designRolePromise: Promise<{ ok: true }> | undefined;
    const operationsOrganization = {
      organizationId: 'org_ops',
      name: '运营团队',
      role: 'member',
      managerDisplayName: 'Ops Manager',
      activeMemberCount: 2,
    } as const;
    const operationsProject = {
      ...TEAM_PROJECT_RESPONSE,
      projectId: 'prj_ops',
      name: '运营节奏',
      organizationId: 'org_ops',
      organizationName: '运营团队',
      memberRole: 'member',
    } satisfies TeamProjectOutput;
    shell.teamProjectsEnabled = true;
    api.organizationsList.mockResolvedValue([ORGANIZATION_FIXTURES.owner, operationsOrganization]);
    api.projectsList.mockImplementation((input) =>
      Promise.resolve(
        input?.organizationId === 'org_ops' ? [operationsProject] : [TEAM_PROJECT_RESPONSE],
      ),
    );
    api.organizationMembers.mockResolvedValue(ORGANIZATION_MEMBERS);
    api.updateMemberRole.mockImplementation(() => {
      designRolePromise = new Promise((_resolve, reject) => {
        rejectDesignRole = reject;
      });
      return designRolePromise;
    });
    renderPage();

    await user.click(await screen.findByRole('button', { name: /设计团队/ }));
    await user.selectOptions(screen.getByLabelText('更改 Member 的角色'), 'manager');
    await waitFor(() => expect(api.updateMemberRole).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: /运营团队/ }));
    expect(await screen.findByText('运营节奏')).toBeTruthy();

    await act(async () => {
      rejectDesignRole?.(new Error('design mutation offline'));
      await designRolePromise?.catch(() => undefined);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText('运营节奏')).toBeTruthy();
    expect(screen.queryByText(/更新成员角色失败/)).toBeNull();
  });

  it('refreshes the organization summary after a reporting-line mutation', async () => {
    const user = await openOrganization('owner');
    api.updateReportingLine.mockResolvedValue({ ok: true });

    await user.selectOptions(screen.getByLabelText('设置 Member 的直属上级'), 'omem_owner');

    await waitFor(() => expect(api.updateReportingLine).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(api.organizationsList).toHaveBeenCalledTimes(2));
  });

  it('preserves stale team state and retry affordance after unrelated member reconciliation fails', async () => {
    const user = await openOrganization('owner');
    api.updateReportingLine.mockResolvedValue({ ok: true });
    api.organizationsList.mockRejectedValueOnce(new Error('organization reconciliation offline'));

    await user.selectOptions(screen.getByLabelText('设置 Member 的直属上级'), 'omem_owner');

    expect(await screen.findByText('团队工作区列表更新失败，当前保留上次结果')).toBeTruthy();
    expect(screen.getByText('增长计划')).toBeTruthy();
    expect(screen.getByText('Member')).toBeTruthy();
    expect(screen.getByRole('button', { name: '邀请成员' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '新建团队项目' })).toBeTruthy();
    expect(screen.getByLabelText('设置 Member 的直属上级')).toBeTruthy();
    expect(screen.getByRole('button', { name: '刷新团队空间' })).toBeTruthy();
  });

  it('reconciles a self role change before rendering organization actions again', async () => {
    const user = userEvent.setup();
    const currentAdmin: OrganizationMembersOutput[number] = {
      memberId: 'omem_current',
      userId: 'usr_current',
      displayName: 'Current Admin',
      avatarUrl: null,
      role: 'admin',
      managerUserId: 'usr_owner',
      managerDisplayName: 'Owner',
      status: 'active',
    };
    const memberOrganization = {
      ...ORGANIZATION_FIXTURES.member,
      managerDisplayName: 'Owner',
    };
    shell.teamProjectsEnabled = true;
    api.organizationsList
      .mockResolvedValueOnce([ORGANIZATION_FIXTURES.admin])
      .mockResolvedValue([memberOrganization]);
    api.projectsList.mockResolvedValue([TEAM_PROJECT_RESPONSE]);
    api.organizationMembers
      .mockResolvedValueOnce([ORGANIZATION_MEMBERS[0], currentAdmin, ORGANIZATION_MEMBERS[2]])
      .mockResolvedValue([
        ORGANIZATION_MEMBERS[0],
        { ...currentAdmin, role: 'member' },
        ORGANIZATION_MEMBERS[2],
      ]);
    api.updateMemberRole.mockResolvedValue({ ok: true });
    renderPage();

    await user.click(await screen.findByRole('button', { name: /设计团队/ }));
    await user.selectOptions(screen.getByLabelText('更改 Current Admin 的角色'), 'member');

    expect(await screen.findByText('当前身份：成员 · 3 位活跃成员')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '邀请成员' })).toBeNull();
    expect(screen.queryByRole('button', { name: '新建团队项目' })).toBeNull();
    expect(screen.queryByLabelText('更改 Current Admin 的角色')).toBeNull();
  });

  it('suppresses privileged controls by current user identity after transient self-demotion reconciliation failure', async () => {
    const user = userEvent.setup();
    const currentAdmin: OrganizationMembersOutput[number] = {
      memberId: 'omem_current',
      userId: 'usr_current',
      displayName: 'Renamed Account',
      avatarUrl: null,
      role: 'admin',
      managerUserId: 'usr_owner',
      managerDisplayName: 'Owner',
      status: 'active',
    };
    const memberOrganization = {
      ...ORGANIZATION_FIXTURES.member,
      managerDisplayName: 'Owner',
    };
    shell.teamProjectsEnabled = true;
    api.organizationsList
      .mockResolvedValueOnce([ORGANIZATION_FIXTURES.admin])
      .mockRejectedValueOnce(new Error('organization reconciliation offline'))
      .mockResolvedValue([memberOrganization]);
    api.projectsList.mockResolvedValue([TEAM_PROJECT_RESPONSE]);
    api.organizationMembers
      .mockResolvedValueOnce([ORGANIZATION_MEMBERS[0], currentAdmin, ORGANIZATION_MEMBERS[2]])
      .mockResolvedValue([
        ORGANIZATION_MEMBERS[0],
        { ...currentAdmin, role: 'member' },
        ORGANIZATION_MEMBERS[2],
      ]);
    api.updateMemberRole.mockResolvedValue({ ok: true });
    renderPage();

    await user.click(await screen.findByRole('button', { name: /设计团队/ }));
    await user.selectOptions(screen.getByLabelText('更改 Renamed Account 的角色'), 'member');

    expect(await screen.findByText('团队工作区列表更新失败，当前保留上次结果')).toBeTruthy();
    expect(screen.getByRole('button', { name: /设计团队/ })).toBeTruthy();
    expect(screen.getByText('增长计划')).toBeTruthy();
    expect(screen.getByRole('region', { name: '团队成员' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '邀请成员' })).toBeNull();
    expect(screen.queryByRole('button', { name: '新建团队项目' })).toBeNull();
    expect(screen.queryByLabelText('更改 Renamed Account 的角色')).toBeNull();
    expect(screen.queryByRole('button', { name: '移除 Member' })).toBeNull();
    await user.click(screen.getByRole('button', { name: '项目 增长计划 操作' }));
    expect(screen.queryByRole('menuitem', { name: '删除项目' })).toBeNull();
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: '刷新团队空间' }));
    await user.click(await screen.findByRole('button', { name: /设计团队/ }));
    expect(await screen.findByText('当前身份：成员 · 3 位活跃成员')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '邀请成员' })).toBeNull();
    expect(screen.queryByRole('button', { name: '新建团队项目' })).toBeNull();
  });

  it('does nothing when an overlapping organization refresh supersedes mutation reconciliation', async () => {
    const user = userEvent.setup();
    let resolveSupersededRefresh: ((value: OrganizationListOutput) => void) | undefined;
    let supersededRefresh: Promise<OrganizationListOutput> | undefined;
    const newOrganization = {
      organizationId: 'org_new',
      name: '新团队',
      role: 'owner',
      managerDisplayName: null,
      activeMemberCount: 1,
    } as const;
    shell.teamProjectsEnabled = true;
    api.organizationsList
      .mockResolvedValueOnce([ORGANIZATION_FIXTURES.owner])
      .mockImplementationOnce(() => {
        supersededRefresh = new Promise((resolve) => {
          resolveSupersededRefresh = resolve;
        });
        return supersededRefresh;
      })
      .mockResolvedValue([ORGANIZATION_FIXTURES.owner, newOrganization]);
    api.projectsList.mockImplementation((input) =>
      Promise.resolve(input?.organizationId === 'org_design' ? [TEAM_PROJECT_RESPONSE] : []),
    );
    api.organizationMembers.mockImplementation(({ organizationId }) =>
      Promise.resolve(organizationId === 'org_design' ? ORGANIZATION_MEMBERS : []),
    );
    api.updateReportingLine.mockResolvedValue({ ok: true });
    renderPage();

    await user.click(await screen.findByRole('button', { name: /设计团队/ }));
    await screen.findByText('增长计划');
    await user.selectOptions(screen.getByLabelText('设置 Member 的直属上级'), 'omem_owner');
    await waitFor(() => expect(api.organizationsList).toHaveBeenCalledTimes(2));

    await user.click(screen.getByRole('button', { name: '创建团队' }));
    const dialog = screen.getByRole('dialog', { name: '创建团队空间' });
    await user.type(within(dialog).getByLabelText('团队名称'), '新团队');
    await user.click(within(dialog).getByRole('button', { name: '创建团队' }));
    await waitFor(() => expect(api.organizationsList).toHaveBeenCalledTimes(3));
    await user.click(await screen.findByRole('button', { name: /设计团队/ }));
    expect(await screen.findByText('增长计划')).toBeTruthy();

    await act(async () => {
      resolveSupersededRefresh?.([ORGANIZATION_FIXTURES.owner]);
      await supersededRefresh;
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole('button', { name: /设计团队/ })).toBeTruthy();
    expect(screen.getByText('增长计划')).toBeTruthy();
    expect(screen.getByRole('button', { name: '邀请成员' })).toBeTruthy();
    expect(screen.queryByText(/团队工作区.*失败/)).toBeNull();
  });

  it('refreshes the active member count after removing another member', async () => {
    const user = userEvent.setup();
    shell.teamProjectsEnabled = true;
    api.organizationsList
      .mockResolvedValueOnce([ORGANIZATION_FIXTURES.owner])
      .mockResolvedValue([{ ...ORGANIZATION_FIXTURES.owner, activeMemberCount: 2 }]);
    api.projectsList.mockResolvedValue([TEAM_PROJECT_RESPONSE]);
    api.organizationMembers
      .mockResolvedValueOnce(ORGANIZATION_MEMBERS)
      .mockResolvedValue(ORGANIZATION_MEMBERS.slice(0, 2));
    api.deactivateMember.mockResolvedValue({ ok: true });
    renderPage();

    await user.click(await screen.findByRole('button', { name: /设计团队/ }));
    await user.click(await screen.findByRole('button', { name: '移除 Member' }));
    await user.click(
      within(screen.getByRole('dialog', { name: '移除这位团队成员？' })).getByRole('button', {
        name: '移除成员',
      }),
    );

    expect(await screen.findByText('当前身份：所有者 · 2 位活跃成员')).toBeTruthy();
    expect(screen.getByText('2 位活跃成员')).toBeTruthy();
    expect(screen.queryByText('Member')).toBeNull();
  });

  it('falls back to personal space after the current member is deactivated', async () => {
    const user = userEvent.setup();
    const currentAdmin: OrganizationMembersOutput[number] = {
      memberId: 'omem_current',
      userId: 'usr_current',
      displayName: 'Current Admin',
      avatarUrl: null,
      role: 'admin',
      managerUserId: 'usr_owner',
      managerDisplayName: 'Owner',
      status: 'active',
    };
    shell.teamProjectsEnabled = true;
    api.organizationsList
      .mockResolvedValueOnce([ORGANIZATION_FIXTURES.admin])
      .mockResolvedValue([]);
    api.projectsList.mockResolvedValue([TEAM_PROJECT_RESPONSE]);
    api.organizationMembers.mockResolvedValue([ORGANIZATION_MEMBERS[0], currentAdmin]);
    api.deactivateMember.mockResolvedValue({ ok: true });
    renderPage();

    await user.click(await screen.findByRole('button', { name: /设计团队/ }));
    await user.click(await screen.findByRole('button', { name: '移除 Current Admin' }));
    await user.click(
      within(screen.getByRole('dialog', { name: '移除这位团队成员？' })).getByRole('button', {
        name: '移除成员',
      }),
    );

    expect(await screen.findByRole('heading', { name: '个人项目' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /设计团队/ })).toBeNull();
    expect(screen.queryByText('增长计划')).toBeNull();
    expect(screen.queryByRole('region', { name: '团队成员' })).toBeNull();
  });
});
