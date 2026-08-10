import rruleModule from 'rrule';

const { rrulestr } = rruleModule as {
  rrulestr: (value: string) => {
    after(date: Date, inclusive?: boolean): Date | null;
    between(after: Date, before: Date, inclusive?: boolean): Date[];
  };
};

export type PlannedRepeatType = 'once' | 'daily' | 'weekly' | 'monthly' | 'custom';
export type PlannedTaskStatus = 'active' | 'paused' | 'failed' | 'completed' | 'archived';
export type OccurrenceEditScope = 'occurrence' | 'future' | 'series';

export interface PlannedOccurrenceException {
  originalScheduledFor: Date;
  action: 'rescheduled' | 'skipped';
  scheduledFor: Date | null;
}

export interface PlannedOccurrence {
  occurrenceId: string;
  plannedTaskId: string;
  originalScheduledFor: Date;
  scheduledFor: Date;
  changed: boolean;
}

export type DuePlannedOccurrenceResolution =
  | {
      action: 'dispatch';
      scheduledFor: Date;
      seriesScheduledFor: Date;
    }
  | {
      action: 'defer';
      nextRunAt: Date;
      seriesScheduledFor: Date;
    }
  | {
      action: 'skip';
      seriesScheduledFor: Date;
    };

export function resolveDuePlannedOccurrence(input: {
  nextRunAt: Date;
  now: Date;
  override: PlannedOccurrenceException | null;
}): DuePlannedOccurrenceResolution {
  const override = input.override;
  if (!override) {
    return {
      action: 'dispatch',
      scheduledFor: input.nextRunAt,
      seriesScheduledFor: input.nextRunAt,
    };
  }
  if (override.action === 'skipped') {
    return { action: 'skip', seriesScheduledFor: override.originalScheduledFor };
  }
  const scheduledFor = override.scheduledFor ?? input.nextRunAt;
  if (scheduledFor.getTime() > input.now.getTime()) {
    return {
      action: 'defer',
      nextRunAt: scheduledFor,
      seriesScheduledFor: override.originalScheduledFor,
    };
  }
  return {
    action: 'dispatch',
    scheduledFor,
    seriesScheduledFor: override.originalScheduledFor,
  };
}

export function normalizePlannedItems(items: readonly string[]): string[] {
  const unique = new Set<string>();
  for (const item of items) {
    const normalized = item.trim();
    if (normalized) unique.add(normalized);
  }
  const result = [...unique];
  if (result.length > 50) throw new Error('最多可规划 50 个任务');
  return result;
}

