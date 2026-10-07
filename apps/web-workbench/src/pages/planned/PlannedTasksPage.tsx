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
import { PageContainer, PageHeader } from '@/pages/PageShell';
import type {
  DatesSetArg,
  EventClickArg,
  EventContentArg,
  EventDropArg,
  EventInput,
} from '@fullcalendar/core';
import zhCnLocale from '@fullcalendar/core/locales/zh-cn';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin, { type DateClickArg } from '@fullcalendar/interaction';
import listPlugin from '@fullcalendar/list';
import FullCalendar from '@fullcalendar/react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  CalendarClock,
  Search,
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
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  firstPlannedEditorError,
  plannedEditorFingerprint,
  plannedSaveFeedback,
  type PlannedEditorErrorKey,
  type PlannedEditorErrors,
  validatePlannedEditor,
} from './planned-editor-state';
import { PlannedScopeDialog } from './PlannedScopeDialog';
import {
  type PlannedCalendarOccurrence,
  type PlannedCalendarRange,
  type PlannedCalendarView,
  type PlannedRepeatType,
  buildPlannedLoadMetric,
  buildCustomWeeklyRRule,
  calendarEventFromOccurrence,
  defaultPlannedCalendarView,
  legacyScheduledEvent,
  nextPlannedEndState,
  ownedPlannedTaskQueryTarget,
  plannedCalendarEmptyState,
  plannedEndsOnPayload,
  plannedRepeatLabel,
  plannedRefreshTargets,
  plannedStatusGroup,
  stablePlannedCalendarRange,
  stockRiskRunSummary,
  workloadHint,
} from './planned-task-state';
import './planned-tasks.css';

const MOBILE_QUERY = '(max-width: 720px)';
const MOBILE_INSPECTOR_QUERY = '(max-width: 820px)';
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
  resultJson: unknown;
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

interface PendingEditorTransition {
  apply(): void;
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
  const [searchParams] = useSearchParams();
  const calendarRef = React.useRef<FullCalendar | null>(null);
  const mountedRef = React.useRef(true);
  const instructionRef = React.useRef<HTMLTextAreaElement | null>(null);
  const firstItemRef = React.useRef<HTMLInputElement | null>(null);
  const scheduledAtRef = React.useRef<HTMLInputElement | null>(null);
  const customDaysRef = React.useRef<HTMLDivElement | null>(null);
  const scopeReturnFocusRef = React.useRef<HTMLElement | null>(null);
  const editorReturnFocusRef = React.useRef<HTMLElement | null>(null);
  const discardReturnFocusRef = React.useRef<HTMLElement | null>(null);
  const calendarRequestRef = React.useRef(0);
  const firstPlansRecordedRef = React.useRef(false);
  const firstCalendarRecordedRef = React.useRef(false);
  const telemetryReportedRef = React.useRef(false);
  const mountRefreshStartedRef = React.useRef(false);
  const lastRangeRefreshKeyRef = React.useRef<string | null>(null);
  const lastHandledPlanQueryRef = React.useRef<string | null>(null);
  const initialLoadStartedRef = React.useRef(performance.now());
  const [view, setView] = React.useState<PlannedCalendarView>(() =>
    defaultPlannedCalendarView(matchMobile(), readSavedView()),
  );
  const [mobileInspector, setMobileInspector] = React.useState(matchMobileInspector);
  const [title, setTitle] = React.useState('');
  const [calendarQuery, setCalendarQuery] = React.useState('');
  const [selectedDay, setSelectedDay] = React.useState(() => new Date());
  const [range, setRange] = React.useState<{ start: Date; end: Date } | null>(null);
  const [occurrences, setOccurrences] = React.useState<PlannedCalendarOccurrence[]>([]);
  const [legacyEvents, setLegacyEvents] = React.useState<EventInput[]>([]);
  const [plans, setPlans] = React.useState<PlannedTaskRow[]>([]);
  const [runs, setRuns] = React.useState<PlannedRunRow[]>([]);
  const [plansLoading, setPlansLoading] = React.useState(true);
  const [calendarLoading, setCalendarLoading] = React.useState(true);
  const [firstPlansMs, setFirstPlansMs] = React.useState<number | null>(null);
  const [firstCalendarMs, setFirstCalendarMs] = React.useState<number | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [editor, setEditor] = React.useState<EditorState | null>(null);
  // Keep the last form visible while Radix Presence completes the approved exit motion.
  const lastEditor = React.useRef<EditorState | null>(null);
  React.useLayoutEffect(() => { if (editor) lastEditor.current = editor; }, [editor]);
  const displayEditor = editor ?? lastEditor.current;
  const [editorBaseline, setEditorBaseline] = React.useState<string | null>(null);
  const [editorErrors, setEditorErrors] = React.useState<PlannedEditorErrors>({});
  const [pendingEditorTransition, setPendingEditorTransition] =
    React.useState<PendingEditorTransition | null>(null);
  const [pendingScope, setPendingScope] = React.useState<PendingScopeAction | null>(null);
  const editorDirty = Boolean(
    editor && editorBaseline && plannedEditorFingerprint(editor) !== editorBaseline,
  );

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

