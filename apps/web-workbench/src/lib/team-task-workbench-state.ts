export type ProjectMemberRole = 'lead' | 'member' | 'viewer';

export type TeamTaskState =
  | 'draft'
  | 'ready'
  | 'assigned'
  | 'claimable'
  | 'accepted_by_member'
  | 'in_progress'
  | 'blocked'
  | 'submitted'
  | 'in_review'
  | 'revision_requested'
  | 'resubmitted'
  | 'accepted'
  | 'completed'
  | 'cancelled'
  | 'rejected_final'
  | 'archived';

export interface TeamTaskWorkbenchRow {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly description: string | null;
  readonly assignmentMode: 'direct' | 'first_come' | 'leader_select';
  readonly state: TeamTaskState;
  readonly version: number;
  readonly dueAt: string | null;
  readonly revisionRound: number;
  readonly responsibleUserId: string | null;
  readonly responsibleDisplayName: string | null;
  readonly responsibleAssignmentId?: string | null;
  readonly responsibleAssignmentStatus?: 'offered' | 'applied' | 'accepted' | null;
  readonly myPendingAssignmentId?: string | null;
  readonly myPendingAssignmentRole?: 'responsible' | 'collaborator' | null;
  readonly myPendingAssignmentStatus?: 'offered' | 'applied' | null;
  readonly canSelectClaim?: boolean;
  readonly claimApplicants?: readonly {
    readonly assignmentId: string;
    readonly userId: string;
    readonly displayName: string | null;
  }[];
  readonly collaboratorUserIds: readonly string[];
  readonly milestoneId?: string | null;
  readonly milestone: string | null;
  readonly submittedOnTime: boolean | null;
  readonly latestSubmissionId?: string | null;
  readonly latestReviewId?: string | null;
  readonly accepted: boolean | null;
  readonly updatedAt: string;
  readonly contract?: {
    readonly version: number;
    readonly objective: string;
    readonly criteria: readonly { readonly id: string; readonly description: string }[];
    readonly approverUserId: string;
    readonly arbitratorUserId: string;
  } | null;
  readonly timeline?: readonly {
    readonly kind: 'contract' | 'assignment' | 'block' | 'submission' | 'review' | 'appeal' | 'ai';
    readonly label: string;
    readonly at: string;
  }[];
}

export type TaskScope = 'mine' | 'claimable' | 'team' | 'blocked' | 'review';
export type TeamTaskAction =
  | 'accept_assignment'
  | 'select_claim'
  | 'claim'
  | 'start'
  | 'block'
  | 'unblock'
  | 'submit'
  | 'appeal'
  | 'review'
  | 'close'
  | 'archive';

export interface TeamTaskGroups {
  readonly mine: readonly TeamTaskWorkbenchRow[];
  readonly claimable: readonly TeamTaskWorkbenchRow[];
  readonly team: readonly TeamTaskWorkbenchRow[];
  readonly blocked: readonly TeamTaskWorkbenchRow[];
  readonly review: readonly TeamTaskWorkbenchRow[];
}

export interface TaskLoadState {
  readonly requestId: number;
  readonly rows: readonly TeamTaskWorkbenchRow[];
  readonly loading: boolean;
  readonly error: string | null;
}

const ARCHIVED_STATES = new Set<TeamTaskState>(['archived']);
const REVIEW_STATES = new Set<TeamTaskState>(['submitted', 'in_review', 'resubmitted']);

const STATE_LABELS: Record<TeamTaskState, string> = {
  draft: '草稿',
  ready: '待指派',
  assigned: '待接受',
  claimable: '待认领',
  accepted_by_member: '待开始',
  in_progress: '进行中',
  blocked: '阻塞',
  submitted: '待验收',
  in_review: '验收中',
  revision_requested: '待返工',
  resubmitted: '再验收',
  accepted: '验收通过',
  completed: '已完成',
  cancelled: '已取消',
  rejected_final: '未通过',
  archived: '已归档',
};

