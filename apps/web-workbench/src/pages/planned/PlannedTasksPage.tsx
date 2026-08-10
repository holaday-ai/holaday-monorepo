import zhCnLocale from '@fullcalendar/core/locales/zh-cn';
import type {
  DatesSetArg,
  EventClickArg,
  EventContentArg,
  EventDropArg,
  EventInput,
} from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin, { type DateClickArg } from '@fullcalendar/interaction';
import listPlugin from '@fullcalendar/list';
import FullCalendar from '@fullcalendar/react';
import {
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  History,
  ListChecks,
  Loader2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { PageContainer, PageHeader } from '@/pages/PageShell';
import {
  buildCustomWeeklyRRule,
  calendarEventFromOccurrence,
  defaultPlannedCalendarView,
  legacyScheduledEvent,
  nextPlannedEndState,
  plannedEndsOnPayload,
  plannedRepeatLabel,
  plannedStatusGroup,
  stablePlannedCalendarRange,
  workloadHint,
  type PlannedCalendarOccurrence,
  type PlannedCalendarView,
  type PlannedRepeatType,
} from './planned-task-state';
import './planned-tasks.css';

const MOBILE_QUERY = '(max-width: 720px)';
const VIEW_STORAGE_KEY = 'holaday:planned-tasks:view';
const DEFAULT_TIMEZONE = 'Asia/Shanghai';
const WEEKDAYS = [
  ['MO', '一'],
  ['TU', '二'],
  ['WE', '三'],
  ['TH', '四'],
  ['FR', '五'],
  ['SA', '六'],
  ['SU', '日'],
] as const;

interface PlannedTaskRow {
  plannedTaskId: string;
  title: string;
  instruction: string;
  notes: string | null;
  scope: string;
  items: string[];
  itemCount: number;
  repeatType: PlannedRepeatType;
  rrule: string | null;
  firstRunAt: string | Date;
  endsAt: string | Date | null;
  endsOn: string | null;
  nextRunAt: string | Date | null;
  timezone: string;
  reminderMinutes: number | null;
  status: string;
  lastRunAt: string | Date | null;
  lastRunStatus: string | null;
  lastError: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

interface PlannedRunRow {
  runId: string;
  title: string;
  scheduledFor: string | Date;
  trigger: string;
  status: string;
  itemsTotal: number;
  itemsDone: number;
  itemsReview: number;
  itemsFailed: number;
  errorMessage: string | null;
  startedAt: string | Date | null;
  completedAt: string | Date | null;
}

interface LegacyScheduledTaskRow {
  scheduledTaskInternalId?: number;
  scheduledTaskId: string;
  intent: string;
  repeatType: string;
  timezone: string;
  nextRunAt: string | Date;
  status: string;
  lastRunStatus: string | null;
}

interface EditorState {
  plannedTaskId: string | null;
  occurrence: PlannedCalendarOccurrence | null;
  title: string;
  instruction: string;
  multiple: boolean;
  items: string[];
  repeatType: PlannedRepeatType;
  customDays: string[];
  date: string;
  time: string;
  timezone: string;
  reminderMinutes: string;
  endsOn: string | null;
}

interface PendingScopeAction {
  kind: 'reschedule' | 'remove' | 'update';
  occurrence: PlannedCalendarOccurrence;
  scheduledFor?: Date;
}

function emptyEditor(date = nextWholeHour()): EditorState {
  return {
    plannedTaskId: null,
    occurrence: null,
    title: '',
    instruction: '',
    multiple: false,
    items: [''],
    repeatType: 'once',
    customDays: [],
    date: toDateInput(date),
    time: toTimeInput(date),
    timezone: DEFAULT_TIMEZONE,
    reminderMinutes: '',
    endsOn: null,
  };
}

export function PlannedTasksPage(): JSX.Element {
  const toast = useToast();
  const navigate = useNavigate();
  const calendarRef = React.useRef<FullCalendar | null>(null);
  const mountedRef = React.useRef(true);
  const [view, setView] = React.useState<PlannedCalendarView>(() =>
    defaultPlannedCalendarView(matchMobile(), readSavedView()),
  );
  const [title, setTitle] = React.useState('');
  const [range, setRange] = React.useState<{ start: Date; end: Date } | null>(null);
  const [occurrences, setOccurrences] = React.useState<PlannedCalendarOccurrence[]>([]);
  const [legacyEvents, setLegacyEvents] = React.useState<EventInput[]>([]);
  const [plans, setPlans] = React.useState<PlannedTaskRow[]>([]);
  const [runs, setRuns] = React.useState<PlannedRunRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [editor, setEditor] = React.useState<EditorState | null>(null);
  const [pendingScope, setPendingScope] = React.useState<PendingScopeAction | null>(null);

  React.useEffect(() => {
    mountedRef.current = true;
    const query = window.matchMedia?.(MOBILE_QUERY);
    const listener = (event: MediaQueryListEvent) => {
      if (event.matches) changeView('listMonth');
    };
    query?.addEventListener('change', listener);
    return () => {
      mountedRef.current = false;
      query?.removeEventListener('change', listener);
    };
    // changeView is intentionally read from the current render only for viewport changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshPlans = React.useCallback(async () => {
    const rows = (await trpc.plannedTasks.list.query({ limit: 200 })) as PlannedTaskRow[];
    if (mountedRef.current) setPlans(rows);
  }, []);

  const refreshCalendar = React.useCallback(async () => {
    if (!range) return;
    const input = {
      rangeStart: range.start.toISOString(),
      rangeEnd: range.end.toISOString(),
    };
    const [rows, oldRows] = await Promise.all([
      trpc.plannedTasks.calendar.query(input) as Promise<PlannedCalendarOccurrence[]>,
      trpc.scheduledTasks.list.query(input) as Promise<LegacyScheduledTaskRow[]>,
    ]);
    if (mountedRef.current) {
      setOccurrences(rows);
      setLegacyEvents(oldRows.map(legacyScheduledEvent));
    }
  }, [range]);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([refreshPlans(), refreshCalendar()]);
    } catch (error) {
      toast.show(errorMessage(error, '规划任务暂时无法加载'), 'error');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [refreshCalendar, refreshPlans, toast]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  React.useEffect(() => {
    if (!editor?.plannedTaskId) {
      setRuns([]);
      return;
    }
    let active = true;
    void trpc.plannedTasks.runs
      .query({ plannedTaskId: editor.plannedTaskId, limit: 12 })
      .then((rows) => {
        if (active) setRuns(rows as PlannedRunRow[]);
      })
      .catch(() => {
        if (active) setRuns([]);
      });
    return () => {
      active = false;
    };
  }, [editor?.plannedTaskId]);

  const events = React.useMemo(
    () => [
      ...occurrences.map((occurrence) => calendarEventFromOccurrence(occurrence)),
      ...legacyEvents,
    ],
    [legacyEvents, occurrences],
  );
  const attentionCount = plans.filter(
    (plan) => plannedStatusGroup(plan).group === 'attention',
  ).length;
  const activeCount = plans.filter((plan) => plan.status === 'active').length;

  function changeView(nextView: PlannedCalendarView): void {
    setView(nextView);
    window.localStorage?.setItem(VIEW_STORAGE_KEY, nextView);
    calendarRef.current?.getApi().changeView(nextView);
  }

  function openCreate(date = nextWholeHour()): void {
    setEditor(emptyEditor(date));
    setRuns([]);
  }

  async function openPlan(
    plannedTaskId: string,
    occurrence: PlannedCalendarOccurrence | null,
  ): Promise<void> {
    try {
      const plan = (await trpc.plannedTasks.detail.query({
        plannedTaskId,
        ...(occurrence
          ? { originalScheduledFor: new Date(occurrence.originalScheduledFor).toISOString() }
          : {}),
      })) as PlannedTaskRow;
      const scheduledAt = occurrence
        ? new Date(occurrence.scheduledFor)
        : new Date(plan.nextRunAt ?? plan.firstRunAt);
      setEditor({
        plannedTaskId,
        occurrence,
        title: plan.title,
        instruction: plan.instruction,
        multiple: plan.scope === 'multiple',
        items: plan.items.length > 0 ? plan.items : [''],
        repeatType: plan.repeatType,
        customDays: parseCustomDays(plan.rrule),
        date: toDateInput(scheduledAt),
        time: toTimeInput(scheduledAt),
        timezone: plan.timezone,
        reminderMinutes:
          plan.reminderMinutes === null ? '' : String(plan.reminderMinutes),
        endsOn: plan.endsOn,
      });
    } catch (error) {
      toast.show(errorMessage(error, '无法打开这条规划任务'), 'error');
    }
  }

  function handleDateClick(arg: DateClickArg): void {
    const date = new Date(arg.date);
    if (arg.allDay) date.setHours(9, 0, 0, 0);
    openCreate(date);
  }

  function handleEventClick(arg: EventClickArg): void {
    if (arg.event.extendedProps.legacy) {
      const focus = arg.event.extendedProps.scheduledTaskInternalId;
      navigate(
        focus
          ? `/planned/legacy-scheduled?focusScheduledTaskInternalId=${encodeURIComponent(String(focus))}`
          : '/planned/legacy-scheduled',
      );
      return;
    }
    const occurrence = occurrenceFromEvent(arg);
    void openPlan(occurrence.plannedTaskId, occurrence);
  }

  function handleEventDrop(arg: EventDropArg): void {
    const occurrence = occurrenceFromEvent(arg);
    if (!arg.event.start) {
      arg.revert();
      return;
    }
    const scheduledFor = arg.event.start;
    if (occurrence.repeatType === 'once') {
      void rescheduleOccurrence(occurrence, scheduledFor, 'series', arg.revert);
      return;
    }
    arg.revert();
    setPendingScope({ kind: 'reschedule', occurrence, scheduledFor });
  }

  async function rescheduleOccurrence(
    occurrence: PlannedCalendarOccurrence,
    scheduledFor: Date,
    scope: 'occurrence' | 'future' | 'series',
    revert?: () => void,
  ): Promise<void> {
    try {
      await trpc.plannedTasks.rescheduleOccurrence.mutate({
        plannedTaskId: occurrence.plannedTaskId,
        originalScheduledFor: new Date(occurrence.originalScheduledFor).toISOString(),
        scheduledFor: scheduledFor.toISOString(),
        scope,
      });
      toast.show('执行时间已更新', 'info');
      await refresh();
    } catch (error) {
      revert?.();
      toast.show(errorMessage(error, '改期失败'), 'error');
    }
  }

  async function removeOccurrence(
    occurrence: PlannedCalendarOccurrence,
    scope: 'occurrence' | 'future' | 'series',
  ): Promise<void> {
    try {
      await trpc.plannedTasks.removeOccurrence.mutate({
        plannedTaskId: occurrence.plannedTaskId,
        originalScheduledFor: new Date(occurrence.originalScheduledFor).toISOString(),
        scope,
      });
      setEditor(null);
      toast.show(scope === 'series' ? '规划已删除' : '日程已更新', 'info');
      await refresh();
    } catch (error) {
      toast.show(errorMessage(error, '删除失败'), 'error');
    }
  }

  async function saveEditor(
    editScope?: 'occurrence' | 'future' | 'series',
  ): Promise<void> {
    if (!editor) return;
    if (
      editor.plannedTaskId &&
      editor.occurrence &&
      editor.occurrence.repeatType !== 'once' &&
      !editScope
    ) {
      setPendingScope({ kind: 'update', occurrence: editor.occurrence });
      return;
    }
    const scheduledAt = localDateTime(editor.date, editor.time);
    const items = editor.multiple ? editor.items.map((item) => item.trim()).filter(Boolean) : [];
    const instruction = editor.instruction.trim();
    if ((!editor.multiple && !instruction) || (editor.multiple && items.length === 0)) {
      toast.show('请填写至少一个任务', 'error');
      return;
    }
    const rrule =
      editor.repeatType === 'custom'
        ? buildCustomWeeklyRRule(editor.customDays, scheduledAt)
        : null;
    if (editor.repeatType === 'custom' && !rrule) {
      toast.show('请选择至少一个执行日', 'error');
      return;
    }
    setSaving(true);
    try {
      if (editor.plannedTaskId) {
        await trpc.plannedTasks.update.mutate({
          plannedTaskId: editor.plannedTaskId,
          title: editor.title.trim() || undefined,
          instruction,
          items,
          repeatType: editor.repeatType,
          scheduledAt: scheduledAt.toISOString(),
          rrule,
          timezone: editor.timezone,
          ...plannedEndsOnPayload(editScope ?? 'series', editor.endsOn),
          reminderMinutes: editor.reminderMinutes
            ? Number(editor.reminderMinutes)
            : null,
          editScope: editScope ?? 'series',
          ...(editor.occurrence
            ? {
                originalScheduledFor: new Date(
                  editor.occurrence.originalScheduledFor,
                ).toISOString(),
              }
            : {}),
        });
        toast.show(
          editScope === 'occurrence'
            ? '本次日程已保存'
            : editScope === 'future'
              ? '这次及以后的规划已保存'
              : '整个规划已保存',
          'info',
        );
      } else {
        await trpc.plannedTasks.create.mutate({
          title: editor.title.trim(),
          instruction,
          items,
          repeatType: editor.repeatType,
          scheduledAt: scheduledAt.toISOString(),
          rrule,
          timezone: editor.timezone,
          endsOn: editor.endsOn,
          reminderMinutes: editor.reminderMinutes
            ? Number(editor.reminderMinutes)
            : null,
        });
        toast.show('规划已创建', 'info');
      }
      setEditor(null);
      await refresh();
    } catch (error) {
      toast.show(errorMessage(error, '保存失败'), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function togglePlan(): Promise<void> {
    if (!editor?.plannedTaskId) return;
    try {
      const result = await trpc.plannedTasks.toggle.mutate({
        plannedTaskId: editor.plannedTaskId,
      });
      toast.show(result.status === 'paused' ? '规划已暂停' : '规划已恢复', 'info');
      await refresh();
    } catch (error) {
      toast.show(errorMessage(error, '状态更新失败'), 'error');
    }
  }

  async function runNow(): Promise<void> {
    if (!editor?.plannedTaskId) return;
    try {
      await trpc.plannedTasks.runNow.mutate({ plannedTaskId: editor.plannedTaskId });
      toast.show('已开始执行，可在运行记录中查看进度', 'info');
      await refresh();
    } catch (error) {
      toast.show(errorMessage(error, '暂时无法执行'), 'error');
    }
  }

  const selectedPlan = editor?.plannedTaskId
    ? plans.find((plan) => plan.plannedTaskId === editor.plannedTaskId) ?? null
    : null;

  return (
    <PageContainer width="wide" className="planned-page max-w-[1320px]">
      <PageHeader
        title="规划任务"
        description="把未来一次或重复执行的工作放进日历；多个事项会作为一个规划分批启动。"
        action={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline"><History aria-hidden />旧任务记录</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => navigate('/planned/legacy-scheduled')}>
                  <CalendarClock aria-hidden />原定时任务
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => navigate('/planned/legacy-batch')}>
                  <ListChecks aria-hidden />原批量任务
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button onClick={() => openCreate()}>
              <Plus aria-hidden />
              新建规划
            </Button>
          </>
        }
      />

      <div className="planned-summary" aria-label="规划任务概览">
        <span><CalendarClock aria-hidden />{activeCount} 个已启用</span>
        <span><ListChecks aria-hidden />{plans.reduce((sum, plan) => sum + plan.itemCount, 0)} 个任务项</span>
        {attentionCount > 0 && <span className="planned-summary__attention"><CircleAlert aria-hidden />{attentionCount} 个需处理</span>}
      </div>

      <div className={cn('planned-workbench', editor && 'planned-workbench--editing')}>
        <section className="planned-calendar-panel" aria-label="规划日历">
          <div className="planned-toolbar">
            <div className="planned-toolbar__nav">
              <Button
                variant="outline"
                size="icon"
                title="上一个月"
                aria-label="上一个月"
                onClick={() => calendarRef.current?.getApi().prev()}
              >
                <ChevronLeft aria-hidden />
              </Button>
              <Button variant="outline" onClick={() => calendarRef.current?.getApi().today()}>
                今天
              </Button>
              <Button
                variant="outline"
                size="icon"
                title="下一个月"
                aria-label="下一个月"
                onClick={() => calendarRef.current?.getApi().next()}
              >
                <ChevronRight aria-hidden />
              </Button>
              <strong>{title}</strong>
            </div>
            <div className="planned-toolbar__views" aria-label="视图切换">
              <button
                type="button"
                className={view === 'dayGridMonth' ? 'is-active' : ''}
                onClick={() => changeView('dayGridMonth')}
              >
                月历
              </button>
              <button
                type="button"
                className={view === 'listMonth' ? 'is-active' : ''}
                onClick={() => changeView('listMonth')}
              >
                日程
              </button>
            </div>
          </div>
          {loading && occurrences.length === 0 ? (
            <div className="planned-loading"><Loader2 className="animate-spin" aria-hidden />正在载入规划</div>
          ) : (
            <FullCalendar
              ref={calendarRef}
              plugins={[dayGridPlugin, listPlugin, interactionPlugin]}
              locale={zhCnLocale}
              initialView={view}
              headerToolbar={false}
              height="auto"
              dayMaxEvents={3}
              moreLinkText={(count) => `还有 ${count} 项`}
              events={events}
              editable
              eventStartEditable
              eventDurationEditable={false}
              nowIndicator
              datesSet={(arg: DatesSetArg) => {
                setTitle(arg.view.title);
                setRange((current) =>
                  stablePlannedCalendarRange(current, { start: arg.start, end: arg.end }),
                );
                setView(arg.view.type as PlannedCalendarView);
              }}
              dateClick={handleDateClick}
              eventClick={handleEventClick}
              eventDrop={handleEventDrop}
              eventContent={renderEventContent}
              noEventsContent="这个月还没有规划，点击日期即可创建。"
            />
          )}
        </section>

        {editor && (
          <aside className="planned-inspector" aria-label={editor.plannedTaskId ? '编辑规划' : '新建规划'}>
            <div className="planned-inspector__header">
              <div>
                <span>{editor.plannedTaskId ? '规划详情' : '新建规划'}</span>
                <strong>{editor.plannedTaskId ? editor.title || '未命名规划' : '安排未来任务'}</strong>
              </div>
              <Button variant="ghost" size="icon" title="关闭" aria-label="关闭" onClick={() => setEditor(null)}>
                <X aria-hidden />
              </Button>
            </div>

            <div className="planned-inspector__body">
              <Field label="名称">
                <Input
                  value={editor.title}
                  maxLength={200}
                  placeholder="例如：每周竞品价格检查"
                  onChange={(event) => setEditor({ ...editor, title: event.target.value })}
                />
              </Field>

              <div className="planned-mode" aria-label="任务数量模式">
                <button type="button" className={!editor.multiple ? 'is-active' : ''} onClick={() => setEditor({ ...editor, multiple: false })}>单个任务</button>
                <button type="button" className={editor.multiple ? 'is-active' : ''} onClick={() => setEditor({ ...editor, multiple: true })}>多个任务</button>
              </div>

              {editor.multiple ? (
                <Field label={`任务清单 · ${editor.items.filter((item) => item.trim()).length}/50`}>
                  <div className="planned-items">
                    {editor.items.map((item, index) => (
                      <div className="planned-item" key={`${index}-${editor.items.length}`}>
                        <span>{index + 1}</span>
                        <Input
                          value={item}
                          placeholder="描述这个任务"
                          onChange={(event) => {
                            const items = [...editor.items];
                            items[index] = event.target.value;
                            setEditor({ ...editor, items });
                          }}
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          title="移除任务"
                          aria-label={`移除任务 ${index + 1}`}
                          disabled={editor.items.length === 1}
                          onClick={() => setEditor({ ...editor, items: editor.items.filter((_, itemIndex) => itemIndex !== index) })}
                        >
                          <X aria-hidden />
                        </Button>
                      </div>
                    ))}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={editor.items.length >= 50}
                      onClick={() => setEditor({ ...editor, items: [...editor.items, ''] })}
                    >
                      <Plus aria-hidden />添加任务
                    </Button>
                  </div>
                </Field>
              ) : (
                <Field label="任务说明">
                  <Textarea
                    value={editor.instruction}
                    rows={5}
                    placeholder="说清目标、范围和交付结果"
                    onChange={(event) => setEditor({ ...editor, instruction: event.target.value })}
                  />
                </Field>
              )}

              {editor.multiple && (
                <Field label="统一要求（可选）">
                  <Textarea
                    value={editor.instruction}
                    rows={3}
                    placeholder="例如：每项都给出来源链接"
                    onChange={(event) => setEditor({ ...editor, instruction: event.target.value })}
                  />
                </Field>
              )}

              <div className="planned-form-grid">
                <Field label="日期"><Input type="date" value={editor.date} onChange={(event) => setEditor({ ...editor, date: event.target.value })} /></Field>
                <Field label="时间"><Input type="time" value={editor.time} onChange={(event) => setEditor({ ...editor, time: event.target.value })} /></Field>
              </div>

              <Field label="重复">
                <div className="planned-repeat">
                  {(['once', 'daily', 'weekly', 'monthly', 'custom'] as const).map((repeatType) => (
                    <button
                      type="button"
                      key={repeatType}
                      className={editor.repeatType === repeatType ? 'is-active' : ''}
                      onClick={() => setEditor({
                        ...editor,
                        repeatType,
                        endsOn: nextPlannedEndState(repeatType, editor.endsOn),
                      })}
                    >
                      {plannedRepeatLabel(repeatType)}
                    </button>
                  ))}
                </div>
              </Field>
              {editor.repeatType === 'custom' && (
                <Field label="每周执行日">
                  <div className="planned-weekdays">
                    {WEEKDAYS.map(([value, label]) => (
                      <button
                        type="button"
                        key={value}
                        className={editor.customDays.includes(value) ? 'is-active' : ''}
                        onClick={() => setEditor({
                          ...editor,
                          customDays: editor.customDays.includes(value)
                            ? editor.customDays.filter((day) => day !== value)
                            : [...editor.customDays, value],
                        })}
                      >{label}</button>
                    ))}
                  </div>
                </Field>
              )}

              {editor.repeatType !== 'once' && (
                <Field label="结束">
                  <div className="planned-mode planned-end-mode">
                    <button
                      type="button"
                      className={editor.endsOn === null ? 'is-active' : ''}
                      onClick={() => setEditor({ ...editor, endsOn: null })}
                    >
                      永不结束
                    </button>
                    <button
                      type="button"
                      className={editor.endsOn !== null ? 'is-active' : ''}
                      onClick={() => setEditor({ ...editor, endsOn: editor.endsOn ?? editor.date })}
                    >
                      结束日期
                    </button>
                  </div>
                  {editor.endsOn !== null && (
                    <Input
                      className="planned-end-date"
                      type="date"
                      value={editor.endsOn}
                      onChange={(event) => setEditor({ ...editor, endsOn: event.target.value })}
                    />
                  )}
                </Field>
              )}

              <div className="planned-form-grid">
                <Field label="时区">
                  <select value={editor.timezone} onChange={(event) => setEditor({ ...editor, timezone: event.target.value })}>
                    <option value="Asia/Shanghai">中国标准时间</option>
                    <option value="Asia/Tokyo">日本标准时间</option>
                    <option value="America/New_York">美国东部时间</option>
                    <option value="Europe/London">英国时间</option>
                  </select>
                </Field>
                <Field label="提前提醒">
                  <select value={editor.reminderMinutes} onChange={(event) => setEditor({ ...editor, reminderMinutes: event.target.value })}>
                    <option value="">不提醒</option>
                    <option value="10">10 分钟</option>
                    <option value="30">30 分钟</option>
                    <option value="60">1 小时</option>
                    <option value="1440">1 天</option>
                  </select>
                </Field>
              </div>

              <p className="planned-workload"><Clock3 aria-hidden />{workloadHint(editor.multiple ? editor.items.filter((item) => item.trim()).length : 1)}</p>

              {editor.plannedTaskId && (
                <div className="planned-actions-row">
                  <Button variant="outline" size="sm" onClick={() => void runNow()}><Play aria-hidden />立即执行</Button>
                  <Button variant="outline" size="sm" onClick={() => void togglePlan()}>
                    {selectedPlan?.status === 'paused' ? <RotateCcw aria-hidden /> : <Pause aria-hidden />}
                    {selectedPlan?.status === 'paused' ? '恢复' : '暂停'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    onClick={() => {
                      if (editor.occurrence && editor.occurrence.repeatType !== 'once') {
                        setPendingScope({ kind: 'remove', occurrence: editor.occurrence });
                      } else if (editor.occurrence) {
                        void removeOccurrence(editor.occurrence, 'series');
                      }
                    }}
                  ><Trash2 aria-hidden />删除</Button>
                </div>
              )}

              {editor.plannedTaskId && (
                <div className="planned-runs">
                  <h3><History aria-hidden />运行记录</h3>
                  {runs.length === 0 ? (
                    <p>还没有执行记录。</p>
                  ) : runs.map((run) => (
                    <div className="planned-run" key={run.runId}>
                      <span className={`planned-run__status planned-run__status--${run.status}`}>{runStatusLabel(run.status)}</span>
                      <div><strong>{run.title}</strong><small>{formatDateTime(run.scheduledFor)} · {run.itemsDone}/{run.itemsTotal} 完成{run.itemsFailed > 0 ? ` · ${run.itemsFailed} 失败` : ''}</small></div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="planned-inspector__footer">
              <Button variant="outline" onClick={() => setEditor(null)}>取消</Button>
              <Button onClick={() => void saveEditor()} disabled={saving}>
                {saving && <Loader2 className="animate-spin" aria-hidden />}
                {editor.plannedTaskId ? '保存规划' : '创建规划'}
              </Button>
            </div>
          </aside>
        )}
      </div>

      {pendingScope && (
        <div className="planned-scope-dialog" role="dialog" aria-modal="true" aria-labelledby="planned-scope-title">
          <div className="planned-scope-dialog__panel">
            <h2 id="planned-scope-title">
              {pendingScope.kind === 'remove'
                ? '删除哪些日程？'
                : pendingScope.kind === 'update'
                  ? '保存到哪些日程？'
                  : '更改哪些日程？'}
            </h2>
            <p>这是重复规划。已完成的运行记录不会被修改。</p>
            <button type="button" onClick={() => void applyScope('occurrence')}>仅这一次<span>只调整当前日程</span></button>
            <button type="button" onClick={() => void applyScope('future')}>这次及以后<span>保留此前记录，拆分后续系列</span></button>
            <button type="button" onClick={() => void applyScope('series')}>整个系列<span>应用到全部未完成日程</span></button>
            <Button variant="ghost" onClick={() => setPendingScope(null)}>取消</Button>
          </div>
        </div>
      )}
    </PageContainer>
  );

  async function applyScope(scope: 'occurrence' | 'future' | 'series'): Promise<void> {
    if (!pendingScope) return;
    const action = pendingScope;
    setPendingScope(null);
    if (action.kind === 'remove') {
      await removeOccurrence(action.occurrence, scope);
    } else if (action.kind === 'update') {
      await saveEditor(scope);
    } else if (action.scheduledFor) {
      await rescheduleOccurrence(action.occurrence, action.scheduledFor, scope);
    }
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return <label className="planned-field"><span>{label}</span>{children}</label>;
}

function renderEventContent(arg: EventContentArg): JSX.Element {
  const itemCount = Number(arg.event.extendedProps.itemCount ?? 1);
  return (
    <div className="planned-event" style={{ '--planned-event-accent': arg.event.extendedProps.accent } as React.CSSProperties}>
      <time>{arg.timeText}</time>
      <span>{arg.event.title}</span>
      {itemCount > 1 && <b>{itemCount}</b>}
    </div>
  );
}

function occurrenceFromEvent(arg: EventClickArg | EventDropArg): PlannedCalendarOccurrence {
  const props = arg.event.extendedProps;
  return {
    occurrenceId: arg.event.id,
    plannedTaskId: String(props.plannedTaskId),
    title: arg.event.title,
    scheduledFor: String(props.scheduledFor),
    originalScheduledFor: String(props.originalScheduledFor),
    changed: Boolean(props.changed),
    status: String(props.status),
    repeatType: String(props.repeatType),
    itemCount: Number(props.itemCount ?? 1),
    timezone: String(props.timezone ?? DEFAULT_TIMEZONE),
  };
}

function nextWholeHour(): Date {
  const date = new Date();
  date.setMinutes(0, 0, 0);
  date.setHours(date.getHours() + 1);
  return date;
}

function toDateInput(value: Date): string {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function toTimeInput(value: Date): string {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
    .format(value)
    .replace('24:', '00:');
}

function localDateTime(date: string, time: string): Date {
  return new Date(`${date}T${time || '09:00'}:00`);
}

function parseCustomDays(rrule: string | null): string[] {
  const value = rrule?.match(/BYDAY=([^;]+)/)?.[1];
  return value ? value.split(',') : [];
}

function readSavedView(): string | null {
  return typeof window === 'undefined' ? null : window.localStorage?.getItem(VIEW_STORAGE_KEY) ?? null;
}

function matchMobile(): boolean {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.(MOBILE_QUERY).matches);
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

function formatDateTime(value: string | Date): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

function runStatusLabel(status: string): string {
  return ({
    pending: '等待启动',
    dispatching: '正在启动',
    running: '执行中',
    completed: '已完成',
    partial_success: '需复核',
    failed: '失败',
    cancelled: '已取消',
  }[status] ?? status);
}