  React.useEffect(() => {
    const query = window.matchMedia?.(MOBILE_INSPECTOR_QUERY);
    if (!query) return;
    const listener = (event: MediaQueryListEvent): void => setMobileInspector(event.matches);
    query.addEventListener('change', listener);
    setMobileInspector(query.matches);
    return () => query.removeEventListener('change', listener);
  }, []);

  React.useEffect(() => {
    if (!editorDirty) return;
    const preventUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', preventUnload);
    return () => window.removeEventListener('beforeunload', preventUnload);
  }, [editorDirty]);

  const refreshPlans = React.useCallback(async () => {
    const startedAt = performance.now();
    setPlansLoading(true);
    try {
      const rows = (await trpc.plannedTasks.list.query({ limit: 200 })) as PlannedTaskRow[];
      if (mountedRef.current) {
        setPlans(rows);
        if (!firstPlansRecordedRef.current) {
          firstPlansRecordedRef.current = true;
          setFirstPlansMs(performance.now() - startedAt);
        }
      }
    } finally {
      if (mountedRef.current) setPlansLoading(false);
    }
  }, []);

  const refreshCalendar = React.useCallback(async (targetRange: PlannedCalendarRange) => {
    const requestId = ++calendarRequestRef.current;
    const startedAt = performance.now();
    setCalendarLoading(true);
    const input = {
      rangeStart: targetRange.start.toISOString(),
      rangeEnd: targetRange.end.toISOString(),
    };
    try {
      const [rows, oldRows] = await Promise.all([
        trpc.plannedTasks.calendar.query(input) as Promise<PlannedCalendarOccurrence[]>,
        trpc.scheduledTasks.list.query(input) as Promise<LegacyScheduledTaskRow[]>,
      ]);
      if (mountedRef.current && requestId === calendarRequestRef.current) {
        setOccurrences(rows);
        setLegacyEvents(oldRows.map(legacyScheduledEvent));
        if (!firstCalendarRecordedRef.current) {
          firstCalendarRecordedRef.current = true;
          setFirstCalendarMs(performance.now() - startedAt);
        }
      }
    } finally {
      if (mountedRef.current && requestId === calendarRequestRef.current) {
        setCalendarLoading(false);
      }
    }
  }, []);

  const runRefresh = React.useCallback(
    async (
      reason: 'mount' | 'range' | 'mutation',
      targetRange: PlannedCalendarRange | null,
    ) => {
      const targets = plannedRefreshTargets(reason);
      const requests: Promise<void>[] = [];
      if (targets.plans) requests.push(refreshPlans());
      if (targets.calendar && targetRange) requests.push(refreshCalendar(targetRange));
      if (requests.length === 0) return;
      try {
        await Promise.all(requests);
      } catch (error) {
        toast.show(errorMessage(error, '规划任务暂时无法加载'), 'error');
      }
    },
    [refreshCalendar, refreshPlans, toast],
  );

  const refresh = React.useCallback(async () => {
    try {
      await runRefresh('mutation', range);
    } catch {
      // runRefresh owns user-facing load errors.
    }
  }, [range, runRefresh]);

  React.useEffect(() => {
    if (mountRefreshStartedRef.current) return;
    mountRefreshStartedRef.current = true;
    void runRefresh('mount', null);
  }, [runRefresh]);

  React.useEffect(() => {
    if (!range) return;
    const key = `${range.start.toISOString()}:${range.end.toISOString()}`;
    if (lastRangeRefreshKeyRef.current === key) return;
    lastRangeRefreshKeyRef.current = key;
    void runRefresh('range', range);
  }, [range, runRefresh]);

