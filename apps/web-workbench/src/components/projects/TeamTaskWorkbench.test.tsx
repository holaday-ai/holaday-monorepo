// @vitest-environment happy-dom

import type { TeamTaskWorkbenchRow } from '@/lib/team-task-workbench-state';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TeamTaskWorkbench } from './TeamTaskWorkbench';

const REVIEW_TASK: TeamTaskWorkbenchRow = {
  id: 'twi_01JTEAMWORKBENCH0000000001',
  projectId: 'prj_team',
  title: '完成官网发布复盘',
  description: '复盘官网改版全流程并给出下一步计划',
  assignmentMode: 'direct',
  state: 'submitted',
  version: 2,
  dueAt: '2026-09-02T10:00:00.000Z',
  revisionRound: 1,
  responsibleUserId: 'usr_me',
  responsibleDisplayName: '张靖',
  collaboratorUserIds: [],
  milestone: '官网改版',
  submittedOnTime: true,
  latestSubmissionId: 'tsb_01JTEAMWORKBENCH000000001',
  accepted: null,
  contract: {
    version: 2,
    objective: '输出一份可验证的发布复盘',
    criteria: [{ id: 'criterion-1', description: '覆盖目标、过程与结果三个维度' }],
    approverUserId: 'usr_me',
    arbitratorUserId: 'usr_arbitrator',
  },
  updatedAt: '2026-08-31T08:00:00.000Z',
};

afterEach(cleanup);

