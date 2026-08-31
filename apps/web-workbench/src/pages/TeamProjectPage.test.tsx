// @vitest-environment happy-dom

import type { TeamTaskWorkbenchRow } from '@/lib/team-task-workbench-state';
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
  teamTaskList: vi.fn<WorkspaceClient['teamTasks']['list']['query']>(),
  planningOptions: vi.fn<WorkspaceClient['teamTasks']['planningOptions']['query']>(),
  teamTaskGet: vi.fn<WorkspaceClient['teamTasks']['get']['query']>(),
  createDraft: vi.fn<WorkspaceClient['teamTasks']['createDraft']['mutate']>(),
  publish: vi.fn<WorkspaceClient['teamTasks']['publish']['mutate']>(),
  assign: vi.fn<WorkspaceClient['teamTasks']['assign']['mutate']>(),
  assignMilestone: vi.fn<WorkspaceClient['teamTasks']['assignMilestone']['mutate']>(),
  addDependency: vi.fn<WorkspaceClient['teamTasks']['addDependency']['mutate']>(),
  review: vi.fn<WorkspaceClient['teamTasks']['review']['mutate']>(),
  claim: vi.fn<WorkspaceClient['teamTasks']['claim']['mutate']>(),
  acceptAssignment: vi.fn<WorkspaceClient['teamTasks']['acceptAssignment']['mutate']>(),
  selectClaim: vi.fn<WorkspaceClient['teamTasks']['selectClaim']['mutate']>(),
  start: vi.fn<WorkspaceClient['teamTasks']['start']['mutate']>(),
  block: vi.fn<WorkspaceClient['teamTasks']['block']['mutate']>(),
  unblock: vi.fn<WorkspaceClient['teamTasks']['unblock']['mutate']>(),
  submit: vi.fn<WorkspaceClient['teamTasks']['submit']['mutate']>(),
  appeal: vi.fn<WorkspaceClient['teamTasks']['appeal']['mutate']>(),
  close: vi.fn<WorkspaceClient['teamTasks']['close']['mutate']>(),
  archive: vi.fn<WorkspaceClient['teamTasks']['archive']['mutate']>(),
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
      teamTaskLifecycleEnabled: true,
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
    teamTasks: {
      list: { query: api.teamTaskList },
      planningOptions: { query: api.planningOptions },
      get: { query: api.teamTaskGet },
      createDraft: { mutate: api.createDraft },
      publish: { mutate: api.publish },
      assign: { mutate: api.assign },
      assignMilestone: { mutate: api.assignMilestone },
      addDependency: { mutate: api.addDependency },
      review: { mutate: api.review },
      claim: { mutate: api.claim },
      acceptAssignment: { mutate: api.acceptAssignment },
      selectClaim: { mutate: api.selectClaim },
      start: { mutate: api.start },
      block: { mutate: api.block },
      unblock: { mutate: api.unblock },
      submit: { mutate: api.submit },
      appeal: { mutate: api.appeal },
      close: { mutate: api.close },
      archive: { mutate: api.archive },
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
    organizationMemberId: 'omem_lead',
    userId: 'usr_lead',
    displayName: 'Lin',
    avatarUrl: null,
    role: 'lead',
  },
  {
    projectMemberId: 'pmem_viewer',
    organizationMemberId: 'omem_viewer',
    userId: 'usr_current',
    displayName: 'Viewer',
    avatarUrl: null,
    role: 'viewer',
  },
];