  React.useEffect(() => {
    const planQuery = searchParams.get('plan');
    if (plansLoading || planQuery === null || lastHandledPlanQueryRef.current === planQuery) {
      return;
    }
    lastHandledPlanQueryRef.current = planQuery;
    const target = ownedPlannedTaskQueryTarget(planQuery, plans);
    if (target) openPlan(target, null);
    // `openPlan` is intentionally handled once per query value. Plan refreshes must not
    // reopen the inspector or issue duplicate detail requests.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plans, plansLoading, searchParams]);

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

  React.useEffect(() => {
    if (
      firstPlansMs === null ||
      firstCalendarMs === null ||
      telemetryReportedRef.current
    ) {
      return;
    }
    telemetryReportedRef.current = true;
    const metric = buildPlannedLoadMetric({
      view,
      plansMs: firstPlansMs,
      calendarMs: firstCalendarMs,
      totalMs: performance.now() - initialLoadStartedRef.current,
      plannedCount: plans.length,
      legacyCount: legacyEvents.length,
    });
    void trpc.plannedTasks.reportLoadMetric.mutate(metric).catch((error: unknown) => {
      if (import.meta.env.DEV) {
        console.debug('planned load telemetry unavailable', error);
      }
    });
  }, [firstCalendarMs, firstPlansMs, legacyEvents.length, plans.length, view]);

  const events = React.useMemo(
    () => [
      ...occurrences.map((occurrence) => calendarEventFromOccurrence(occurrence)),
      ...legacyEvents,
    ].filter(event => !calendarQuery.trim() || event.title?.toLocaleLowerCase().includes(calendarQuery.trim().toLocaleLowerCase())),
    [legacyEvents, occurrences, calendarQuery],
  );
  const attentionCount = plans.filter(
    (plan) => plannedStatusGroup(plan).group === 'attention',
  ).length;
  const activeCount = plans.filter((plan) => plan.status === 'active').length;
  const emptyCalendarState = plannedCalendarEmptyState({
    loading: calendarLoading,
    plannedCount: occurrences.length,
    legacyCount: legacyEvents.length,
  });

  function changeView(nextView: PlannedCalendarView): void {
    setView(nextView);
    window.localStorage?.setItem(VIEW_STORAGE_KEY, nextView);
    calendarRef.current?.getApi().changeView(nextView);
  }

  function applyEditor(next: EditorState | null): void {
    setEditor(next);
    setEditorBaseline(next ? plannedEditorFingerprint(next) : null);
    setEditorErrors({});
  }

  function requestEditorTransition(apply: () => void): void {
    if (editorDirty) {
      discardReturnFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setPendingEditorTransition({ apply });
      return;
    }
    apply();
  }

  function rememberEditorReturnFocus(): void {
    if (editor) return;
    editorReturnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }

  function closeEditor(): void {
    requestEditorTransition(() => {
      applyEditor(null);
      // Radix restores focus after the 380ms exit, not before the retained form leaves.
    });
  }

  function clearEditorError(key: PlannedEditorErrorKey): void {
    setEditorErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function focusEditorError(key: PlannedEditorErrorKey): void {
    const target =
      key === 'instruction'
        ? instructionRef.current
        : key === 'items'
          ? firstItemRef.current
          : key === 'scheduledAt'
            ? scheduledAtRef.current
            : customDaysRef.current;
    window.requestAnimationFrame(() => target?.focus());
  }

  function openScopeDialog(action: PendingScopeAction): void {
    scopeReturnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPendingScope(action);
  }

  function openCreate(date = nextWholeHour()): void {
    const next = emptyEditor(date);
    requestEditorTransition(() => {
      rememberEditorReturnFocus();
      applyEditor(next);
      setRuns([]);
    });
  }

  function openPlan(
    plannedTaskId: string,
    occurrence: PlannedCalendarOccurrence | null,
  ): void {
    requestEditorTransition(() => {
      rememberEditorReturnFocus();
      void loadPlan(plannedTaskId, occurrence);
    });
  }

  async function loadPlan(
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
      applyEditor({
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
        reminderMinutes: plan.reminderMinutes === null ? '' : String(plan.reminderMinutes),
        endsOn: plan.endsOn,
      });
    } catch (error) {
      toast.show(errorMessage(error, '无法打开这条规划任务'), 'error');
    }
  }

  function handleDateClick(arg: DateClickArg): void {
    const date = new Date(arg.date);
    if (arg.allDay) date.setHours(9, 0, 0, 0);
    setSelectedDay(date);
  }

  function handleEventClick(arg: EventClickArg): void {
    if (arg.event.extendedProps.legacy) {
      const focus = arg.event.extendedProps.scheduledTaskInternalId;
      requestEditorTransition(() =>
        navigate(
          focus
            ? `/planned/legacy-scheduled?focusScheduledTaskInternalId=${encodeURIComponent(String(focus))}`
            : '/planned/legacy-scheduled',
        ),
      );
      return;
    }
    const occurrence = occurrenceFromEvent(arg);
    openPlan(occurrence.plannedTaskId, occurrence);
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
    openScopeDialog({ kind: 'reschedule', occurrence, scheduledFor });
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
      applyEditor(null);
      toast.show(scope === 'series' ? '规划已删除' : '日程已更新', 'info');
      await refresh();
    } catch (error) {
      toast.show(errorMessage(error, '删除失败'), 'error');
    }
  }

  async function saveEditor(editScope?: 'occurrence' | 'future' | 'series'): Promise<void> {
    if (!editor) return;
    if (
      editor.plannedTaskId &&
      editor.occurrence &&
      editor.occurrence.repeatType !== 'once' &&
      !editScope
    ) {
      openScopeDialog({ kind: 'update', occurrence: editor.occurrence });
      return;
    }
    const errors = validatePlannedEditor(editor);
    const firstError = firstPlannedEditorError(errors);
    if (firstError) {
      setEditorErrors(errors);
      focusEditorError(firstError);
      return;
    }
    const scheduledAt = localDateTime(editor.date, editor.time);
    const items = editor.multiple ? editor.items.map((item) => item.trim()).filter(Boolean) : [];
    const instruction = editor.instruction.trim();
    const rrule =
      editor.repeatType === 'custom'
        ? buildCustomWeeklyRRule(editor.customDays, scheduledAt)
        : null;
    setSaving(true);
    try {
      if (editor.plannedTaskId) {
        const result = await trpc.plannedTasks.update.mutate({
          plannedTaskId: editor.plannedTaskId,
          title: editor.title.trim() || undefined,
          instruction,
          items,
          repeatType: editor.repeatType,
          scheduledAt: scheduledAt.toISOString(),
          rrule,
          timezone: editor.timezone,
          ...plannedEndsOnPayload(editScope ?? 'series', editor.endsOn),
          reminderMinutes: editor.reminderMinutes ? Number(editor.reminderMinutes) : null,
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
          plannedSaveFeedback({
            action: editScope ?? 'series',
            adjusted: result.adjusted,
            nextRunAt: result.nextRunAt,
            timezone: editor.timezone,
          }),
          'info',
        );
      } else {
        const result = await trpc.plannedTasks.create.mutate({
          title: editor.title.trim(),
          instruction,
          items,
          repeatType: editor.repeatType,
          scheduledAt: scheduledAt.toISOString(),
          rrule,
          timezone: editor.timezone,
          endsOn: editor.endsOn,
          reminderMinutes: editor.reminderMinutes ? Number(editor.reminderMinutes) : null,
        });
        toast.show(
          plannedSaveFeedback({
            action: 'create',
            adjusted: result.adjusted,
            nextRunAt: result.nextRunAt,
            timezone: editor.timezone,
          }),
          'info',
        );
      }
      applyEditor(null);
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
    ? (plans.find((plan) => plan.plannedTaskId === editor.plannedTaskId) ?? null)
    : null;

  return (
    <PageContainer width="wide" className="planned-page max-w-[1320px]">
      <span className="hd-page-eyebrow">A LITTLE PLANNING. MORE POSSIBILITY.</span>
      <PageHeader
        title="把时间，留给重要的事。"
        description="安排一次，Holaday 在合适的时候开始。"
        action={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="hd-legacy-plans" title="旧任务记录" aria-label="旧任务记录">
                  <History aria-hidden />
                  <span className="sr-only">旧任务记录</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => navigate('/planned/legacy-scheduled')}>
                  <CalendarClock aria-hidden />
                  原定时任务
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => navigate('/planned/legacy-batch')}>
                  <ListChecks aria-hidden />
                  原批量任务
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button onClick={() => openCreate(selectedDay)}>
              <Plus aria-hidden />
              新建规划
            </Button>
          </>
        }
      />

      <div className="hd-planned-page-tabs">            <div className="planned-toolbar__views" aria-label="视图切换">
              <button
                type="button"
                className={view === 'dayGridMonth' ? 'is-active' : ''}
                aria-pressed={view === 'dayGridMonth'}
                onClick={() => changeView('dayGridMonth')}
              >
                月历
              </button>
              <button
                type="button"
                className={view === 'listMonth' ? 'is-active' : ''}
                aria-pressed={view === 'listMonth'}
                onClick={() => changeView('listMonth')}
              >
                日程
              </button>
            </div>
<label className="hd-planned-search"><Search /><input aria-label="查找规划" placeholder="查找规划" value={calendarQuery} onChange={event => setCalendarQuery(event.target.value)} /></label></div>
      <div
        className="planned-summary"
        aria-label="规划任务概览"
        aria-busy={plansLoading}
      >
        <span>
          <CalendarClock aria-hidden />
          {activeCount} 个已启用
        </span>
        <span>
          <ListChecks aria-hidden />
          {plans.reduce((sum, plan) => sum + plan.itemCount, 0)} 个任务项
        </span>
        {legacyEvents.length > 0 && (
          <span>
            <History aria-hidden />
            另有 {legacyEvents.length} 个旧任务
          </span>
        )}
        {attentionCount > 0 && (
          <span className="planned-summary__attention">
            <CircleAlert aria-hidden />
            {attentionCount} 个需处理
          </span>
        )}
      </div>

      <div className="planned-workbench hd-planned-workbench">
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
              <Button variant="outline" onClick={() => { calendarRef.current?.getApi().today(); setSelectedDay(new Date()); }}>
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
            {calendarLoading && (
              <span className="planned-toolbar__loading" role="status">
                <Loader2 className="animate-spin" aria-hidden />
                更新中
              </span>
            )}
          </div>
          <FullCalendar
            ref={calendarRef}
            plugins={[dayGridPlugin, listPlugin, interactionPlugin]}
            locale={zhCnLocale}
            initialView={view}
            headerToolbar={false}
            height="auto"
            dayMaxEvents={2}
            fixedWeekCount={false}
            eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
            dayHeaderContent={arg => arg.text.replace('周', '')}
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
            dayCellContent={arg => String(arg.date.getDate())}
            dayCellClassNames={arg => arg.date.toDateString() === selectedDay.toDateString() ? ['hd-selected-day'] : []}
            dateClick={handleDateClick}
            eventClick={handleEventClick}
            eventDrop={handleEventDrop}
            eventContent={renderEventContent}
            noEventsContent=""
          />
          {emptyCalendarState && (
            <div className="planned-calendar-empty" role="status">
              <div>
                <strong>{emptyCalendarState.title}</strong>
                <p>{emptyCalendarState.description}</p>
                {legacyEvents.length > 0 ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigate('/planned/legacy-scheduled')}
                  >
                    查看旧任务记录
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => openCreate()}>
                    <Plus aria-hidden />
                    新建规划
                  </Button>
                )}
              </div>
            </div>
          )}
        </section>

