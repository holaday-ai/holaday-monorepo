import { Button } from '@/components/ui/button';
import {
  type ProjectMemberRole,
  type TaskScope,
  type TeamTaskState,
  type TeamTaskWorkbenchRow,
  availableTaskActions,
  defaultTaskScope,
  groupTeamTasks,
  reviewRevisionReadiness,
  taskStateLabel,
  validateContractCriteria,
} from '@/lib/team-task-workbench-state';
import { cn } from '@/lib/utils';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  ClipboardCheck,
  Clock3,
  Columns3,
  FileCheck2,
  List,
  Plus,
  RefreshCw,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import * as React from 'react';

interface WorkbenchMember {
  readonly userId: string;
  readonly organizationMemberId?: string;
  readonly displayName: string;
  readonly role: ProjectMemberRole;
}

type TimelineKind = 'contract' | 'assignment' | 'block' | 'submission' | 'review' | 'appeal' | 'ai';

interface TimelineItem {
  readonly kind: TimelineKind;
  readonly label: string;
  readonly at: string;
}

type TaskDetail = TeamTaskWorkbenchRow;

export interface CreateTeamTaskInput {
  readonly title: string;
  readonly assignmentMode: 'direct' | 'first_come' | 'leader_select';
  readonly responsibleOrganizationMemberId: string | null;
  readonly collaboratorOrganizationMemberIds: readonly string[];
  readonly milestoneId: string | null;
  readonly dependencyIds: readonly string[];
  readonly objective: string;
  readonly deliverable: string;
  readonly criterion: string;
  readonly evidenceDescription: string;
  readonly approverId: string;
  readonly arbitratorId: string;
  readonly dueAt: string;
}

export interface ReviewTeamTaskInput {
  readonly task: TeamTaskWorkbenchRow;
  readonly decision: 'accepted' | 'request_revision' | 'escalate_arbitration';
  readonly failedCriterionIds: readonly string[];
  readonly evidenceReference: string;
  readonly revisionInstructions: string;
  readonly newDeadline: string;
}

export type TeamTaskExecutionInput =
  | { readonly type: 'claim'; readonly task: TeamTaskWorkbenchRow; readonly memberId: string }
  | {
      readonly type: 'accept_assignment';
      readonly task: TeamTaskWorkbenchRow;
      readonly assignmentId: string;
    }
  | {
      readonly type: 'select_claim';
      readonly task: TeamTaskWorkbenchRow;
      readonly assignmentId: string;
    }
  | {
      readonly type: 'start' | 'unblock' | 'close' | 'archive';
      readonly task: TeamTaskWorkbenchRow;
    }
  | {
      readonly type: 'block';
      readonly task: TeamTaskWorkbenchRow;
      readonly responsibleParty: string;
      readonly nextAction: string;
      readonly reviewAt: string;
      readonly affectsDueDate: boolean;
    }
  | {
      readonly type: 'submit';
      readonly task: TeamTaskWorkbenchRow;
      readonly summary: string;
      readonly deliverable: string;
    }
  | {
      readonly type: 'appeal';
      readonly task: TeamTaskWorkbenchRow;
      readonly grounds: string;
    };

interface TeamTaskWorkbenchProps {
  readonly currentUserId: string;
  readonly role: ProjectMemberRole;
  readonly rows: readonly TeamTaskWorkbenchRow[];
  readonly members: readonly WorkbenchMember[];
  readonly milestoneOptions?: readonly { readonly id: string; readonly title: string }[];
  readonly membersLoading?: boolean;
  readonly memberError?: string | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly stale: boolean;
  readonly onRetry: () => void;
  readonly onLoadDetail?: (taskId: string) => Promise<TeamTaskWorkbenchRow>;
  readonly onCreateTask?: (input: CreateTeamTaskInput) => Promise<void>;
  readonly onReviewTask?: (input: ReviewTeamTaskInput) => Promise<void>;
  readonly onTaskAction?: (input: TeamTaskExecutionInput) => Promise<void>;
}

const SCOPE_META: Array<{
  readonly id: TaskScope;
  readonly label: string;
  readonly color: string;
}> = [
  { id: 'mine', label: '我的任务', color: '#4C8FFB' },
  { id: 'claimable', label: '待认领', color: '#A35FE7' },
  { id: 'team', label: '团队任务', color: '#FF5B66' },
  { id: 'blocked', label: '阻塞', color: '#FF6B73' },
  { id: 'review', label: '待验收', color: '#33B983' },
];

const STATUS_TONE: Record<TeamTaskState, string> = {
  draft: 'bg-[#F4F4F6] text-[#686A73]',
  ready: 'bg-[#EEF5FF] text-[#3978C7]',
  assigned: 'bg-[#F2F0FF] text-[#6B55C2]',
  claimable: 'bg-[#F4EEFF] text-[#7A50C9]',
  accepted_by_member: 'bg-[#EEF5FF] text-[#3978C7]',
  in_progress: 'bg-[#EEF5FF] text-[#3978C7]',
  blocked: 'bg-[#FFF0F2] text-[#D94355]',
  submitted: 'bg-[#FFF7E9] text-[#B66C12]',
  in_review: 'bg-[#FFF7E9] text-[#B66C12]',
  revision_requested: 'bg-[#FFF0F2] text-[#D94355]',
  resubmitted: 'bg-[#FFF7E9] text-[#B66C12]',
  accepted: 'bg-[#EBFAF4] text-[#218764]',
  completed: 'bg-[#EBFAF4] text-[#218764]',
  cancelled: 'bg-[#F4F4F6] text-[#686A73]',
  rejected_final: 'bg-[#FFF0F2] text-[#D94355]',
  archived: 'bg-[#F4F4F6] text-[#686A73]',
};