const TEAM_TASKS: TeamTaskWorkbenchRow[] = [
  {
    id: 'twi_01JTEAMWORKBENCH0000000001',
    projectId: 'prj_team',
    title: '完成官网发布复盘',
    description: '复盘官网改版全流程并给出下一步计划',
    assignmentMode: 'direct',
    state: 'submitted',
    version: 2,
    dueAt: '2026-09-02T10:00:00.000Z',
    revisionRound: 1,
    responsibleUserId: 'usr_current',
    responsibleDisplayName: 'Viewer',
    collaboratorUserIds: [],
    milestoneId: 'tml_01JTEAMWORKBENCH0000000001',
    milestone: '官网改版',
    submittedOnTime: true,
    latestSubmissionId: 'tsb_01JTEAMWORKBENCH000000001',
    accepted: false,
    updatedAt: '2026-08-31T08:00:00.000Z',
    timeline: [
      { kind: 'contract', label: '验收契约 v2', at: '2026-08-29T08:00:00.000Z' },
      { kind: 'assignment', label: '任务已指派', at: '2026-08-29T08:10:00.000Z' },
      { kind: 'submission', label: '按时提交', at: '2026-08-31T08:00:00.000Z' },
      { kind: 'ai', label: 'AI 贡献已提交，等待人工确认', at: '2026-08-31T08:01:00.000Z' },
    ],
    contract: {
      version: 2,
      objective: '输出可执行的官网发布复盘',
      criteria: [{ id: 'criterion-output', description: '覆盖目标、过程与结果三个维度' }],
      approverUserId: 'usr_current',
      arbitratorUserId: 'usr_arbitrator',
    },
  },
];

function trpcError(code: 'NOT_FOUND' | 'FORBIDDEN' | 'UNAUTHORIZED'): Error {
  return Object.assign(new Error(code.toLowerCase()), { data: { code } });
}

