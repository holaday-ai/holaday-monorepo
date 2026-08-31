import { describe, expect, it } from 'vitest';
import {
  type TeamTaskWorkbenchRow,
  applyTaskLoadResult,
  availableTaskActions,
  defaultTaskScope,
  groupTeamTasks,
  reviewRevisionReadiness,
  taskStateLabel,
  validateContractCriteria,
} from './team-task-workbench-state';

const TASKS = [
  task({ id: 't-mine', state: 'in_progress', responsibleUserId: 'usr-me' }),
  task({ id: 't-claim', state: 'claimable', responsibleUserId: null }),
  task({ id: 't-blocked', state: 'blocked', responsibleUserId: 'usr-other' }),
  task({ id: 't-review', state: 'submitted', responsibleUserId: 'usr-other' }),
] as const;

describe('team task workbench state', () => {
  it('groups my, claimable, team, blocked and review work without double-counting semantics', () => {
    const grouped = groupTeamTasks(TASKS, 'usr-me');

    expect(grouped.mine.map((row) => row.id)).toEqual(['t-mine']);
    expect(grouped.claimable.map((row) => row.id)).toEqual(['t-claim']);
    expect(grouped.team.map((row) => row.id)).toEqual([
      't-mine',
      't-claim',
      't-blocked',
      't-review',
    ]);
    expect(grouped.blocked.map((row) => row.id)).toEqual(['t-blocked']);
    expect(grouped.review.map((row) => row.id)).toEqual(['t-review']);
  });

  it('uses role-specific default scope and keeps viewers on a read-only project view', () => {
    expect(defaultTaskScope('member')).toBe('mine');
    expect(defaultTaskScope('lead')).toBe('team');
    expect(defaultTaskScope('viewer')).toBe('team');
  });

  it.each([
    ['draft', '草稿'],
    ['claimable', '待认领'],
    ['in_progress', '进行中'],
    ['blocked', '阻塞'],
    ['submitted', '待验收'],
    ['revision_requested', '待返工'],
    ['accepted', '验收通过'],
    ['completed', '已完成'],
  ] as const)('maps %s to the user-facing state %s', (state, label) => {
    expect(taskStateLabel(state)).toBe(label);
  });

  it('offers executable actions by role and never offers mutations to a viewer', () => {
    expect(
      availableTaskActions(
        task({ state: 'claimable', responsibleUserId: null }),
        'member',
        'usr-me',
      ),
    ).toEqual(['claim']);
    expect(
      availableTaskActions(
        task({
          state: 'submitted',
          responsibleUserId: 'usr-other',
          contract: contract('usr-me'),
        }),
        'member',
        'usr-me',
      ),
    ).toEqual(['review']);
    expect(
      availableTaskActions(
        task({ state: 'in_progress', responsibleUserId: 'usr-me' }),
        'member',
        'usr-me',
      ),
    ).toEqual(['block', 'submit']);
    expect(
      availableTaskActions(
        task({ state: 'claimable', responsibleUserId: null }),
        'viewer',
        'usr-me',
      ),
    ).toEqual([]);
    expect(
      availableTaskActions(
        task({
          state: 'assigned',
          responsibleUserId: 'usr-me',
          responsibleAssignmentStatus: 'offered',
          myPendingAssignmentId: 'twa-offer',
          myPendingAssignmentRole: 'responsible',
          myPendingAssignmentStatus: 'offered',
        }),
        'member',
        'usr-me',
      ),
    ).toEqual(['accept_assignment']);
    expect(
      availableTaskActions(
        task({
          state: 'revision_requested',
          revisionRound: 2,
          responsibleUserId: 'usr-me',
          latestSubmissionId: 'tsb-final',
          latestReviewId: 'trv-final',
        }),
        'member',
        'usr-me',
      ),
    ).toEqual(['appeal']);
    expect(
      availableTaskActions(
        task({ state: 'accepted', responsibleUserId: 'usr-other' }),
        'lead',
        'usr-me',
      ),
    ).toEqual(['close']);
    expect(
      availableTaskActions(
        task({ state: 'completed', responsibleUserId: 'usr-other' }),
        'lead',
        'usr-me',
      ),
    ).toEqual(['archive']);
    expect(
      availableTaskActions(
        task({
          state: 'claimable',
          assignmentMode: 'leader_select',
          canSelectClaim: true,
          claimApplicants: [
            { assignmentId: 'twa-apply', userId: 'usr-candidate', displayName: 'Candidate' },
          ],
        }),
        'lead',
        'usr-me',
      ),
    ).toEqual(['select_claim']);
    expect(
      availableTaskActions(
        task({
          state: 'claimable',
          assignmentMode: 'leader_select',
          canSelectClaim: true,
          claimApplicants: [
            { assignmentId: 'twa-apply', userId: 'usr-candidate', displayName: 'Candidate' },
          ],
        }),
        'member',
        'usr-me',
      ),
    ).toEqual(['select_claim']);
    expect(
      availableTaskActions(
        task({
          state: 'assigned',
          responsibleUserId: 'usr-other',
          myPendingAssignmentId: 'twa-collaborator',
          myPendingAssignmentRole: 'collaborator',
          myPendingAssignmentStatus: 'offered',
        }),
        'member',
        'usr-me',
      ),
    ).toEqual(['accept_assignment']);
  });

  it('rejects an older task response so a route or refresh cannot overwrite newer rows', () => {
    const current = { requestId: 8, rows: [TASKS[0]], loading: true, error: null };

    expect(applyTaskLoadResult(current, { requestId: 7, rows: [TASKS[1]] })).toBe(current);
    expect(applyTaskLoadResult(current, { requestId: 8, rows: [TASKS[1]] })).toEqual({
      requestId: 8,
      rows: [TASKS[1]],
      loading: false,
      error: null,
    });
  });

  it('requires a failed criterion, evidence, revision action and deadline before enabling rework', () => {
    expect(
      reviewRevisionReadiness({
        revisionRound: 1,
        failedCriterionIds: [],
        evidenceReferences: [],
        revisionInstructions: '',
        newDeadline: '',
      }),
    ).toEqual({ mode: 'revision', ready: false });
    expect(
      reviewRevisionReadiness({
        revisionRound: 1,
        failedCriterionIds: ['criterion-output'],
        evidenceReferences: ['缺少上线截图'],
        revisionInstructions: '补充桌面与移动端截图并说明差异',
        newDeadline: '2026-09-03T10:00:00.000Z',
      }),
    ).toEqual({ mode: 'revision', ready: true });
    expect(
      reviewRevisionReadiness({
        revisionRound: 2,
        failedCriterionIds: ['criterion-output'],
        evidenceReferences: ['仍缺上线截图'],
        revisionInstructions: '再次补充',
        newDeadline: '2026-09-04T10:00:00.000Z',
      }),
    ).toEqual({ mode: 'arbitration', ready: false });
  });

  it('marks vague or unlimited contract criteria inline while leaving measurable criteria clear', () => {
    expect(
      validateContractCriteria([
        { id: 'a', description: '尽量把页面做好' },
        { id: 'b', description: '覆盖全部情况并随时响应' },
        { id: 'c', description: '390px 与 1440px 截图均无横向溢出' },
      ]),
    ).toEqual([
      { id: 'a', issue: '标准过于模糊，请补充可观察的结果或阈值' },
      { id: 'b', issue: '标准包含无限责任，请限定范围、数量或截止时间' },
      { id: 'c', issue: null },
    ]);
  });
});