export function expandPlannedOccurrences(input: {
  plannedTaskId: string;
  firstRunAt: Date;
  endsAt?: Date | null;
  repeatType: PlannedRepeatType;
  rrule: string | null;
  rangeStart: Date;
  rangeEnd: Date;
  exceptions: readonly PlannedOccurrenceException[];
}): PlannedOccurrence[] {
  const exceptionByOriginal = new Map(
    input.exceptions.map((item) => [item.originalScheduledFor.getTime(), item]),
  );
  const effectiveRangeEnd =
    input.endsAt && input.endsAt.getTime() < input.rangeEnd.getTime()
      ? input.endsAt
      : input.rangeEnd;
  const baseDates = expandBaseDates({ ...input, rangeEnd: effectiveRangeEnd });
  const occurrences: PlannedOccurrence[] = [];
  const includedOriginalTimes = new Set<number>();

  for (const originalScheduledFor of baseDates) {
    const originalTime = originalScheduledFor.getTime();
    includedOriginalTimes.add(originalTime);
    const exception = exceptionByOriginal.get(originalTime);
    if (exception?.action === 'skipped') continue;
    const scheduledFor = exception?.scheduledFor ?? originalScheduledFor;
    if (!isInsideRange(scheduledFor, input.rangeStart, input.rangeEnd)) continue;
    occurrences.push(
      toOccurrence(input.plannedTaskId, originalScheduledFor, scheduledFor, Boolean(exception)),
    );
  }

  // A moved instance can enter the visible range even when its original slot
  // sits outside it. Include those exceptions explicitly.
  for (const exception of input.exceptions) {
    if (
      exception.action !== 'rescheduled' ||
      !exception.scheduledFor ||
      includedOriginalTimes.has(exception.originalScheduledFor.getTime()) ||
      !isInsideRange(exception.scheduledFor, input.rangeStart, input.rangeEnd)
    ) {
      continue;
    }
    occurrences.push(
      toOccurrence(
        input.plannedTaskId,
        exception.originalScheduledFor,
        exception.scheduledFor,
        true,
      ),
    );
  }

  return occurrences.sort((a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime());
}

export function buildOccurrenceEdit(input: {
  scope: OccurrenceEditScope;
  originalScheduledFor: Date;
  scheduledFor: Date;
}):
  | {
      kind: 'exception';
      action: 'rescheduled';
      originalScheduledFor: Date;
      scheduledFor: Date;
    }
  | {
      kind: 'series';
      effectiveFrom: Date | null;
      nextRunAt: Date;
    } {
  if (input.scope === 'occurrence') {
    return {
      kind: 'exception',
      action: 'rescheduled',
      originalScheduledFor: input.originalScheduledFor,
      scheduledFor: input.scheduledFor,
    };
  }
  return {
    kind: 'series',
    effectiveFrom: input.scope === 'future' ? input.originalScheduledFor : null,
    nextRunAt: input.scheduledFor,
  };
}

export function plannedTaskCanRunNow(status: PlannedTaskStatus): boolean {
  return status === 'active' || status === 'paused' || status === 'failed';
}

export function plannedReminderIsDue(input: {
  now: Date;
  nextRunAt: Date;
  reminderMinutes: number;
  lastReminderRun: Date | null;
}): boolean {
  const now = input.now.getTime();
  const nextRunAt = input.nextRunAt.getTime();
  if (now >= nextRunAt) return false;
  if (input.lastReminderRun && input.lastReminderRun.getTime() >= nextRunAt) return false;
  return now >= nextRunAt - input.reminderMinutes * 60_000;
}

function expandBaseDates(input: {
  firstRunAt: Date;
  repeatType: PlannedRepeatType;
  rrule: string | null;
  rangeStart: Date;
  rangeEnd: Date;
}): Date[] {
  if (input.rrule?.trim()) {
    return rrulestr(input.rrule.trim()).between(input.rangeStart, input.rangeEnd, true);
  }
  if (input.repeatType === 'once') {
    return isInsideRange(input.firstRunAt, input.rangeStart, input.rangeEnd)
      ? [input.firstRunAt]
      : [];
  }

  const dates: Date[] = [];
  let current = new Date(input.firstRunAt);
  let remaining = 20_000;
  while (current.getTime() < input.rangeEnd.getTime() && remaining > 0) {
    if (current.getTime() >= input.rangeStart.getTime()) dates.push(new Date(current));
    current = advanceOccurrence(current, input.repeatType);
    remaining -= 1;
  }
  if (remaining === 0) throw new Error('重复规则产生的日历实例过多');
  return dates;
}

function advanceOccurrence(date: Date, repeatType: Exclude<PlannedRepeatType, 'once'>): Date {
  const next = new Date(date);
  if (repeatType === 'daily' || repeatType === 'custom') {
    next.setUTCDate(next.getUTCDate() + 1);
  } else if (repeatType === 'weekly') {
    next.setUTCDate(next.getUTCDate() + 7);
  } else {
    next.setUTCMonth(next.getUTCMonth() + 1);
  }
  return next;
}

function isInsideRange(date: Date, start: Date, end: Date): boolean {
  return date.getTime() >= start.getTime() && date.getTime() < end.getTime();
}

function toOccurrence(
  plannedTaskId: string,
  originalScheduledFor: Date,
  scheduledFor: Date,
  changed: boolean,
): PlannedOccurrence {
  return {
    occurrenceId: `${plannedTaskId}:${originalScheduledFor.toISOString()}`,
    plannedTaskId,
    originalScheduledFor,
    scheduledFor,
    changed,
  };
}