        {<aside key={selectedDay.toDateString()} className="hd-day-agenda" aria-label="当天安排">
          <header><div><span>{selectedDay.toDateString() === new Date().toDateString() ? 'TODAY' : 'SCHEDULE'}</span><h2>{selectedDay.toLocaleDateString('zh-CN', { month:'long', day:'numeric' })}</h2><small>{events.filter(event => event.start && new Date(event.start as string).toDateString() === selectedDay.toDateString()).length} 项安排 · 按各规划当地时间</small></div><button type="button" title="添加当天安排" aria-label="添加当天安排" onClick={() => openCreate(selectedDay)}><Plus /></button></header>
          <div className="hd-agenda-events">
            {events.filter(event => event.start && new Date(event.start as string).toDateString() === selectedDay.toDateString()).sort((a,b) => new Date(a.start as string).getTime() - new Date(b.start as string).getTime()).map(event => {
              const props = event.extendedProps ?? {};
              const occurrence = occurrences.find(row => row.occurrenceId === event.id);
              return <button key={event.id} type="button" className="hd-agenda-item" data-status={props.status} onClick={() => {
                if (props.legacy) { navigate('/planned/legacy-scheduled'); return; }
                if (occurrence) void openPlan(occurrence.plannedTaskId, occurrence);
              }}><i style={{ background: String(props.accent ?? '#ADADAD') }} /><time>{new Date(event.start as string).toLocaleTimeString('zh-CN', { hour:'2-digit',minute:'2-digit',hour12:false })}</time><strong>{event.title}</strong><small>{props.legacy ? '旧任务' : `${plannedRepeatLabel(String(props.repeatType))} · ${props.itemCount ?? 1} 个任务项`}</small></button>;
            })}
            {!events.some(event => event.start && new Date(event.start as string).toDateString() === selectedDay.toDateString()) && <p className="hd-agenda-empty">{calendarLoading ? '正在读取当天安排…' : '这一天还没有安排，留一点时间给新的想法。'}</p>}
          </div>
          <button className="hd-agenda-create" type="button" onClick={() => openCreate(selectedDay)}><Plus />安排一件事</button><p className="hd-agenda-note">定时开始，完成后通知你。<br />重复的小事，也可以从日常里腾出来。</p>
        </aside>}