export function groupTeamTasks(
  rows: readonly TeamTaskWorkbenchRow[],
  currentUserId: string,
): TeamTaskGroups {
  const team = rows.filter((row) => !ARCHIVED_STATES.has(row.state));
  return {
    mine: team.filter(
      (row) =>
        row.responsibleUserId === currentUserId ||
        row.collaboratorUserIds.includes(currentUserId) ||
        Boolean(row.myPendingAssignmentId),
    ),
    claimable: team.filter((row) => row.state === 'claimable'),
    team,
    blocked: team.filter((row) => row.state === 'blocked'),
    review: team.filter((row) => REVIEW_STATES.has(row.state)),
  };
}

export function defaultTaskScope(role: ProjectMemberRole): TaskScope {
  return role === 'member' ? 'mine' : 'team';
}

export function taskStateLabel(state: TeamTaskState): string {
  return STATE_LABELS[state];
}

export function availableTaskActions(
  row: TeamTaskWorkbenchRow,
  role: ProjectMemberRole,
  currentUserId: string,
): TeamTaskAction[] {
  if (role === 'viewer') return [];
  if (REVIEW_STATES.has(row.state) && row.contract?.approverUserId === currentUserId) {
    return ['review'];
  }
  if (
    row.canSelectClaim === true &&
    row.assignmentMode === 'leader_select' &&
    row.state === 'claimable' &&
    (row.claimApplicants?.length ?? 0) > 0
  ) {
    return ['select_claim'];
  }
  if (role === 'lead' && row.state === 'accepted') return ['close'];
  if (role === 'lead' && ['completed', 'cancelled', 'rejected_final'].includes(row.state)) {
    return ['archive'];
  }
  if (role === 'member' && row.state === 'claimable') return ['claim'];
  if (row.myPendingAssignmentId && row.myPendingAssignmentStatus === 'offered')
    return ['accept_assignment'];
  if (row.responsibleUserId !== currentUserId) return [];
  if (
    row.state === 'revision_requested' &&
    row.revisionRound >= 2 &&
    row.latestSubmissionId &&
    row.latestReviewId
  ) {
    return ['appeal'];
  }
  if (row.state === 'accepted_by_member') return ['start'];
  if (row.state === 'blocked') return ['unblock'];
  if (row.state === 'in_progress' || row.state === 'revision_requested') {
    return ['block', 'submit'];
  }
  return [];
}

export function applyTaskLoadResult(
  state: TaskLoadState,
  result: { readonly requestId: number; readonly rows: readonly TeamTaskWorkbenchRow[] },
): TaskLoadState {
  if (result.requestId !== state.requestId) return state;
  return { requestId: result.requestId, rows: result.rows, loading: false, error: null };
}

export function reviewRevisionReadiness(input: {
  readonly revisionRound: number;
  readonly failedCriterionIds: readonly string[];
  readonly evidenceReferences: readonly string[];
  readonly revisionInstructions: string;
  readonly newDeadline: string;
}): { readonly mode: 'revision' | 'arbitration'; readonly ready: boolean } {
  if (input.revisionRound >= 2) return { mode: 'arbitration', ready: false };
  return {
    mode: 'revision',
    ready:
      input.failedCriterionIds.length > 0 &&
      input.evidenceReferences.some(Boolean) &&
      input.revisionInstructions.trim().length > 0 &&
      isValidInstant(input.newDeadline),
  };
}

export function validateContractCriteria(
  criteria: readonly { readonly id: string; readonly description: string }[],
): Array<{ readonly id: string; readonly issue: string | null }> {
  return criteria.map((criterion) => {
    const description = criterion.description.trim();
    if (/(全部|任何|随时|无限|所有情况)/u.test(description)) {
      return {
        id: criterion.id,
        issue: '标准包含无限责任，请限定范围、数量或截止时间',
      };
    }
    if (/(尽量|最好|及时|高质量|做好|合适|合理)/u.test(description)) {
      return {
        id: criterion.id,
        issue: '标准过于模糊，请补充可观察的结果或阈值',
      };
    }
    return { id: criterion.id, issue: null };
  });
}

function isValidInstant(value: string): boolean {
  if (!value.trim()) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp);
}