describe('TeamTaskWorkbench interaction boundaries', () => {
  it('defaults a member to my work and a lead to project work', () => {
    const { rerender } = renderWorkbench({ role: 'member' });
    expect(screen.getByRole('tab', { name: /我的任务/ }).getAttribute('aria-selected')).toBe(
      'true',
    );

    rerender(
      // biome-ignore lint/a11y/useValidAriaRole: role is a typed project authorization prop.
      <TeamTaskWorkbench {...baseProps} role="lead" rows={[REVIEW_TASK]} onRetry={vi.fn()} />,
    );
    expect(screen.getByRole('tab', { name: /团队任务/ }).getAttribute('aria-selected')).toBe(
      'true',
    );
  });

  it('switches between a compact list and board without losing the selected scope', async () => {
    const user = userEvent.setup();
    renderWorkbench({ role: 'lead' });

    await user.click(screen.getByRole('button', { name: '看板视图' }));

    expect(screen.getByRole('region', { name: '任务看板' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /团队任务/ }).getAttribute('aria-selected')).toBe(
      'true',
    );
    await user.click(screen.getByRole('button', { name: '列表视图' }));
    expect(screen.getByRole('table', { name: '团队任务列表' })).toBeTruthy();
  });

  it('provides a compact mobile task list without relying on the desktop table', () => {
    renderWorkbench({ role: 'lead' });

    const mobileList = screen.getByRole('list', { name: '移动团队任务列表' });
    expect(mobileList).toBeTruthy();
    expect(
      screen
        .getByRole('button', { name: '移动端查看 完成官网发布复盘' })
        .classList.contains('min-h-11'),
    ).toBe(true);
    expect(screen.getByText('按时：是')).toBeTruthy();
    expect(screen.getByText('验收：—')).toBeTruthy();
  });

  it('requires an explicit contract review and flags vague criteria before task creation', async () => {
    const user = userEvent.setup();
    const partialMessage =
      '创建尚未完成；系统已保留本次续跑状态。请点击“继续完成配置”，不要重复新建。';
    const onCreateTask = vi
      .fn()
      .mockRejectedValueOnce(new Error(partialMessage))
      .mockResolvedValueOnce(undefined);
    renderWorkbench({ role: 'lead', onCreateTask });

    await user.click(screen.getByRole('button', { name: '新建任务' }));
    expect(screen.queryByLabelText(/奖励|金额/)).toBeNull();
    await user.type(screen.getByLabelText('任务名称'), '优化帮助中心');
    await user.type(screen.getByLabelText('验收目标'), '让用户能快速定位答案');
    await user.type(screen.getByLabelText('交付物'), '一份已发布的帮助中心页面');
    await user.type(screen.getByLabelText('必需证据'), '390px 与 1440px 发布截图');
    await user.type(screen.getByLabelText('截止时间'), '2026-09-03T10:00');
    await user.selectOptions(screen.getByLabelText('负责人'), 'omem_me');
    await user.selectOptions(screen.getByLabelText('验收人'), 'omem_lead');
    await user.selectOptions(screen.getByLabelText('独立仲裁人'), 'omem_arbitrator');
    await user.type(screen.getByLabelText('验收标准 1'), '尽量把页面做好');

    expect(screen.getByText('标准过于模糊，请补充可观察的结果或阈值')).toBeTruthy();
    expect(screen.getByRole('button', { name: '创建并发布任务' }).hasAttribute('disabled')).toBe(
      true,
    );

    await user.clear(screen.getByLabelText('验收标准 1'));
    await user.type(screen.getByLabelText('验收标准 1'), '390px 与 1440px 截图均无横向溢出');
    await user.click(screen.getByRole('checkbox', { name: '我已复核验收契约' }));
    await user.selectOptions(screen.getByLabelText('负责人'), 'omem_lead');
    expect(screen.getByText(/负责人、协作者不能同时担任验收人/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '创建并发布任务' }).hasAttribute('disabled')).toBe(
      true,
    );
    await user.selectOptions(screen.getByLabelText('负责人'), 'omem_me');
    expect(screen.getByRole('button', { name: '创建并发布任务' }).hasAttribute('disabled')).toBe(
      false,
    );
    await user.click(screen.getByRole('button', { name: '创建并发布任务' }));
    expect((await screen.findByRole('alert')).textContent).toContain(partialMessage);
    expect(screen.getByRole('button', { name: '继续完成配置' }).hasAttribute('disabled')).toBe(
      false,
    );
    expect(
      (screen.getByLabelText('任务名称').closest('fieldset') as HTMLFieldSetElement | null)
        ?.disabled,
    ).toBe(true);
    await user.click(screen.getByRole('button', { name: '继续完成配置' }));
    expect(onCreateTask).toHaveBeenCalledTimes(2);
  });

  it('keeps rework disabled until every required field is present', async () => {
    const user = userEvent.setup();
    renderWorkbench({ role: 'lead' });
    await user.click(screen.getByRole('button', { name: '查看 完成官网发布复盘' }));

    expect(screen.getAllByText('—').length).toBeGreaterThan(0);

    const rework = screen.getByRole('button', { name: '要求返工' });
    expect(rework.hasAttribute('disabled')).toBe(true);
    await user.click(screen.getByRole('checkbox', { name: /覆盖目标、过程与结果三个维度/ }));
    await user.type(screen.getByLabelText('证据或缺失证据'), '缺少移动端上线截图');
    await user.type(screen.getByLabelText('返工说明'), '补充移动端截图并说明与桌面端差异');
    await user.type(screen.getByLabelText('新截止时间'), '2026-09-03T10:00');
    expect(rework.hasAttribute('disabled')).toBe(false);
  });

  it('keeps detail mutations hidden until detail succeeds and restores focus after closing', async () => {
    const user = userEvent.setup();
    let resolveDetail: ((task: TeamTaskWorkbenchRow) => void) | undefined;
    const detail = new Promise<TeamTaskWorkbenchRow>((resolve) => {
      resolveDetail = resolve;
    });
    renderWorkbench({
      role: 'lead',
      onLoadDetail: () => detail,
    });
    const trigger = screen.getByRole('button', { name: '查看 完成官网发布复盘' });

    await user.click(trigger);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '关闭任务详情' }));
    expect(screen.queryByRole('region', { name: '验收操作' })).toBeNull();
    resolveDetail?.(REVIEW_TASK);
    expect(await screen.findByRole('region', { name: '验收操作' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '关闭任务详情' }));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('replaces ordinary rework with arbitration after two revision rounds', async () => {
    const user = userEvent.setup();
    const onReviewTask = vi.fn().mockResolvedValue(undefined);
    renderWorkbench({
      role: 'lead',
      rows: [{ ...REVIEW_TASK, revisionRound: 2 }],
      onReviewTask,
    });
    await user.click(screen.getByRole('button', { name: '查看 完成官网发布复盘' }));

    expect(screen.queryByRole('button', { name: '要求返工' })).toBeNull();
    expect(screen.getByRole('button', { name: '通过验收' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '移交独立仲裁' }));
    expect(onReviewTask).toHaveBeenCalledWith(
      expect.objectContaining({ decision: 'escalate_arbitration' }),
    );
  });

  it('lets the responsible member open the real appeal after the final review handoff', async () => {
    const user = userEvent.setup();
    const onTaskAction = vi.fn().mockResolvedValue(undefined);
    const reviewContract = REVIEW_TASK.contract;
    if (!reviewContract) throw new Error('review fixture requires a contract');
    const finalReviewTask = {
      ...REVIEW_TASK,
      state: 'revision_requested' as const,
      revisionRound: 2,
      latestReviewId: 'trv_01JTEAMWORKBENCH000000001',
      responsibleUserId: 'usr_me',
      contract: { ...reviewContract, approverUserId: 'usr_lead' },
    };
    renderWorkbench({ role: 'member', rows: [finalReviewTask], onTaskAction });
    await user.click(screen.getByRole('button', { name: '查看 完成官网发布复盘' }));
    await user.type(screen.getByLabelText('申诉理由'), '当前证据已覆盖契约标准，请独立复核。');
    await user.click(screen.getByRole('button', { name: '提交独立仲裁' }));

    expect(onTaskAction).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'appeal',
        grounds: '当前证据已覆盖契约标准，请独立复核。',
      }),
    );
  });

  it('renders retry, stale and empty states without reducing action targets below 44px', () => {
    const { rerender } = renderWorkbench({ role: 'lead', rows: [], loading: true });
    expect(screen.getByLabelText('团队任务加载中')).toBeTruthy();

    rerender(
      // biome-ignore lint/a11y/useValidAriaRole: role is a typed project authorization prop.
      <TeamTaskWorkbench
        {...baseProps}
        role="lead"
        rows={[]}
        stale
        error="团队任务暂时无法加载"
        onRetry={vi.fn()}
      />,
    );
    const retry = screen.getByRole('button', { name: '重试团队任务' });
    expect(retry.classList.contains('h-11')).toBe(true);
    expect(screen.getByText('当前显示上次同步结果')).toBeTruthy();
  });
});