export function TeamTaskWorkbench({
  currentUserId,
  role,
  rows,
  members,
  milestoneOptions = [],
  membersLoading = false,
  memberError = null,
  loading,
  error,
  stale,
  onRetry,
  onLoadDetail,
  onCreateTask,
  onReviewTask,
  onTaskAction,
}: TeamTaskWorkbenchProps): JSX.Element {
  const groups = React.useMemo(() => groupTeamTasks(rows, currentUserId), [currentUserId, rows]);
  const [scope, setScope] = React.useState<TaskScope>(() => defaultTaskScope(role));
  const [view, setView] = React.useState<'list' | 'board'>('list');
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = React.useState<TeamTaskWorkbenchRow | null>(null);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [detailError, setDetailError] = React.useState<string | null>(null);
  const [editorOpen, setEditorOpen] = React.useState(false);
  const detailRequestRef = React.useRef(0);
  const restoreFocusRef = React.useRef<HTMLElement | null>(null);
  const selected = selectedDetail ?? rows.find((row) => row.id === selectedId);
  const visibleRows = groups[scope];

  React.useEffect(() => {
    setScope(defaultTaskScope(role));
  }, [role]);

  React.useEffect(() => {
    if (selectedId && !rows.some((row) => row.id === selectedId)) {
      setSelectedId(null);
      setSelectedDetail(null);
    }
  }, [rows, selectedId]);

  const openDetail = React.useCallback(
    (taskId: string) => {
      restoreFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const requestId = ++detailRequestRef.current;
      setSelectedId(taskId);
      setSelectedDetail(null);
      setDetailError(null);
      if (!onLoadDetail) return;
      setDetailLoading(true);
      void onLoadDetail(taskId).then(
        (detail) => {
          if (detailRequestRef.current !== requestId || detail.id !== taskId) return;
          setSelectedDetail(detail);
          setDetailLoading(false);
        },
        () => {
          if (detailRequestRef.current !== requestId) return;
          setDetailError('任务详情暂时无法加载，请刷新后重试');
          setDetailLoading(false);
        },
      );
    },
    [onLoadDetail],
  );

  const restoreTriggerFocus = React.useCallback(() => {
    const target = restoreFocusRef.current;
    restoreFocusRef.current = null;
    window.requestAnimationFrame(() => target?.focus());
  }, []);

  const closeDetail = React.useCallback(() => {
    detailRequestRef.current += 1;
    setSelectedId(null);
    setSelectedDetail(null);
    restoreTriggerFocus();
  }, [restoreTriggerFocus]);

  const closeEditor = React.useCallback(() => {
    setEditorOpen(false);
    restoreTriggerFocus();
  }, [restoreTriggerFocus]);

  return (
    <section
      aria-label="团队任务工作台"
      className="overflow-hidden rounded-[10px] border border-[#E2E4E9] bg-white"
    >
      <SummaryRail groups={groups} />
      <div className="border-t border-[#ECEEF2]">
        <TaskTabs scope={scope} groups={groups} onChange={setScope} />
        <div className="flex min-h-[580px] min-w-0">
          <div className="min-w-0 flex-1">
            <Toolbar
              view={view}
              onViewChange={setView}
              canCreate={role === 'lead'}
              onCreate={() => {
                restoreFocusRef.current =
                  document.activeElement instanceof HTMLElement ? document.activeElement : null;
                setEditorOpen(true);
              }}
            />
            {loading && rows.length === 0 ? <TaskLoading /> : null}
            {error ? <TaskError error={error} stale={stale} onRetry={onRetry} /> : null}
            {!loading && !error && visibleRows.length === 0 ? <TaskEmpty scope={scope} /> : null}
            {visibleRows.length > 0 && view === 'list' ? (
              <TaskTable rows={visibleRows} onSelect={openDetail} />
            ) : null}
            {visibleRows.length > 0 && view === 'board' ? (
              <TaskBoard rows={visibleRows} onSelect={openDetail} />
            ) : null}
          </div>
          <MembersRail members={members} loading={membersLoading} error={memberError} />
        </div>
      </div>
      {selected ? (
        <TaskDetailPanel
          task={selected}
          role={role}
          currentUserId={currentUserId}
          currentOrganizationMemberId={
            members.find((member) => member.userId === currentUserId)?.organizationMemberId ?? null
          }
          loading={detailLoading}
          error={detailError}
          onReview={onReviewTask}
          onAction={onTaskAction}
          onClose={closeDetail}
        />
      ) : null}
      {editorOpen ? (
        <TaskEditor
          members={members}
          tasks={rows}
          milestoneOptions={milestoneOptions}
          onCreate={onCreateTask}
          onClose={closeEditor}
        />
      ) : null}
    </section>
  );
}