beforeEach(() => {
  shell.teamProjectsEnabled = true;
  api.projectGet.mockReset().mockResolvedValue(TEAM_PROJECT);
  api.projectMembers.mockReset().mockResolvedValue(PROJECT_MEMBERS);
  api.teamTaskList.mockReset().mockResolvedValue(TEAM_TASKS as never);
  api.planningOptions.mockReset().mockResolvedValue({
    milestones: [{ id: 'tml_01JTEAMWORKBENCH0000000001', title: '官网改版' }],
  });
  api.teamTaskGet.mockReset().mockResolvedValue(TEAM_TASKS[0] as never);
  api.createDraft.mockReset().mockResolvedValue({ workItemId: 'twi_new', version: 1 } as never);
  api.publish.mockReset().mockResolvedValue({ workItemId: 'twi_new', version: 2 } as never);
  api.assign.mockReset().mockResolvedValue({ workItemId: 'twi_new', version: 3 } as never);
  api.assignMilestone.mockReset().mockResolvedValue({ workItemId: 'twi_new', version: 3 } as never);
  api.addDependency.mockReset().mockResolvedValue({ workItemId: 'twi_new', version: 3 } as never);
  api.review.mockReset().mockResolvedValue({ workItemId: TEAM_TASKS[0].id, version: 3 } as never);
  for (const mutation of [
    api.claim,
    api.acceptAssignment,
    api.selectClaim,
    api.start,
    api.block,
    api.unblock,
    api.submit,
    api.appeal,
    api.close,
    api.archive,
  ]) {
    mutation.mockReset().mockResolvedValue({ workItemId: TEAM_TASKS[0].id, version: 3 } as never);
  }
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
  it('loads the bounded task detail before rendering contract and timeline facts', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: '增长计划' });

    await user.click(screen.getByRole('button', { name: '查看 完成官网发布复盘' }));

    await waitFor(() =>
      expect(api.teamTaskGet).toHaveBeenCalledWith({
        projectId: 'prj_team',
        workItemId: TEAM_TASKS[0].id,
      }),
    );
    expect(await screen.findByText('输出可执行的官网发布复盘')).toBeTruthy();
    expect(screen.getByText('AI 贡献已提交，等待人工确认')).toBeTruthy();
  });

  it('runs create, publish, planning, and assignment mutations in version order', async () => {
    const user = userEvent.setup();
    api.projectGet.mockResolvedValue({ ...TEAM_PROJECT, memberRole: 'lead' });
    api.projectMembers.mockResolvedValue([
      {
        projectMemberId: 'pmem_lead',
        organizationMemberId: 'omem_lead',
        userId: 'usr_lead',
        displayName: 'Lin',
        avatarUrl: null,
        role: 'lead',
      },
      {
        projectMemberId: 'pmem_owner',
        organizationMemberId: 'omem_owner',
        userId: 'usr_owner',
        displayName: '张靖',
        avatarUrl: null,
        role: 'member',
      },
      {
        projectMemberId: 'pmem_arb',
        organizationMemberId: 'omem_arb',
        userId: 'usr_arb',
        displayName: '周宁',
        avatarUrl: null,
        role: 'member',
      },
      {
        projectMemberId: 'pmem_collab',
        organizationMemberId: 'omem_collab',
        userId: 'usr_collab',
        displayName: '陈安',
        avatarUrl: null,
        role: 'member',
      },
    ] as never);
    api.assignMilestone.mockResolvedValue({ workItemId: 'twi_new', version: 3 } as never);
    api.addDependency
      .mockRejectedValueOnce(new Error('dependency temporarily unavailable'))
      .mockResolvedValueOnce({ workItemId: 'twi_new', version: 4 } as never);
    api.assign
      .mockResolvedValueOnce({ workItemId: 'twi_new', version: 5 } as never)
      .mockResolvedValueOnce({ workItemId: 'twi_new', version: 6 } as never);
    renderPage();
    await screen.findByRole('heading', { name: '增长计划' });
    await user.click(screen.getByRole('button', { name: '新建任务' }));
    await user.type(screen.getByLabelText('任务名称'), '优化帮助中心');
    await user.selectOptions(screen.getByLabelText('负责人'), 'omem_owner');
    await user.selectOptions(screen.getByLabelText('协作者'), 'omem_collab');
    await user.selectOptions(screen.getByLabelText('里程碑'), 'tml_01JTEAMWORKBENCH0000000001');
    await user.selectOptions(screen.getByLabelText('依赖任务'), TEAM_TASKS[0].id);
    await user.type(screen.getByLabelText('截止时间'), '2026-09-04T10:00');
    await user.type(screen.getByLabelText('验收目标'), '让用户快速定位答案');
    await user.type(screen.getByLabelText('交付物'), '一份已发布的帮助中心页面');
    await user.type(screen.getByLabelText('验收标准 1'), '390px 与 1440px 截图均无横向溢出');
    await user.type(screen.getByLabelText('必需证据'), '桌面端与移动端发布截图');
    await user.selectOptions(screen.getByLabelText('验收人'), 'omem_lead');
    await user.selectOptions(screen.getByLabelText('独立仲裁人'), 'omem_arb');
    await user.click(screen.getByRole('checkbox', { name: '我已复核验收契约' }));

    await user.click(screen.getByRole('button', { name: '创建并发布任务' }));

    expect((await screen.findByRole('alert')).textContent).toContain(
      '创建尚未完成；系统已保留本次续跑状态',
    );
    await user.click(screen.getByRole('button', { name: '继续完成配置' }));

    await waitFor(() => expect(api.assign).toHaveBeenCalledTimes(2));
    expect(api.createDraft).toHaveBeenCalledTimes(1);
    expect(api.publish).toHaveBeenCalledTimes(1);
    expect(api.assignMilestone).toHaveBeenCalledTimes(1);
    expect(api.addDependency).toHaveBeenCalledTimes(2);
    expect(api.assignMilestone).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedVersion: 2,
        milestoneId: 'tml_01JTEAMWORKBENCH0000000001',
      }),
    );
    expect(api.addDependency).toHaveBeenCalledWith(
      expect.objectContaining({ expectedVersion: 3, dependsOnWorkItemId: TEAM_TASKS[0].id }),
    );
    expect(api.assign).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        expectedVersion: 4,
        targetMemberId: 'omem_owner',
        role: 'responsible',
      }),
    );
    expect(api.assign).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        expectedVersion: 5,
        targetMemberId: 'omem_collab',
        role: 'collaborator',
      }),
    );
    expect(api.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        contract: expect.objectContaining({
          approverId: 'omem_lead',
          arbitratorId: 'omem_arb',
          maxRevisionRounds: 2,
        }),
      }),
    );
  });

  it('submits a real accepted review against the loaded submission and refreshes', async () => {
    const user = userEvent.setup();
    api.projectGet.mockResolvedValue({ ...TEAM_PROJECT, memberRole: 'lead' });
    renderPage();
    await screen.findByRole('heading', { name: '增长计划' });
    await user.click(screen.getByRole('button', { name: '查看 完成官网发布复盘' }));
    await screen.findByText('输出可执行的官网发布复盘');

    await user.click(screen.getByRole('button', { name: '通过验收' }));

    await waitFor(() => expect(api.review).toHaveBeenCalledTimes(1));
    expect(api.review).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'prj_team',
        workItemId: TEAM_TASKS[0].id,
        submissionId: TEAM_TASKS[0].latestSubmissionId,
        expectedVersion: 2,
        decision: 'accepted',
      }),
    );
    expect(api.teamTaskList.mock.calls.length).toBeGreaterThan(1);
  });

  it('exposes a legal member action and sends the current optimistic version', async () => {
    const user = userEvent.setup();
    const startable = { ...TEAM_TASKS[0], state: 'accepted_by_member', latestSubmissionId: null };
    api.projectGet.mockResolvedValue({ ...TEAM_PROJECT, memberRole: 'member' });
    api.projectMembers.mockResolvedValue([
      {
        projectMemberId: 'pmem_current',
        organizationMemberId: 'omem_current',
        userId: 'usr_current',
        displayName: 'Viewer',
        avatarUrl: null,
        role: 'member',
      },
    ] as never);
    api.teamTaskList.mockResolvedValue([startable] as never);
    api.teamTaskGet.mockResolvedValue(startable as never);
    renderPage();
    await screen.findByRole('heading', { name: '增长计划' });
    await user.click(screen.getByRole('button', { name: '查看 完成官网发布复盘' }));

    await user.click(await screen.findByRole('button', { name: '开始任务' }));

    await waitFor(() => expect(api.start).toHaveBeenCalledTimes(1));
    expect(api.start).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'prj_team',
        workItemId: TEAM_TASKS[0].id,
        expectedVersion: 2,
      }),
    );
  });

  it('lets a lead select a real leader-select applicant and refreshes the task list', async () => {
    const user = userEvent.setup();
    const selectable = {
      ...TEAM_TASKS[0],
      assignmentMode: 'leader_select' as const,
      state: 'claimable' as const,
      responsibleUserId: null,
      responsibleDisplayName: null,
      latestSubmissionId: null,
      canSelectClaim: true,
      claimApplicants: [
        {
          assignmentId: 'tas_applicant_1',
          userId: 'usr_applicant',
          displayName: '陈安',
        },
      ],
    };
    api.projectGet.mockResolvedValue({ ...TEAM_PROJECT, memberRole: 'lead' });
    api.teamTaskList.mockResolvedValue([selectable] as never);
    api.teamTaskGet.mockResolvedValue(selectable as never);
    renderPage();
    await screen.findByRole('heading', { name: '增长计划' });
    await user.click(screen.getByRole('button', { name: '查看 完成官网发布复盘' }));

    await user.click(await screen.findByRole('button', { name: '选择 陈安' }));

    await waitFor(() => expect(api.selectClaim).toHaveBeenCalledTimes(1));
    expect(api.selectClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'prj_team',
        workItemId: TEAM_TASKS[0].id,
        assignmentId: 'tas_applicant_1',
        expectedVersion: 2,
      }),
    );
    expect(api.teamTaskList.mock.calls.length).toBeGreaterThan(1);
  });

  it('opens a real appeal with the latest bounded submission and review ids', async () => {
    const user = userEvent.setup();
    const taskContract = TEAM_TASKS[0].contract;
    if (!taskContract) throw new Error('team task fixture requires a contract');
    const appealable = {
      ...TEAM_TASKS[0],
      state: 'revision_requested' as const,
      revisionRound: 2,
      responsibleUserId: 'usr_current',
      latestReviewId: 'trv_01JTEAMWORKBENCH000000001',
      contract: { ...taskContract, approverUserId: 'usr_lead' },
    };
    api.projectGet.mockResolvedValue({ ...TEAM_PROJECT, memberRole: 'member' });
    api.projectMembers.mockResolvedValue([
      {
        projectMemberId: 'pmem_current',
        organizationMemberId: 'omem_current',
        userId: 'usr_current',
        displayName: 'Viewer',
        avatarUrl: null,
        role: 'member',
      },
    ] as never);
    api.teamTaskList.mockResolvedValue([appealable] as never);
    api.teamTaskGet.mockResolvedValue(appealable as never);
    renderPage();
    await screen.findByRole('heading', { name: '增长计划' });
    await user.click(screen.getByRole('button', { name: '查看 完成官网发布复盘' }));
    await user.type(screen.getByLabelText('申诉理由'), '证据已覆盖契约标准，请独立复核。');
    await user.click(screen.getByRole('button', { name: '提交独立仲裁' }));

    await waitFor(() => expect(api.appeal).toHaveBeenCalledTimes(1));
    expect(api.appeal).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'prj_team',
        workItemId: TEAM_TASKS[0].id,
        submissionId: TEAM_TASKS[0].latestSubmissionId,
        reviewId: 'trv_01JTEAMWORKBENCH000000001',
        expectedVersion: 2,
        disputeType: 'criterion_application',
      }),
    );
  });

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
    expect(screen.getByRole('complementary', { name: '项目成员' })).toBeTruthy();
    expect(screen.getByText('Lin')).toBeTruthy();
    expect(screen.getByText('当前角色：仅查看')).toBeTruthy();
    expect(api.teamTaskList).toHaveBeenCalledWith({ projectId: 'prj_team' });
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
    expect(api.teamTaskList).not.toHaveBeenCalled();
  });

  it('keeps a viewer read-only while exposing the team task workspace', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: '增长计划' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /重命名项目|删除项目|移除 Lin/ })).toBeNull();
    expect(screen.getByRole('tab', { name: /团队任务/ }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.queryByRole('button', { name: '新建任务' })).toBeNull();
    expect(screen.queryByText('团队任务执行将在后续阶段开放')).toBeNull();
    expect(screen.getAllByText('完成官网发布复盘')).toHaveLength(2);
  });

  it('keeps overview and members usable when task loading fails', async () => {
    api.teamTaskList.mockRejectedValue(new Error('tasks offline'));

    renderPage();

    expect(await screen.findByRole('heading', { name: '增长计划' })).toBeTruthy();
    expect(screen.getByText('Lin')).toBeTruthy();
    expect(screen.getByText('团队任务暂时无法加载')).toBeTruthy();
    expect(screen.getByRole('button', { name: '重试团队任务' })).toBeTruthy();
  });

  it('shows submitted-on-time and accepted as independent facts and never labels AI as accepted', async () => {
    renderPage();

    expect(await screen.findAllByText('完成官网发布复盘')).toHaveLength(2);
    expect(screen.getByRole('cell', { name: '按时提交：是' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: '验收通过：—' })).toBeTruthy();

    await userEvent.setup().click(screen.getByRole('button', { name: '查看 完成官网发布复盘' }));
    expect(screen.getByText('AI 贡献已提交，等待人工确认')).toBeTruthy();
    expect(screen.queryByText('AI 已验收')).toBeNull();
  });
});