const baseProps = {
  currentUserId: 'usr_me',
  members: [
    {
      userId: 'usr_me',
      organizationMemberId: 'omem_me',
      displayName: '张靖',
      role: 'member' as const,
    },
    {
      userId: 'usr_lead',
      organizationMemberId: 'omem_lead',
      displayName: '李可',
      role: 'lead' as const,
    },
    {
      userId: 'usr_arbitrator',
      organizationMemberId: 'omem_arbitrator',
      displayName: '周宁',
      role: 'member' as const,
    },
  ],
  milestoneOptions: [{ id: 'tml_01JTEAMWORKBENCH0000000001', title: '官网改版' }],
  loading: false,
  error: null,
  stale: false,
  onRetry: vi.fn(),
  onCreateTask: vi.fn().mockResolvedValue(undefined),
  onReviewTask: vi.fn().mockResolvedValue(undefined),
};

function renderWorkbench(overrides: Partial<React.ComponentProps<typeof TeamTaskWorkbench>> = {}) {
  return render(
    // biome-ignore lint/a11y/useValidAriaRole: role is a typed project authorization prop.
    <TeamTaskWorkbench
      {...baseProps}
      role="lead"
      rows={[REVIEW_TASK]}
      onRetry={vi.fn()}
      {...overrides}
    />,
  );
}