function SummaryRail({ groups }: { readonly groups: ReturnType<typeof groupTeamTasks> }) {
  const metrics = [
    {
      label: '进行中',
      value: groups.team.filter((row) => row.state === 'in_progress').length,
      color: '#4C8FFB',
    },
    { label: '待认领', value: groups.claimable.length, color: '#A35FE7' },
    { label: '阻塞', value: groups.blocked.length, color: '#FF5B66' },
    { label: '待验收', value: groups.review.length, color: '#33B983' },
  ];
  return (
    <dl className="grid grid-cols-2 divide-x divide-y divide-[#ECEEF2] bg-white sm:grid-cols-4 sm:divide-y-0">
      {metrics.map((metric) => (
        <div key={metric.label} className="flex min-h-[70px] items-center gap-3 px-4 sm:px-6">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: metric.color }} />
          <dt className="text-[13px] font-medium text-[#656872]">{metric.label}</dt>
          <dd className="ml-auto text-xl font-semibold tabular-nums text-[#24252A]">
            {metric.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function TaskTabs({
  scope,
  groups,
  onChange,
}: {
  readonly scope: TaskScope;
  readonly groups: ReturnType<typeof groupTeamTasks>;
  readonly onChange: (scope: TaskScope) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="任务分组"
      className="flex overflow-x-auto border-b border-[#ECEEF2] px-2 sm:px-4"
    >
      {SCOPE_META.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={scope === item.id}
          onClick={() => onChange(item.id)}
          className={cn(
            'relative flex h-12 min-w-max items-center gap-2 px-3 text-[13px] font-medium text-[#595B65] transition-colors sm:px-4',
            scope === item.id && 'text-[#24252A]',
          )}
        >
          {item.label}
          <span className="text-[11px] tabular-nums text-[#92949D]">{groups[item.id].length}</span>
          {scope === item.id ? (
            <span
              className="absolute inset-x-3 bottom-0 h-0.5 rounded-full"
              style={{ backgroundColor: item.color }}
            />
          ) : null}
        </button>
      ))}
    </div>
  );
}

function Toolbar({
  view,
  onViewChange,
  canCreate,
  onCreate,
}: {
  readonly view: 'list' | 'board';
  readonly onViewChange: (view: 'list' | 'board') => void;
  readonly canCreate: boolean;
  readonly onCreate: () => void;
}) {
  return (
    <div className="flex min-h-[58px] items-center justify-between gap-3 border-b border-[#ECEEF2] px-3 sm:px-4">
      <div className="inline-flex rounded-[8px] border border-[#E1E3E8] p-0.5">
        <button
          type="button"
          aria-label="列表视图"
          aria-pressed={view === 'list'}
          onClick={() => onViewChange('list')}
          className={cn(
            'flex h-10 min-w-10 items-center justify-center rounded-[6px] text-[#696B74]',
            view === 'list' && 'bg-[#FFF0F2] text-[#E73C55]',
          )}
        >
          <List className="h-4 w-4" aria-hidden />
        </button>
        <button
          type="button"
          aria-label="看板视图"
          aria-pressed={view === 'board'}
          onClick={() => onViewChange('board')}
          className={cn(
            'flex h-10 min-w-10 items-center justify-center rounded-[6px] text-[#696B74]',
            view === 'board' && 'bg-[#FFF0F2] text-[#E73C55]',
          )}
        >
          <Columns3 className="h-4 w-4" aria-hidden />
        </button>
      </div>
      {canCreate ? (
        <Button
          type="button"
          onClick={onCreate}
          className="h-11 rounded-[8px] bg-[#FF5B66] px-4 text-white hover:bg-[#ED4D5A]"
        >
          <Plus className="h-4 w-4" aria-hidden />
          新建任务
        </Button>
      ) : null}
    </div>
  );
}

function TaskTable({
  rows,
  onSelect,
}: { readonly rows: readonly TeamTaskWorkbenchRow[]; readonly onSelect: (id: string) => void }) {
  return (
    <>
      <ul aria-label="移动团队任务列表" className="divide-y divide-[#ECEEF2] md:hidden">
        {rows.map((row) => (
          <li key={row.id}>
            <button
              type="button"
              aria-label={`移动端查看 ${row.title}`}
              onClick={() => onSelect(row.id)}
              className="flex min-h-11 w-full items-start gap-3 px-4 py-3 text-left hover:bg-[#FFF9FA]"
            >
              <span className="min-w-0 flex-1">
                <span className="flex items-start justify-between gap-2">
                  <span className="truncate text-[13px] font-medium text-[#25262B]">
                    {row.title}
                  </span>
                  <span
                    className={cn(
                      'shrink-0 rounded-[5px] px-2 py-0.5 text-[11px] font-medium',
                      STATUS_TONE[row.state],
                    )}
                  >
                    {taskStateLabel(row.state)}
                  </span>
                </span>
                <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#777A84]">
                  <span>{row.responsibleDisplayName || '待认领'}</span>
                  <span>截止 {shortDate(row.dueAt)}</span>
                  {row.milestone ? <span>{row.milestone}</span> : null}
                </span>
                <span className="mt-2 flex items-center gap-4 text-[11px] text-[#5F626C]">
                  <MobileFact label="按时" value={row.submittedOnTime} />
                  <MobileFact label="验收" value={row.accepted} />
                </span>
              </span>
              <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-[#858892]" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto md:block">
        <table aria-label="团队任务列表" className="w-full min-w-[760px] border-collapse text-left">
          <thead className="border-b border-[#ECEEF2] bg-[#FCFCFD] text-[12px] font-medium text-[#777A84]">
            <tr>
              <th className="px-4 py-3">任务</th>
              <th className="px-3 py-3">负责人</th>
              <th className="px-3 py-3">截止日期</th>
              <th className="px-3 py-3">里程碑</th>
              <th className="px-3 py-3">按时提交</th>
              <th className="px-3 py-3">验收通过</th>
              <th className="w-12 px-2 py-3">
                <span className="sr-only">详情</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#ECEEF2]">
            {rows.map((row) => (
              <tr key={row.id} className="group hover:bg-[#FFF9FA]">
                <td className="px-4 py-3">
                  <p className="max-w-[280px] truncate text-[13px] font-medium text-[#25262B]">
                    {row.title}
                  </p>
                  <span
                    className={cn(
                      'mt-1 inline-flex rounded-[5px] px-2 py-0.5 text-[11px] font-medium',
                      STATUS_TONE[row.state],
                    )}
                  >
                    {taskStateLabel(row.state)}
                  </span>
                </td>
                <td className="px-3 py-3 text-[12px] text-[#5F626C]">
                  {row.responsibleDisplayName || '待认领'}
                </td>
                <td className="px-3 py-3 text-[12px] tabular-nums text-[#5F626C]">
                  {shortDate(row.dueAt)}
                </td>
                <td className="px-3 py-3 text-[12px] text-[#5F626C]">{row.milestone || '—'}</td>
                <FactCell label="按时提交" value={row.submittedOnTime} />
                <FactCell label="验收通过" value={row.accepted} />
                <td className="px-2 py-2">
                  <button
                    type="button"
                    aria-label={`查看 ${row.title}`}
                    onClick={() => onSelect(row.id)}
                    className="flex h-11 w-11 items-center justify-center rounded-[8px] text-[#858892] hover:bg-[#F4F4F6] hover:text-[#EA1F59]"
                  >
                    <ChevronRight className="h-4 w-4" aria-hidden />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function MobileFact({ label, value }: { readonly label: string; readonly value: boolean | null }) {
  const display = value === null ? '—' : value ? '是' : '否';
  return (
    <span className="inline-flex items-center gap-1">
      {value === null ? (
        <Circle className="h-3.5 w-3.5 text-[#C4C7CF]" aria-hidden />
      ) : value ? (
        <CheckCircle2 className="h-3.5 w-3.5 text-[#2DB887]" aria-hidden />
      ) : (
        <AlertCircle className="h-3.5 w-3.5 text-[#EF5968]" aria-hidden />
      )}
      {label}：{display}
    </span>
  );
}

function FactCell({ label, value }: { readonly label: string; readonly value: boolean | null }) {
  return (
    <td
      aria-label={`${label}：${value === null ? '—' : value ? '是' : '否'}`}
      className="px-3 py-3 text-[12px] text-[#5F626C]"
    >
      <span className="inline-flex items-center gap-1.5">
        {value === null ? (
          <Circle className="h-4 w-4 text-[#C4C7CF]" aria-hidden />
        ) : value ? (
          <CheckCircle2 className="h-4 w-4 text-[#2DB887]" aria-hidden />
        ) : (
          <AlertCircle className="h-4 w-4 text-[#EF5968]" aria-hidden />
        )}
        {value === null ? '—' : value ? '是' : '否'}
      </span>
    </td>
  );
}

function TaskBoard({
  rows,
  onSelect,
}: { readonly rows: readonly TeamTaskWorkbenchRow[]; readonly onSelect: (id: string) => void }) {
  const columns: Array<{ title: string; states: TeamTaskState[] }> = [
    { title: '待开始', states: ['ready', 'assigned', 'claimable', 'accepted_by_member'] },
    { title: '进行中', states: ['in_progress', 'blocked', 'revision_requested'] },
    { title: '待验收', states: ['submitted', 'in_review', 'resubmitted'] },
    { title: '已结束', states: ['accepted', 'completed', 'cancelled', 'rejected_final'] },
  ];
  return (
    <section
      aria-label="任务看板"
      className="grid gap-3 overflow-x-auto p-4 md:grid-cols-2 xl:grid-cols-4"
    >
      {columns.map((column) => (
        <section
          key={column.title}
          className="min-w-[220px] rounded-[8px] border border-[#E7E8EC] bg-[#FAFAFB] p-3"
        >
          <h3 className="text-[12px] font-semibold text-[#666872]">{column.title}</h3>
          <div className="mt-3 space-y-2">
            {rows
              .filter((row) => column.states.includes(row.state))
              .map((row) => (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => onSelect(row.id)}
                  className="block min-h-11 w-full rounded-[8px] border border-[#E5E6EA] bg-white p-3 text-left shadow-[0_1px_2px_rgba(20,24,35,0.03)] hover:border-[#F3ADB6]"
                >
                  <span className="block text-[13px] font-medium text-[#292A30]">{row.title}</span>
                  <span className="mt-1 block text-[11px] text-[#81838C]">
                    {row.responsibleDisplayName || '待认领'} · {shortDate(row.dueAt)}
                  </span>
                </button>
              ))}
          </div>
        </section>
      ))}
    </section>
  );
}

function MembersRail({
  members,
  loading,
  error,
}: {
  readonly members: readonly WorkbenchMember[];
  readonly loading: boolean;
  readonly error: string | null;
}) {
  return (
    <aside
      aria-label="项目成员"
      className="hidden w-[190px] shrink-0 border-l border-[#ECEEF2] p-4 xl:block"
    >
      <div className="flex items-center gap-2 text-[13px] font-semibold text-[#36373D]">
        <Users className="h-4 w-4 text-[#FF5B66]" aria-hidden />
        团队成员 <span className="font-normal text-[#8B8D96]">{members.length}</span>
      </div>
      {loading && members.length === 0 ? (
        <div aria-label="项目成员加载中" className="mt-4 space-y-2">
          <div className="hola-skel h-10 rounded-[8px] bg-[#F0F1F3]" />
          <div className="hola-skel h-10 rounded-[8px] bg-[#F0F1F3]" />
        </div>
      ) : null}
      {error ? <p className="mt-4 text-[11px] leading-4 text-[#A62D42]">{error}</p> : null}
      {!loading && !error && members.length === 0 ? (
        <p className="mt-4 text-[12px] text-[#7D7F88]">项目还没有成员</p>
      ) : null}
      <ul className="mt-4 space-y-3">
        {members.map((member) => (
          <li key={member.userId} className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#FFF0F2] text-[11px] font-semibold text-[#D94255]">
              {member.displayName.slice(0, 1)}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[12px] font-medium text-[#3B3C42]">
                {member.displayName}
              </span>
              <span className="block text-[10px] text-[#92949C]">
                {member.role === 'lead'
                  ? '项目负责人'
                  : member.role === 'viewer'
                    ? '仅查看'
                    : '项目成员'}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </aside>
  );
}

function TaskDetailPanel({
  task,
  role,
  currentUserId,
  currentOrganizationMemberId,
  loading,
  error,
  onReview,
  onAction,
  onClose,
}: {
  readonly task: TaskDetail;
  readonly role: ProjectMemberRole;
  readonly currentUserId: string;
  readonly currentOrganizationMemberId: string | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly onReview?: (input: ReviewTeamTaskInput) => Promise<void>;
  readonly onAction?: (input: TeamTaskExecutionInput) => Promise<void>;
  readonly onClose: () => void;
}) {
  const timeline = task.timeline ?? [];
  const detailReady = !loading && !error && Boolean(task.contract);
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  useModalFocusTrap(dialogRef, onClose);
  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-black/15 lg:items-stretch lg:justify-end"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <dialog
        ref={dialogRef}
        open
        aria-modal="true"
        aria-label={`${task.title} 任务详情`}
        className="m-0 max-h-[88vh] w-full overflow-y-auto rounded-t-[14px] border border-[#E1E3E8] bg-white shadow-[0_-8px_30px_rgba(20,24,35,0.12)] lg:max-h-none lg:w-[430px] lg:rounded-none lg:border-y-0 lg:border-r-0 lg:shadow-[-8px_0_30px_rgba(20,24,35,0.08)]"
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-[#ECEEF2] bg-white px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-[#25262B]">{task.title}</h2>
            <div className="mt-2 flex items-center gap-2">
              <span
                className={cn(
                  'rounded-[5px] px-2 py-1 text-[11px] font-medium',
                  STATUS_TONE[task.state],
                )}
              >
                {taskStateLabel(task.state)}
              </span>
              <span className="text-[11px] text-[#7C7F88]">v{task.version}</span>
              <span className="text-[11px] text-[#7C7F88]">截止 {shortDate(task.dueAt)}</span>
            </div>
          </div>
          <button
            type="button"
            aria-label="关闭任务详情"
            onClick={onClose}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[8px] text-[#747680] hover:bg-[#F4F4F6]"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
        <div className="space-y-6 px-5 py-5">
          {loading ? (
            <p aria-live="polite" className="text-[12px] text-[#72757E]">
              正在同步契约与时间线…
            </p>
          ) : null}
          {error ? (
            <p
              role="alert"
              className="rounded-[8px] border border-[#F2CBD3] bg-[#FFF7F8] p-3 text-[12px] text-[#A62D42]"
            >
              {error}
            </p>
          ) : null}
          {detailReady ? <ContractSummary task={task} /> : null}
          {detailReady ? <Timeline rows={timeline} /> : null}
          <div className="grid grid-cols-2 gap-2">
            <FactCard label="按时提交" value={task.submittedOnTime} />
            <FactCard label="验收通过" value={task.accepted} />
          </div>
          {detailReady ? (
            <TaskExecutionPanel
              task={task}
              role={role}
              currentUserId={currentUserId}
              currentOrganizationMemberId={currentOrganizationMemberId}
              onAction={onAction}
            />
          ) : null}
          {detailReady &&
          role !== 'viewer' &&
          task.contract?.approverUserId === currentUserId &&
          ['submitted', 'in_review', 'resubmitted'].includes(task.state) ? (
            <ReviewPanel task={task} onReview={onReview} />
          ) : null}
        </div>
      </dialog>
    </div>
  );
}

function TaskExecutionPanel({
  task,
  role,
  currentUserId,
  currentOrganizationMemberId,
  onAction,
}: {
  readonly task: TaskDetail;
  readonly role: ProjectMemberRole;
  readonly currentUserId: string;
  readonly currentOrganizationMemberId: string | null;
  readonly onAction?: (input: TeamTaskExecutionInput) => Promise<void>;
}) {
  const actions = availableTaskActions(task, role, currentUserId).filter(
    (action) => action !== 'review',
  );
  const [summary, setSummary] = React.useState('');
  const [deliverable, setDeliverable] = React.useState('');
  const [appealGrounds, setAppealGrounds] = React.useState('');
  const [responsibleParty, setResponsibleParty] = React.useState('');
  const [nextAction, setNextAction] = React.useState('');
  const [reviewAt, setReviewAt] = React.useState('');
  const [affectsDueDate, setAffectsDueDate] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [feedback, setFeedback] = React.useState<string | null>(null);
  if (actions.length === 0) return null;
  const execute = async (input: TeamTaskExecutionInput) => {
    if (!onAction) return;
    setPending(true);
    setFeedback(null);
    try {
      await onAction(input);
      setFeedback('操作已提交，任务状态正在刷新');
    } catch (actionError) {
      setFeedback(actionError instanceof Error ? actionError.message : '任务操作失败，请重试');
    } finally {
      setPending(false);
    }
  };
  return (
    <section aria-label="任务操作" className="border-t border-[#ECEEF2] pt-5">
      <h3 className="text-[14px] font-semibold text-[#34353B]">可执行操作</h3>
      {feedback ? (
        <output className="mt-2 block text-[12px] text-[#A62D42]">{feedback}</output>
      ) : null}
      <div className="mt-3 space-y-3">
        {actions.includes('select_claim') ? (
          <div className="space-y-2 rounded-[8px] border border-[#E6E7EB] p-3">
            <p className="text-[12px] font-medium text-[#46484F]">选择本次任务负责人</p>
            {(task.claimApplicants ?? []).map((applicant) => (
              <ActionButton
                key={applicant.assignmentId}
                label={`选择 ${applicant.displayName || '申请成员'}`}
                pending={pending}
                onClick={() =>
                  execute({
                    type: 'select_claim',
                    task,
                    assignmentId: applicant.assignmentId,
                  })
                }
              />
            ))}
          </div>
        ) : null}
        {actions.includes('block') ? (
          <div className="space-y-2 rounded-[8px] border border-[#E6E7EB] p-3">
            <Field label="阻塞责任方" value={responsibleParty} onChange={setResponsibleParty} />
            <Field label="下一步动作" value={nextAction} onChange={setNextAction} />
            <label className="grid gap-1.5 text-[12px] font-medium text-[#46484F]">
              复核时间
              <input
                aria-label="复核时间"
                type="datetime-local"
                value={reviewAt}
                onChange={(event) => setReviewAt(event.target.value)}
                className="h-11 rounded-[8px] border border-[#DCDDE2] px-3"
              />
            </label>
            <label className="flex min-h-11 items-center gap-2 text-[12px] text-[#54565F]">
              <input
                type="checkbox"
                checked={affectsDueDate}
                onChange={(event) => setAffectsDueDate(event.target.checked)}
              />
              影响截止时间
            </label>
            <Button
              type="button"
              variant="outline"
              disabled={pending || !responsibleParty.trim() || !nextAction.trim() || !reviewAt}
              onClick={() =>
                void execute({
                  type: 'block',
                  task,
                  responsibleParty,
                  nextAction,
                  reviewAt: new Date(reviewAt).toISOString(),
                  affectsDueDate,
                })
              }
              className="h-11 w-full"
            >
              标记阻塞
            </Button>
          </div>
        ) : null}
        {actions.includes('submit') ? (
          <div className="space-y-2 rounded-[8px] border border-[#E6E7EB] p-3">
            <Field label="提交说明" value={summary} onChange={setSummary} />
            <Field label="交付物引用" value={deliverable} onChange={setDeliverable} />
            <Button
              type="button"
              variant="outline"
              disabled={pending || !summary.trim() || !deliverable.trim()}
              onClick={() => void execute({ type: 'submit', task, summary, deliverable })}
              className="h-11 w-full"
            >
              提交验收
            </Button>
          </div>
        ) : null}
        {actions.includes('appeal') ? (
          <div className="space-y-2 rounded-[8px] border border-[#F0D8A8] bg-[#FFF9EE] p-3">
            <p className="text-[12px] leading-5 text-[#70531C]">
              普通返工已达上限。提交后由契约中的独立仲裁人处理。
            </p>
            <Field label="申诉理由" value={appealGrounds} onChange={setAppealGrounds} />
            <Button
              type="button"
              variant="outline"
              disabled={pending || !appealGrounds.trim()}
              onClick={() => void execute({ type: 'appeal', task, grounds: appealGrounds.trim() })}
              className="h-11 w-full"
            >
              提交独立仲裁
            </Button>
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-2">
          {actions.includes('claim') && currentOrganizationMemberId ? (
            <ActionButton
              label="认领任务"
              pending={pending}
              onClick={() =>
                execute({ type: 'claim', task, memberId: currentOrganizationMemberId })
              }
            />
          ) : null}
          {actions.includes('accept_assignment') && task.myPendingAssignmentId ? (
            <ActionButton
              label="接受指派"
              pending={pending}
              onClick={() =>
                execute({
                  type: 'accept_assignment',
                  task,
                  assignmentId: task.myPendingAssignmentId as string,
                })
              }
            />
          ) : null}
          {actions.includes('start') ? (
            <ActionButton
              label="开始任务"
              pending={pending}
              onClick={() => execute({ type: 'start', task })}
            />
          ) : null}
          {actions.includes('unblock') ? (
            <ActionButton
              label="解除阻塞"
              pending={pending}
              onClick={() => execute({ type: 'unblock', task })}
            />
          ) : null}
          {actions.includes('close') ? (
            <ActionButton
              label="确认完成"
              pending={pending}
              onClick={() => execute({ type: 'close', task })}
            />
          ) : null}
          {actions.includes('archive') ? (
            <ActionButton
              label="归档任务"
              pending={pending}
              onClick={() => execute({ type: 'archive', task })}
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}

function ActionButton({
  label,
  pending,
  onClick,
}: { readonly label: string; readonly pending: boolean; readonly onClick: () => Promise<void> }) {
  return (
    <Button
      type="button"
      variant="outline"
      disabled={pending}
      onClick={() => void onClick()}
      className="h-11 rounded-[8px]"
    >
      {label}
    </Button>
  );
}

function ContractSummary({ task }: { readonly task: TaskDetail }) {
  const contract = task.contract;
  if (!contract) return null;
  return (
    <section aria-label="验收契约">
      <div className="flex items-center gap-2">
        <FileCheck2 className="h-4 w-4 text-[#EA1F59]" aria-hidden />
        <h3 className="text-[14px] font-semibold text-[#34353B]">验收契约</h3>
        <span className="text-[11px] text-[#898B94]">v{contract.version}</span>
      </div>
      <div className="mt-3 rounded-[8px] border border-[#E6E7EB] bg-[#FCFCFD] p-4">
        <p className="text-[12px] font-medium text-[#3D3E44]">目标</p>
        <p className="mt-1 text-[12px] leading-5 text-[#6D7079]">{contract.objective}</p>
        {contract.criteria.length > 0 ? (
          <ul className="mt-3 space-y-2 border-t border-[#ECEEF2] pt-3">
            {contract.criteria.map((criterion) => (
              <li key={criterion.id} className="flex gap-2 text-[12px] leading-5 text-[#5F626C]">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#33B983]" aria-hidden />
                {criterion.description}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

function Timeline({ rows }: { readonly rows: readonly TimelineItem[] }) {
  return (
    <section aria-label="任务时间线">
      <div className="flex items-center gap-2">
        <Clock3 className="h-4 w-4 text-[#555862]" aria-hidden />
        <h3 className="text-[14px] font-semibold text-[#34353B]">任务时间线</h3>
      </div>
      <ol className="mt-3 space-y-0">
        {rows.map((row, index) => (
          <li key={`${row.kind}-${row.at}`} className="relative flex gap-3 pb-4 last:pb-0">
            <span
              className={cn(
                'relative z-[1] mt-1 h-2.5 w-2.5 shrink-0 rounded-full border-2 border-white ring-1 ring-[#CFD2D9]',
                row.kind === 'ai' ? 'bg-[#FF9A27]' : 'bg-[#B8BCC6]',
              )}
            />
            {index < rows.length - 1 ? (
              <span className="absolute left-[4px] top-3 h-full w-px bg-[#D9DBE1]" />
            ) : null}
            <time className="w-[92px] shrink-0 text-[11px] tabular-nums text-[#8A8C95]">
              {formatTimelineDate(row.at)}
            </time>
            <span className="text-[12px] leading-4 text-[#5F626C]">{row.label}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ReviewPanel({
  task,
  onReview,
}: {
  readonly task: TaskDetail;
  readonly onReview?: (input: ReviewTeamTaskInput) => Promise<void>;
}) {
  const [failedIds, setFailedIds] = React.useState<string[]>([]);
  const [evidence, setEvidence] = React.useState('');
  const [instructions, setInstructions] = React.useState('');
  const [deadline, setDeadline] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [feedback, setFeedback] = React.useState<string | null>(null);
  const criteria = task.contract?.criteria ?? [
    { id: 'criterion-output', description: '覆盖目标、过程与结果三个维度' },
  ];
  const readiness = reviewRevisionReadiness({
    revisionRound: task.revisionRound,
    failedCriterionIds: failedIds,
    evidenceReferences: [evidence],
    revisionInstructions: instructions,
    newDeadline: deadline,
  });
  const submit = async (decision: ReviewTeamTaskInput['decision']) => {
    if (!onReview || !task.latestSubmissionId) {
      setFeedback('提交记录尚未同步，请刷新任务详情后重试');
      return;
    }
    setSubmitting(true);
    setFeedback(null);
    try {
      await onReview({
        task,
        decision,
        failedCriterionIds: failedIds,
        evidenceReference: evidence,
        revisionInstructions: instructions,
        newDeadline: deadline,
      });
      setFeedback(
        decision === 'accepted'
          ? '已通过验收'
          : decision === 'escalate_arbitration'
            ? '已移交独立仲裁，等待负责人提交申诉'
            : '返工要求已提交',
      );
    } catch (reviewError) {
      setFeedback(reviewError instanceof Error ? reviewError.message : '验收操作失败，请重试');
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <section aria-label="验收操作" className="border-t border-[#ECEEF2] pt-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="h-4 w-4 text-[#EA1F59]" aria-hidden />
          <h3 className="text-[14px] font-semibold text-[#34353B]">验收操作</h3>
        </div>
        <span className="text-[11px] text-[#7D7F88]">修订轮次 {task.revisionRound} / 2</span>
      </div>
      {feedback ? (
        <output className="mt-3 block text-[12px] text-[#A62D42]">{feedback}</output>
      ) : null}
      {readiness.mode === 'arbitration' ? (
        <div className="mt-4 space-y-3">
          <div className="rounded-[8px] border border-[#F4D7A5] bg-[#FFF9EE] p-3">
            <p className="text-[12px] leading-5 text-[#7A5817]">
              普通返工已达两轮上限。验收人可通过本轮提交，或将争议正式移交独立仲裁。
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              disabled={submitting}
              onClick={() => void submit('accepted')}
              className="h-11 rounded-[8px] bg-[#FF5B66] text-white hover:bg-[#ED4D5A]"
            >
              <CheckCircle2 className="h-4 w-4" aria-hidden />
              通过验收
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={() => void submit('escalate_arbitration')}
              className="h-11 rounded-[8px]"
            >
              移交独立仲裁
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <fieldset>
            <legend className="text-[12px] font-medium text-[#46484F]">未通过的验收标准</legend>
            <div className="mt-2 space-y-2">
              {criteria.map((criterion) => (
                <label
                  key={criterion.id}
                  className="flex min-h-11 items-center gap-2 rounded-[8px] border border-[#E5E7EB] px-3 text-[12px] text-[#5E6069]"
                >
                  <input
                    type="checkbox"
                    checked={failedIds.includes(criterion.id)}
                    onChange={(event) =>
                      setFailedIds((current) =>
                        event.target.checked
                          ? [...current, criterion.id]
                          : current.filter((id) => id !== criterion.id),
                      )
                    }
                  />
                  {criterion.description}
                </label>
              ))}
            </div>
          </fieldset>
          <Field label="证据或缺失证据" value={evidence} onChange={setEvidence} />
          <Field label="返工说明" value={instructions} onChange={setInstructions} />
          <label className="grid gap-1.5 text-[12px] font-medium text-[#46484F]">
            新截止时间
            <input
              aria-label="新截止时间"
              type="datetime-local"
              value={deadline}
              onChange={(event) => setDeadline(event.target.value)}
              className="h-11 rounded-[8px] border border-[#DCDDE2] px-3 text-[13px] font-normal"
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              disabled={submitting}
              onClick={() => void submit('accepted')}
              className="h-11 rounded-[8px] bg-[#FF5B66] text-white hover:bg-[#ED4D5A]"
            >
              <CheckCircle2 className="h-4 w-4" aria-hidden />
              通过验收
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!readiness.ready || submitting}
              onClick={() => void submit('request_revision')}
              className="h-11 rounded-[8px]"
            >
              要求返工
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
}: { readonly label: string; readonly value: string; readonly onChange: (value: string) => void }) {
  return (
    <label className="grid gap-1.5 text-[12px] font-medium text-[#46484F]">
      {label}
      <textarea
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={2}
        className="min-h-[64px] resize-y rounded-[8px] border border-[#DCDDE2] px-3 py-2 text-[13px] font-normal leading-5"
      />
    </label>
  );
}

function TaskEditor({
  members,
  tasks,
  milestoneOptions,
  onCreate,
  onClose,
}: {
  readonly members: readonly WorkbenchMember[];
  readonly tasks: readonly TeamTaskWorkbenchRow[];
  readonly milestoneOptions: readonly { readonly id: string; readonly title: string }[];
  readonly onCreate?: (input: CreateTeamTaskInput) => Promise<void>;
  readonly onClose: () => void;
}) {
  const [title, setTitle] = React.useState('');
  const [objective, setObjective] = React.useState('');
  const [deliverable, setDeliverable] = React.useState('');
  const [criterion, setCriterion] = React.useState('');
  const [evidenceDescription, setEvidenceDescription] = React.useState('');
  const [reviewed, setReviewed] = React.useState(false);
  const [assignmentMode, setAssignmentMode] = React.useState<
    'direct' | 'first_come' | 'leader_select'
  >('direct');
  const assignableMembers = members.filter(
    (member) => member.role !== 'viewer' && member.organizationMemberId,
  );
  const [responsibleId, setResponsibleId] = React.useState('');
  const [collaboratorIds, setCollaboratorIds] = React.useState<string[]>([]);
  const [approverId, setApproverId] = React.useState('');
  const [arbitratorId, setArbitratorId] = React.useState('');
  const [milestoneId, setMilestoneId] = React.useState('');
  const [dependencyIds, setDependencyIds] = React.useState<string[]>([]);
  const [deadline, setDeadline] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [partialSaved, setPartialSaved] = React.useState(false);
  const [feedback, setFeedback] = React.useState<string | null>(null);
  const issue =
    validateContractCriteria([{ id: 'criterion-1', description: criterion }])[0]?.issue ?? null;
  const assignmentContractConflict =
    Boolean(approverId) &&
    Boolean(arbitratorId) &&
    ((assignmentMode === 'direct' &&
      (responsibleId === approverId || responsibleId === arbitratorId)) ||
      collaboratorIds.some((id) => id === approverId || id === arbitratorId));
  const directReady =
    assignmentMode !== 'direct' ||
    (Boolean(responsibleId) && responsibleId !== approverId && responsibleId !== arbitratorId);
  const ready = Boolean(
    title.trim() &&
      objective.trim() &&
      deliverable.trim() &&
      criterion.trim() &&
      evidenceDescription.trim() &&
      deadline &&
      approverId &&
      arbitratorId &&
      approverId !== arbitratorId &&
      !assignmentContractConflict &&
      directReady &&
      !issue &&
      reviewed,
  );
  const submit = async () => {
    if (!ready || !onCreate) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      await onCreate({
        title: title.trim(),
        assignmentMode,
        responsibleOrganizationMemberId: assignmentMode === 'direct' ? responsibleId : null,
        collaboratorOrganizationMemberIds: collaboratorIds,
        milestoneId: milestoneId || null,
        dependencyIds,
        objective: objective.trim(),
        deliverable: deliverable.trim(),
        criterion: criterion.trim(),
        evidenceDescription: evidenceDescription.trim(),
        approverId,
        arbitratorId,
        dueAt: new Date(deadline).toISOString(),
      });
      onClose();
    } catch (creationError) {
      const message =
        creationError instanceof Error ? creationError.message : '任务创建失败，请重试';
      setFeedback(message);
      if (message.startsWith('创建尚未完成；')) setPartialSaved(true);
    } finally {
      setSubmitting(false);
    }
  };
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  useModalFocusTrap(dialogRef, onClose);
  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-end bg-black/15"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <dialog
        ref={dialogRef}
        open
        aria-modal="true"
        aria-label="新建团队任务"
        className="m-0 max-h-[94vh] w-full overflow-y-auto rounded-t-[14px] border border-[#E1E3E8] bg-white shadow-[-8px_0_30px_rgba(20,24,35,0.12)] sm:h-full sm:max-h-none sm:max-w-[540px] sm:rounded-none"
      >
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-[#ECEEF2] bg-white px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-[#25262B]">新建任务</h2>
            <p className="mt-1 text-[12px] text-[#777A84]">先明确责任，再复核验收契约</p>
          </div>
          <button
            type="button"
            aria-label="关闭新建任务"
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-[8px] hover:bg-[#F4F4F6]"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </header>
        <div className="space-y-5 p-5">
          <fieldset disabled={partialSaved} className="contents">
            <Field label="任务名称" value={title} onChange={setTitle} />
            <fieldset>
              <legend className="text-[12px] font-medium text-[#46484F]">分配方式</legend>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {(
                  [
                    ['direct', '直接指派'],
                    ['first_come', '先到先得'],
                    ['leader_select', '负责人选择'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={assignmentMode === value}
                    onClick={() => setAssignmentMode(value)}
                    className={cn(
                      'min-h-11 rounded-[8px] border px-2 text-[12px]',
                      assignmentMode === value
                        ? 'border-[#FF7B85] bg-[#FFF1F3] text-[#D93A50]'
                        : 'border-[#E1E3E8] text-[#666872]',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </fieldset>
            {assignmentMode === 'direct' ? (
              <MemberSelect
                label="负责人"
                value={responsibleId}
                members={assignableMembers}
                onChange={setResponsibleId}
              />
            ) : (
              <p className="text-[12px] text-[#6D7079]">
                {assignmentMode === 'first_come'
                  ? '发布后由符合条件的成员主动认领。验收人与仲裁人不可认领。'
                  : '发布后由项目负责人从申请者中选择。验收人与仲裁人不可申请。'}
              </p>
            )}
            <MultiMemberSelect
              label="协作者"
              values={collaboratorIds}
              members={assignableMembers}
              onChange={setCollaboratorIds}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1.5 text-[12px] font-medium text-[#46484F]">
                里程碑
                <select
                  aria-label="里程碑"
                  value={milestoneId}
                  onChange={(event) => setMilestoneId(event.target.value)}
                  className="h-11 rounded-[8px] border border-[#DCDDE2] px-3 text-[13px] font-normal"
                >
                  <option value="">不关联</option>
                  {milestoneOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1.5 text-[12px] font-medium text-[#46484F]">
                依赖任务
                <select
                  aria-label="依赖任务"
                  multiple
                  value={dependencyIds}
                  onChange={(event) =>
                    setDependencyIds(
                      [...event.target.selectedOptions].map((option) => option.value),
                    )
                  }
                  className="min-h-11 rounded-[8px] border border-[#DCDDE2] px-3 py-2 text-[13px] font-normal"
                >
                  {tasks
                    .filter((task) => !['archived', 'cancelled'].includes(task.state))
                    .map((task) => (
                      <option key={task.id} value={task.id}>
                        {task.title}
                      </option>
                    ))}
                </select>
              </label>
              <label className="grid gap-1.5 text-[12px] font-medium text-[#46484F] sm:col-span-2">
                截止时间
                <input
                  aria-label="截止时间"
                  type="datetime-local"
                  value={deadline}
                  onChange={(event) => setDeadline(event.target.value)}
                  className="h-11 rounded-[8px] border border-[#DCDDE2] px-3 text-[13px] font-normal"
                />
              </label>
            </div>
            <section
              aria-label="验收契约编辑器"
              className="rounded-[8px] border border-[#E5E7EB] bg-[#FCFCFD] p-4"
            >
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-[#A35FE7]" aria-hidden />
                <h3 className="text-[13px] font-semibold text-[#3B3D44]">验收契约</h3>
                <span className="text-[11px] text-[#888B94]">发布前必须复核</span>
              </div>
              <div className="mt-4 space-y-3">
                <Field label="验收目标" value={objective} onChange={setObjective} />
                <Field label="交付物" value={deliverable} onChange={setDeliverable} />
                <label className="grid gap-1.5 text-[12px] font-medium text-[#46484F]">
                  验收标准 1
                  <textarea
                    aria-label="验收标准 1"
                    value={criterion}
                    onChange={(event) => setCriterion(event.target.value)}
                    rows={2}
                    className={cn(
                      'min-h-[64px] rounded-[8px] border px-3 py-2 text-[13px] font-normal',
                      issue ? 'border-[#F28C99] bg-[#FFF7F8]' : 'border-[#DCDDE2]',
                    )}
                  />
                  {criterion && issue ? (
                    <span className="text-[11px] font-normal text-[#D63C51]">{issue}</span>
                  ) : null}
                </label>
                <Field
                  label="必需证据"
                  value={evidenceDescription}
                  onChange={setEvidenceDescription}
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <MemberSelect
                    label="验收人"
                    value={approverId}
                    members={assignableMembers}
                    onChange={setApproverId}
                  />
                  <MemberSelect
                    label="独立仲裁人"
                    value={arbitratorId}
                    members={assignableMembers}
                    onChange={setArbitratorId}
                  />
                </div>
                {approverId && arbitratorId && approverId === arbitratorId ? (
                  <p className="text-[11px] text-[#D63C51]">验收人与仲裁人必须是不同成员</p>
                ) : null}
                {assignmentContractConflict ? (
                  <p className="text-[11px] text-[#D63C51]">
                    负责人、协作者不能同时担任验收人或独立仲裁人
                  </p>
                ) : null}
                <p className="text-[11px] text-[#777A84]">
                  最多返工 2 轮，之后只进入独立仲裁路径。
                </p>
                <label className="flex min-h-11 items-center gap-2 text-[12px] text-[#54565F]">
                  <input
                    type="checkbox"
                    aria-label="我已复核验收契约"
                    checked={reviewed}
                    onChange={(event) => setReviewed(event.target.checked)}
                  />
                  我已逐项复核负责人、期限、交付物、证据与验收边界
                </label>
              </div>
            </section>
          </fieldset>
          {feedback ? (
            <p role="alert" className="text-[12px] text-[#A62D42]">
              {feedback}
            </p>
          ) : null}
          <Button
            type="button"
            disabled={!ready || submitting || !onCreate}
            onClick={() => void submit()}
            className="h-11 w-full rounded-[8px] bg-[#FF5B66] text-white hover:bg-[#ED4D5A]"
          >
            {submitting ? '正在创建…' : partialSaved ? '继续完成配置' : '创建并发布任务'}
          </Button>
        </div>
      </dialog>
    </div>
  );
}

function MemberSelect({
  label,
  value,
  members,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly members: readonly WorkbenchMember[];
  readonly onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1.5 text-[12px] font-medium text-[#46484F]">
      {label}
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 rounded-[8px] border border-[#DCDDE2] px-3 text-[13px] font-normal"
      >
        <option value="">请选择</option>
        {members.map((member) => (
          <option key={member.organizationMemberId} value={member.organizationMemberId}>
            {member.displayName}
          </option>
        ))}
      </select>
    </label>
  );
}

function MultiMemberSelect({
  label,
  values,
  members,
  onChange,
}: {
  readonly label: string;
  readonly values: readonly string[];
  readonly members: readonly WorkbenchMember[];
  readonly onChange: (values: string[]) => void;
}) {
  return (
    <label className="grid gap-1.5 text-[12px] font-medium text-[#46484F]">
      {label}
      <select
        aria-label={label}
        multiple
        value={[...values]}
        onChange={(event) =>
          onChange([...event.target.selectedOptions].map((option) => option.value))
        }
        className="min-h-11 rounded-[8px] border border-[#DCDDE2] px-3 py-2 text-[13px] font-normal"
      >
        {members.map((member) => (
          <option key={member.organizationMemberId} value={member.organizationMemberId}>
            {member.displayName}
          </option>
        ))}
      </select>
      <span className="text-[11px] font-normal text-[#858892]">可多选；不选择则仅设置负责人</span>
    </label>
  );
}

function TaskLoading() {
  return (
    <div aria-label="团队任务加载中" className="space-y-2 p-4" aria-live="polite">
      {[0, 1, 2].map((row) => (
        <div key={row} className="hola-skel h-14 rounded-[8px] bg-[#F0F1F3]" />
      ))}
    </div>
  );
}

function TaskError({
  error,
  stale,
  onRetry,
}: { readonly error: string; readonly stale: boolean; readonly onRetry: () => void }) {
  return (
    <div className="m-4 flex flex-col gap-3 rounded-[8px] border border-[#F2CBD3] bg-[#FFF7F8] p-4 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-[#A62D42]">{error}</p>
        {stale ? (
          <p className="mt-1 text-[12px] text-[#7C6268]">当前显示上次同步结果</p>
        ) : (
          <p className="mt-1 text-[12px] text-[#7C6268]">项目概览和成员信息仍可继续使用</p>
        )}
      </div>
      <Button type="button" variant="outline" className="h-11 rounded-[8px]" onClick={onRetry}>
        <RefreshCw className="h-4 w-4" aria-hidden />
        重试团队任务
      </Button>
    </div>
  );
}

function TaskEmpty({ scope }: { readonly scope: TaskScope }) {
  return (
    <div className="px-5 py-16 text-center">
      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-[#FFF1F3] text-[#EA1F59]">
        <ClipboardCheck className="h-5 w-5" aria-hidden />
      </div>
      <h3 className="mt-3 text-[14px] font-semibold text-[#36373D]">这个分组还没有任务</h3>
      <p className="mt-1 text-[12px] text-[#7D7F88]">
        {scope === 'mine' ? '被指派或认领的任务会出现在这里。' : '切换分组查看其他团队任务。'}
      </p>
    </div>
  );
}

function FactCard({ label, value }: { readonly label: string; readonly value: boolean | null }) {
  const display = value === null ? '—' : value ? '是' : '否';
  return (
    <div className="rounded-[8px] border border-[#E6E7EB] p-3">
      <p className="text-[11px] text-[#7D7F88]">{label}</p>
      <p className="mt-1 flex items-center gap-1.5 text-[13px] font-medium text-[#3E4047]">
        {value === true ? (
          <CheckCircle2 className="h-4 w-4 text-[#2DB887]" aria-hidden />
        ) : (
          <Circle className="h-4 w-4 text-[#C4C7CF]" aria-hidden />
        )}
        {display}
      </p>
    </div>
  );
}

function shortDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(date);
}

function useModalFocusTrap<T extends HTMLElement>(
  ref: React.RefObject<T | null>,
  onClose: () => void,
): void {
  React.useEffect(() => {
    const container = ref.current;
    if (!container) return;
    const focusableSelector =
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusables = () =>
      Array.from(container.querySelectorAll<HTMLElement>(focusableSelector)).filter(
        (element) => !element.closest('[hidden], [aria-hidden="true"]'),
      );
    focusables()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    container.addEventListener('keydown', onKeyDown);
    return () => container.removeEventListener('keydown', onKeyDown);
  }, [onClose, ref]);
}
function formatTimelineDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '时间待定'
    : new Intl.DateTimeFormat('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(date);
}
