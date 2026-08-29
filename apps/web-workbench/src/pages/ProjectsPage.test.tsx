// @vitest-environment happy-dom

import { ToastProvider } from '@/components/ui/toast';
import type { UiProject } from '@/types/task';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectsPage } from './ProjectsPage';

const api = vi.hoisted(() => ({
  organizationsList: vi.fn(),
  organizationsCreate: vi.fn(),
  organizationMembers: vi.fn(),
  createInvitation: vi.fn(),
  updateReportingLine: vi.fn(),
  updateMemberRole: vi.fn(),
  deactivateMember: vi.fn(),
  projectsList: vi.fn(),
  projectsCreate: vi.fn(),
  projectsDelete: vi.fn(),
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
} as const;

const ORGANIZATION_MEMBERS = [
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
    organizationId: 'org_design',
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
};

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
  api.projectsDelete.mockResolvedValue({ ok: true });
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
      </ToastProvider>
    </MemoryRouter>
  );
}

function renderPage(path = '/projects'): ReturnType<typeof render> {
  return render(pageElement(path));
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

  it('shows the workspace switcher and starts personal and organization loads without waiting for either one', async () => {
    const user = userEvent.setup();
    let resolvePersonal: ((value: { ok: true; projects: UiProject[] }) => void) | undefined;
    let resolveOrganizations: ((value: unknown[]) => void) | undefined;
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
    let resolveProjects: ((value: unknown[]) => void) | undefined;
    let resolveMembers: ((value: unknown[]) => void) | undefined;
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
    let resolveMembers: ((value: unknown[]) => void) | undefined;
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

  it('does not offer team-project mutation to an organization admin whose project role is viewer', async () => {
    const user = userEvent.setup();
    shell.teamProjectsEnabled = true;
    api.organizationsList.mockResolvedValue([ORGANIZATION_FIXTURES.admin]);
    api.projectsList.mockResolvedValue([{ ...TEAM_PROJECT_RESPONSE, memberRole: 'viewer' }]);
    api.organizationMembers.mockResolvedValue(ORGANIZATION_MEMBERS);
    renderPage();
    await user.click(await screen.findByRole('button', { name: /设计团队/ }));
    await screen.findByText('增长计划');

    await user.click(screen.getByRole('button', { name: '项目 增长计划 操作' }));

    expect(screen.queryByRole('menuitem', { name: '删除项目' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: '重命名项目' })).toBeNull();
  });

  it('creates an organization and a team project through scoped dialogs', async () => {
    const user = await openOrganization('manager');
    api.organizationsList.mockResolvedValueOnce([ORGANIZATION_FIXTURES.manager]).mockResolvedValue([
      ORGANIZATION_FIXTURES.manager,
      {
        organizationId: 'org_new',
        name: '新团队',
        role: 'owner',
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