function task(
  overrides: Partial<TeamTaskWorkbenchRow> & Pick<TeamTaskWorkbenchRow, 'state'>,
): TeamTaskWorkbenchRow {
  return {
    id: overrides.id ?? 't-default',
    projectId: 'prj-team',
    title: '任务',
    description: null,
    assignmentMode: overrides.assignmentMode ?? 'direct',
    state: overrides.state,
    version: 2,
    dueAt: '2026-09-01T10:00:00.000Z',
    revisionRound: overrides.revisionRound ?? 0,
    responsibleUserId: overrides.responsibleUserId ?? null,
    responsibleDisplayName: overrides.responsibleDisplayName ?? null,
    responsibleAssignmentId: overrides.responsibleAssignmentId ?? null,
    responsibleAssignmentStatus: overrides.responsibleAssignmentStatus ?? null,
    myPendingAssignmentId: overrides.myPendingAssignmentId ?? null,
    myPendingAssignmentRole: overrides.myPendingAssignmentRole ?? null,
    myPendingAssignmentStatus: overrides.myPendingAssignmentStatus ?? null,
    canSelectClaim: overrides.canSelectClaim ?? false,
    claimApplicants: overrides.claimApplicants ?? [],
    collaboratorUserIds: overrides.collaboratorUserIds ?? [],
    milestone: overrides.milestone ?? null,
    submittedOnTime: overrides.submittedOnTime ?? null,
    accepted: overrides.accepted ?? false,
    latestSubmissionId: overrides.latestSubmissionId ?? null,
    latestReviewId: overrides.latestReviewId ?? null,
    contract: overrides.contract ?? null,
    updatedAt: '2026-08-31T10:00:00.000Z',
  };
}

function contract(approverUserId: string): NonNullable<TeamTaskWorkbenchRow['contract']> {
  return {
    version: 1,
    objective: '可验证目标',
    criteria: [{ id: 'criterion-1', description: '提供发布截图' }],
    approverUserId,
    arbitratorUserId: 'usr-arbitrator',
  };
}
