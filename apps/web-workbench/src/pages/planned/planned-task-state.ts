import type { EventInput } from '@fullcalendar/core';

export type PlannedCalendarView = 'dayGridMonth' | 'listMonth';
export type PlannedRepeatType = 'once' | 'daily' | 'weekly' | 'monthly' | 'custom';
export type PlannedTaskStatus = 'active' | 'paused' | 'running' | 'failed' | 'completed';

export interface PlannedCalendarOccurrence {
  occurrenceId: string;
  plannedTaskId: string;
  title: string;
  scheduledFor: string | Date;
  originalScheduledFor: string | Date;
  changed: boolean;
  status: string;
  repeatType: string;
  itemCount: number;
  timezone: string;
}

export interface LegacyScheduledTaskOccurrence {
  scheduledTaskInternalId?: number;
  scheduledTaskId: string;
  intent: string;
  repeatType: string;
  timezone: string;
  nextRunAt: string | Date;
  status: string;
  lastRunStatus: string | null;
}

export interface PlannedCalendarRange {
  start: Date;
  end: Date;
}

const VALID_VIEWS = new Set<PlannedCalendarView>(['dayGridMonth', 'listMonth']);

export function defaultPlannedCalendarView(
  isMobile: boolean,
  saved: string | null,
): PlannedCalendarView {
  if (saved && VALID_VIEWS.has(saved as PlannedCalendarView)) {
    return saved as PlannedCalendarView;
  }
  return isMobile ? 'listMonth' : 'dayGridMonth';
}

export function stablePlannedCalendarRange(
  current: PlannedCalendarRange | null,
  next: PlannedCalendarRange,
): PlannedCalendarRange {
  if (
    current?.start.getTime() === next.start.getTime() &&
    current.end.getTime() === next.end.getTime()
  ) {
    return current;
  }
  return next;
}

export function plannedStatusGroup(input: {
  status: string;
  lastRunStatus: string | null;
}): { group: 'active' | 'paused' | 'attention' | 'completed'; label: string } {
  if (input.status === 'paused') return { group: 'paused', label: '已暂停' };
  if (input.status === 'failed' || input.lastRunStatus === 'failed') {
    return { group: 'attention', label: '上次执行失败' };
  }
  if (input.status === 'completed') return { group: 'completed', label: '已完成' };
  if (input.status === 'running') return { group: 'active', label: '正在启动' };
  return { group: 'active', label: '已启用' };
}

export function plannedRepeatLabel(repeatType: string): string {
  return (
    {
      once: '不重复',
      daily: '每天',
      weekly: '每周',
      monthly: '每月',
      custom: '指定星期',
    }[repeatType] ?? '不重复'
  );
}

export function nextPlannedEndState(
  repeatType: PlannedRepeatType,
  currentEndsOn: string | null,
): string | null {
  return repeatType === 'once' ? null : currentEndsOn;
}

export function plannedEndsOnPayload(
  editScope: 'occurrence' | 'future' | 'series',
  endsOn: string | null,
): { endsOn?: string | null } {
  return editScope === 'occurrence' ? {} : { endsOn };
}

export function buildCustomWeeklyRRule(days: readonly string[], startsAt?: Date): string | null {
  const orderedDays = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'].filter((day) =>
    days.includes(day),
  );
  if (orderedDays.length === 0) return null;
  const rule = `RRULE:FREQ=WEEKLY;BYDAY=${orderedDays.join(',')}`;
  if (!startsAt) return rule;
  const stamp = startsAt
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
  return `DTSTART:${stamp}\n${rule}`;
}

export function calendarEventFromOccurrence(occurrence: PlannedCalendarOccurrence): EventInput {
  const accent =
    occurrence.status === 'failed'
      ? '#DC2626'
      : occurrence.status === 'paused'
        ? '#ADADAD'
        : '#EA1F59';
  return {
    id: occurrence.occurrenceId,
    title: occurrence.title,
    start:
      occurrence.scheduledFor instanceof Date
        ? occurrence.scheduledFor.toISOString()
        : occurrence.scheduledFor,
    backgroundColor: 'transparent',
    borderColor: 'transparent',
    textColor: '#292727',
    editable: occurrence.status !== 'completed',
    extendedProps: {
      plannedTaskId: occurrence.plannedTaskId,
      originalScheduledFor:
        occurrence.originalScheduledFor instanceof Date
          ? occurrence.originalScheduledFor.toISOString()
          : occurrence.originalScheduledFor,
      scheduledFor:
        occurrence.scheduledFor instanceof Date
          ? occurrence.scheduledFor.toISOString()
          : occurrence.scheduledFor,
      changed: occurrence.changed,
      status: occurrence.status,
      repeatType: occurrence.repeatType,
      itemCount: occurrence.itemCount,
      timezone: occurrence.timezone,
      accent,
    },
  };
}

export function legacyScheduledEvent(row: LegacyScheduledTaskOccurrence): EventInput {
  const attention = row.status === 'failed' || row.lastRunStatus === 'failed';
  return {
    id: `legacy:${row.scheduledTaskId}`,
    title: friendlyLegacyTaskTitle(row.intent, row.scheduledTaskId),
    start: row.nextRunAt instanceof Date ? row.nextRunAt.toISOString() : row.nextRunAt,
    backgroundColor: 'transparent',
    borderColor: 'transparent',
    textColor: '#292727',
    editable: false,
    extendedProps: {
      legacy: true,
      legacyLabel: '旧任务',
      scheduledTaskInternalId: row.scheduledTaskInternalId,
      scheduledTaskId: row.scheduledTaskId,
      status: row.status,
      repeatType: row.repeatType,
      timezone: row.timezone,
      itemCount: 1,
      accent: attention ? '#DC2626' : '#9B8F98',
    },
  };
}

const FRIENDLY_LEGACY_TITLES: Record<string, string> = {
  __ashare_premarket_briefing__: 'A股盘前简报',
  __ashare_postmarket_briefing__: 'A股盘后复盘',
};

export function friendlyLegacyTaskTitle(intent: string, scheduledTaskId: string): string {
  const normalizedIntent = intent.trim();
  const known =
    FRIENDLY_LEGACY_TITLES[normalizedIntent] ?? FRIENDLY_LEGACY_TITLES[scheduledTaskId.trim()];
  if (known) return known;
  if (/^__.+__$/.test(normalizedIntent) || /^__.+__$/.test(scheduledTaskId.trim())) {
    return '旧定时任务';
  }
  return normalizedIntent || '未命名旧定时任务';
}

export function plannedCalendarEmptyState(input: {
  loading: boolean;
  plannedCount: number;
  legacyCount: number;
}): { title: string; description: string } | null {
  if (input.loading || input.plannedCount > 0) return null;
  if (input.legacyCount > 0) {
    return {
      title: '这个月还没有规划任务',
      description: '日历中的灰色项目是旧任务，可前往旧任务记录管理。',
    };
  }
  return {
    title: '这个月还没有规划',
    description: '点击日期或新建规划，安排未来要做的任务。',
  };
}

export function workloadHint(itemCount: number): string {
  if (itemCount <= 1) return '本次将启动 1 个任务。';
  if (itemCount <= 8) return `本次将并行启动 ${itemCount} 个任务，实际速度取决于当前套餐。`;
  return `共 ${itemCount} 个任务，将按可用并发分批启动，不会阻止保存规划。`;
}