        {displayEditor && (
          <PlannedInspectorSurface
            open={Boolean(editor)}
            modal={mobileInspector}
            label={displayEditor.plannedTaskId ? '编辑规划' : '新建规划'}
            initialFocusRef={displayEditor.multiple ? firstItemRef : instructionRef}
            returnFocusRef={editorReturnFocusRef}
            onRequestClose={closeEditor}
          >
            <div className="planned-inspector__header">
              <div>
                <span>{displayEditor.plannedTaskId ? '规划详情' : '新建规划'}</span>
                <strong>
                  {displayEditor.plannedTaskId ? displayEditor.title || '未命名规划' : '安排未来任务'}
                </strong>
              </div>
              <Button
                variant="ghost"
                size="icon"
                title="关闭"
                aria-label="关闭"
                onClick={closeEditor}
              >
                <X aria-hidden />
              </Button>
            </div>

            <div className="planned-inspector__body">
              <Field label="名称（选填）">
                <Input
                  aria-label="名称"
                  value={displayEditor.title}
                  maxLength={200}
                  placeholder="例如：每周竞品价格检查"
                  onChange={(event) => setEditor({ ...displayEditor, title: event.target.value })}
                />
              </Field>

              <div className="planned-mode" aria-label="任务数量模式">
                <button
                  type="button"
                  className={!displayEditor.multiple ? 'is-active' : ''}
                  aria-pressed={!displayEditor.multiple}
                  onClick={() => {
                    setEditor({ ...displayEditor, multiple: false });
                    clearEditorError('items');
                  }}
                >
                  单个任务
                </button>
                <button
                  type="button"
                  className={displayEditor.multiple ? 'is-active' : ''}
                  aria-pressed={displayEditor.multiple}
                  onClick={() => {
                    setEditor({ ...displayEditor, multiple: true });
                    clearEditorError('instruction');
                  }}
                >
                  多个任务
                </button>
              </div>

              {displayEditor.multiple ? (
                <Field label={`任务清单 · ${displayEditor.items.filter((item) => item.trim()).length}/50`}>
                  <div className="planned-items">
                    {displayEditor.items.map((item, index) => (
                      <div className="planned-item" key={`${index}-${displayEditor.items.length}`}>
                        <span>{index + 1}</span>
                        <Input
                          ref={index === 0 ? firstItemRef : undefined}
                          aria-label={`任务 ${index + 1}`}
                          aria-invalid={index === 0 && Boolean(editorErrors.items)}
                          aria-describedby={
                            index === 0 && editorErrors.items ? 'planned-error-items' : undefined
                          }
                          value={item}
                          placeholder="描述这个任务"
                          onChange={(event) => {
                            const items = [...displayEditor.items];
                            items[index] = event.target.value;
                            setEditor({ ...displayEditor, items });
                            clearEditorError('items');
                          }}
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          title="移除任务"
                          aria-label={`移除任务 ${index + 1}`}
                          disabled={displayEditor.items.length === 1}
                          onClick={() =>
                            setEditor({
                              ...displayEditor,
                              items: displayEditor.items.filter((_, itemIndex) => itemIndex !== index),
                            })
                          }
                        >
                          <X aria-hidden />
                        </Button>
                      </div>
                    ))}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={displayEditor.items.length >= 50}
                      onClick={() => setEditor({ ...displayEditor, items: [...displayEditor.items, ''] })}
                    >
                      <Plus aria-hidden />
                      添加任务
                    </Button>
                    {editorErrors.items && (
                      <p id="planned-error-items" className="planned-field-error" role="alert">
                        {editorErrors.items}
                      </p>
                    )}
                  </div>
                </Field>
              ) : (
                <Field label="任务说明">
                  <Textarea
                    ref={instructionRef}
                    aria-label="任务说明"
                    aria-invalid={Boolean(editorErrors.instruction)}
                    aria-describedby={
                      editorErrors.instruction ? 'planned-error-instruction' : undefined
                    }
                    value={displayEditor.instruction}
                    rows={5}
                    placeholder="说清目标、范围和交付结果"
                    onChange={(event) => {
                      setEditor({ ...displayEditor, instruction: event.target.value });
                      clearEditorError('instruction');
                    }}
                  />
                  {editorErrors.instruction && (
                    <p
                      id="planned-error-instruction"
                      className="planned-field-error"
                      role="alert"
                    >
                      {editorErrors.instruction}
                    </p>
                  )}
                </Field>
              )}

              {displayEditor.multiple && (
                <Field label="统一要求（可选）">
                  <Textarea
                    aria-label="统一要求（可选）"
                    value={displayEditor.instruction}
                    rows={3}
                    placeholder="例如：每项都给出来源链接"
                    onChange={(event) => setEditor({ ...displayEditor, instruction: event.target.value })}
                  />
                </Field>
              )}

              <div className="planned-form-grid">
                <Field label="日期">
                  <Input
                    ref={scheduledAtRef}
                    aria-label="日期"
                    aria-invalid={Boolean(editorErrors.scheduledAt)}
                    aria-describedby={
                      editorErrors.scheduledAt ? 'planned-error-scheduled-at' : undefined
                    }
                    type="date"
                    value={displayEditor.date}
                    onChange={(event) => {
                      setEditor({ ...displayEditor, date: event.target.value });
                      clearEditorError('scheduledAt');
                    }}
                  />
                </Field>
                <Field label="时间">
                  <Input
                    aria-label="时间"
                    aria-invalid={Boolean(editorErrors.scheduledAt)}
                    aria-describedby={
                      editorErrors.scheduledAt ? 'planned-error-scheduled-at' : undefined
                    }
                    type="time"
                    value={displayEditor.time}
                    onChange={(event) => {
                      setEditor({ ...displayEditor, time: event.target.value });
                      clearEditorError('scheduledAt');
                    }}
                  />
                </Field>
              </div>
              {editorErrors.scheduledAt && (
                <p
                  id="planned-error-scheduled-at"
                  className="planned-field-error planned-form-grid-error"
                  role="alert"
                >
                  {editorErrors.scheduledAt}
                </p>
              )}

              <Field label="重复">
                <div className="planned-repeat">
                  {(['once', 'daily', 'weekly', 'monthly', 'custom'] as const).map((repeatType) => (
                    <button
                      type="button"
                      key={repeatType}
                      className={displayEditor.repeatType === repeatType ? 'is-active' : ''}
                      aria-pressed={displayEditor.repeatType === repeatType}
                      onClick={() => {
                        setEditor({
                          ...displayEditor,
                          repeatType,
                          endsOn: nextPlannedEndState(repeatType, displayEditor.endsOn),
                        });
                        if (repeatType !== 'custom') clearEditorError('customDays');
                      }}
                    >
                      {plannedRepeatLabel(repeatType)}
                    </button>
                  ))}
                </div>
              </Field>
              {displayEditor.repeatType === 'custom' && (
                <Field label="每周执行日">
                  <div
                    ref={customDaysRef}
                    className="planned-weekdays"
                    role="group"
                    tabIndex={-1}
                    aria-invalid={Boolean(editorErrors.customDays)}
                    aria-describedby={
                      editorErrors.customDays ? 'planned-error-custom-days' : undefined
                    }
                  >
                    {WEEKDAYS.map(([value, label]) => (
                      <button
                        type="button"
                        key={value}
                        className={displayEditor.customDays.includes(value) ? 'is-active' : ''}
                        aria-pressed={displayEditor.customDays.includes(value)}
                        onClick={() => {
                          setEditor({
                            ...displayEditor,
                            customDays: displayEditor.customDays.includes(value)
                              ? displayEditor.customDays.filter((day) => day !== value)
                              : [...displayEditor.customDays, value],
                          });
                          clearEditorError('customDays');
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {editorErrors.customDays && (
                    <p
                      id="planned-error-custom-days"
                      className="planned-field-error"
                      role="alert"
                    >
                      {editorErrors.customDays}
                    </p>
                  )}
                </Field>
              )}

              {displayEditor.repeatType !== 'once' && (
                <Field label="结束">
                  <div className="planned-mode planned-end-mode">
                    <button
                      type="button"
                      className={displayEditor.endsOn === null ? 'is-active' : ''}
                      aria-pressed={displayEditor.endsOn === null}
                      onClick={() => setEditor({ ...displayEditor, endsOn: null })}
                    >
                      永不结束
                    </button>
                    <button
                      type="button"
                      className={displayEditor.endsOn !== null ? 'is-active' : ''}
                      aria-pressed={displayEditor.endsOn !== null}
                      onClick={() => setEditor({ ...displayEditor, endsOn: displayEditor.endsOn ?? displayEditor.date })}
                    >
                      结束日期
                    </button>
                  </div>
                  {displayEditor.endsOn !== null && (
                    <Input
                      aria-label="结束日期"
                      className="planned-end-date"
                      type="date"
                      value={displayEditor.endsOn}
                      onChange={(event) => setEditor({ ...displayEditor, endsOn: event.target.value })}
                    />
                  )}
                </Field>
              )}

              <div className="planned-form-grid">
                <Field label="时区">
                  <select
                    aria-label="时区"
                    value={displayEditor.timezone}
                    onChange={(event) => setEditor({ ...displayEditor, timezone: event.target.value })}
                  >
                    <option value="Asia/Shanghai">中国标准时间</option>
                    <option value="Asia/Tokyo">日本标准时间</option>
                    <option value="America/New_York">美国东部时间</option>
                    <option value="Europe/London">英国时间</option>
                  </select>
                </Field>
                <Field label="提前提醒">
                  <select
                    aria-label="提前提醒"
                    value={displayEditor.reminderMinutes}
                    onChange={(event) =>
                      setEditor({ ...displayEditor, reminderMinutes: event.target.value })
                    }
                  >
                    <option value="">不提醒</option>
                    <option value="10">10 分钟</option>
                    <option value="30">30 分钟</option>
                    <option value="60">1 小时</option>
                    <option value="1440">1 天</option>
                  </select>
                  <p className="planned-field-hint">
                    通过站内通知提醒 · <Link to="/settings#notifications">通知设置</Link>
                  </p>
                </Field>
              </div>

              <p className="planned-workload">
                <Clock3 aria-hidden />
                {workloadHint(
                  displayEditor.multiple ? displayEditor.items.filter((item) => item.trim()).length : 1,
                )}
              </p>

              {displayEditor.plannedTaskId && (
                <div className="planned-actions-row">
                  <Button variant="outline" size="sm" onClick={() => void runNow()}>
                    <Play aria-hidden />
                    立即执行
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => void togglePlan()}>
                    {selectedPlan?.status === 'paused' ? (
                      <RotateCcw aria-hidden />
                    ) : (
                      <Pause aria-hidden />
                    )}
                    {selectedPlan?.status === 'paused' ? '恢复' : '暂停'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    onClick={() => {
                      if (displayEditor.occurrence && displayEditor.occurrence.repeatType !== 'once') {
                        openScopeDialog({ kind: 'remove', occurrence: displayEditor.occurrence });
                      } else if (displayEditor.occurrence) {
                        void removeOccurrence(displayEditor.occurrence, 'series');
                      }
                    }}
                  >
                    <Trash2 aria-hidden />
                    删除
                  </Button>
                </div>
              )}

              {displayEditor.plannedTaskId && (
                <div className="planned-runs">
                  <h3>
                    <History aria-hidden />
                    运行记录
                  </h3>
                  {runs.length === 0 ? (
                    <p>还没有执行记录。</p>
                  ) : (
                    runs.map((run) => {
                      const riskSummary = stockRiskRunSummary(run.resultJson);
                      return (
                        <div className="planned-run" key={run.runId}>
                          <span
                            className={`planned-run__status planned-run__status--${run.status}`}
                          >
                            {runStatusLabel(run.status)}
                          </span>
                          <div>
                            <strong>{run.title}</strong>
                            <small>
                              {formatDateTime(run.scheduledFor)} · {run.itemsDone}/{run.itemsTotal}{' '}
                              完成{run.itemsFailed > 0 ? ` · ${run.itemsFailed} 失败` : ''}
                            </small>
                            {riskSummary && (
                              <div className="planned-run__risk-summary">
                                <div className="planned-run__risk-meta">
                                  <span>{riskSummary.outcomeLabel}</span>
                                  {riskSummary.dataAsOf && <span>数据 {riskSummary.dataAsOf}</span>}
                                  {riskSummary.changeCount > 0 && (
                                    <span>{riskSummary.changeCount} 项变化</span>
                                  )}
                                  {riskSummary.unavailableCount > 0 && (
                                    <span>{riskSummary.unavailableCount} 项暂不可判断</span>
                                  )}
                                </div>
                                <p>{riskSummary.summary}</p>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>

            <div className="planned-inspector__footer">
              <Button
                variant="outline"
                onClick={closeEditor}
              >
                取消
              </Button>
              <Button onClick={() => void saveEditor()} disabled={saving}>
                {saving && <Loader2 className="animate-spin" aria-hidden />}
                {displayEditor.plannedTaskId ? '保存规划' : '创建规划'}
              </Button>
            </div>
            <PlannedDiscardDialog
              open={pendingEditorTransition !== null}
              returnFocusRef={discardReturnFocusRef}
              onClose={() => setPendingEditorTransition(null)}
              onConfirm={() => {
                const transition = pendingEditorTransition;
                setPendingEditorTransition(null);
                transition?.apply();
              }}
            />
          </PlannedInspectorSurface>
        )}
      </div>

      <PlannedScopeDialog
        open={pendingScope !== null}
        kind={pendingScope?.kind ?? 'update'}
        returnFocusRef={scopeReturnFocusRef}
        onSelect={(scope) => void applyScope(scope)}
        onClose={() => setPendingScope(null)}
      />
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
  return (
    <fieldset className="planned-field">
      <legend>{label}</legend>
      {children}
    </fieldset>
  );
}

interface PlannedInspectorSurfaceProps {
  open: boolean;
  modal: boolean;
  label: string;
  initialFocusRef: React.RefObject<HTMLElement>;
  returnFocusRef: React.RefObject<HTMLElement>;
  onRequestClose(): void;
  children: React.ReactNode;
}

interface PlannedDiscardDialogProps {
  open: boolean;
  returnFocusRef: React.RefObject<HTMLElement>;
  onConfirm(): void;
  onClose(): void;
}

function PlannedDiscardDialog({
  open,
  returnFocusRef,
  onConfirm,
  onClose,
}: PlannedDiscardDialogProps): JSX.Element {
  const cancelRef = React.useRef<HTMLButtonElement>(null);

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/35 px-4 backdrop-blur-sm data-[state=open]:animate-fade-in" />
        <Dialog.Content
          className="hd-planned-discard fixed left-1/2 top-1/2 z-[81] w-[calc(100vw-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[#DCDDDD] bg-white p-5 text-card-foreground shadow-[0_16px_48px_rgba(17,24,39,0.16)] outline-none dark:border-white/10 dark:bg-card"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            cancelRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus();
          }}
        >
          <Dialog.Title className="text-base font-semibold tracking-tight text-[#2F2F2F] dark:text-foreground">
            放弃未保存的更改？
          </Dialog.Title>
          <Dialog.Description className="mt-2 whitespace-pre-line text-sm leading-relaxed text-[#595757] dark:text-muted-foreground">
            当前修改尚未保存，关闭后将无法恢复。
          </Dialog.Description>
          <div className="mt-5 flex items-center justify-end gap-2">
            <Dialog.Close asChild>
              <Button
                ref={cancelRef}
                variant="ghost"
                size="sm"
                className="hover:bg-[#EFEFEF]/70 dark:hover:bg-white/10"
              >
                继续编辑
              </Button>
            </Dialog.Close>
            <Button
              size="sm"
              className="bg-[#FF0061] text-white shadow-[0_4px_12px_rgba(255,0,97,0.16)] hover:bg-[#FF0061]/90 focus-visible:ring-[#FF0061]/25"
              onClick={onConfirm}
            >
              放弃更改
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function PlannedInspectorSurface({
  open,
  modal,
  label,
  initialFocusRef,
  returnFocusRef,
  onRequestClose,
  children,
}: PlannedInspectorSurfaceProps): JSX.Element {
  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => !nextOpen && onRequestClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="planned-inspector-overlay" />
        <Dialog.Content
          className="planned-inspector"
          data-mobile={modal}
          aria-label={label}
          aria-modal="true"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            initialFocusRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus();
          }}
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            onRequestClose();
          }}
        >
          <Dialog.Title className="sr-only">{label}</Dialog.Title>
          <Dialog.Description className="sr-only">
            设置任务内容、执行时间和重复方式。
          </Dialog.Description>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function renderEventContent(arg: EventContentArg): JSX.Element {
  const itemCount = Number(arg.event.extendedProps.itemCount ?? 1);
  const legacy = Boolean(arg.event.extendedProps.legacy);
  return (
    <div
      className="planned-event"
      data-status={arg.event.extendedProps.status}
      style={{ '--planned-event-accent': arg.event.extendedProps.accent } as React.CSSProperties}
    >
      <span>{arg.event.title}</span>
      <div className="hd-planned-event-meta"><time>{arg.timeText}</time><small>{legacy ? '旧任务' : arg.event.extendedProps.status === 'paused' ? '已暂停' : itemCount > 1 ? `${itemCount}项` : arg.event.extendedProps.repeatType === 'once' ? '单次' : '重复'}</small></div>
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
  return typeof window === 'undefined'
    ? null
    : (window.localStorage?.getItem(VIEW_STORAGE_KEY) ?? null);
}

function matchMobile(): boolean {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.(MOBILE_QUERY).matches);
}

function matchMobileInspector(): boolean {
  return (
    typeof window !== 'undefined' &&
    Boolean(window.matchMedia?.(MOBILE_INSPECTOR_QUERY).matches)
  );
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
  return (
    {
      pending: '等待启动',
      dispatching: '正在启动',
      running: '执行中',
      completed: '已完成',
      partial_success: '需复核',
      failed: '失败',
      cancelled: '已取消',
    }[status] ?? status
  );
}
