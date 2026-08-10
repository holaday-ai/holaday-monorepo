import type { PlannedRepeatType } from './planned-task-rules.js';

interface CalendarParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

interface ResolvePlannedEndsAtInput {
  repeatType: PlannedRepeatType;
  endsOn: string | null | undefined;
  existingEndsAt?: Date | null;
  existingTimezone?: string;
  timezone: string;
  firstEligibleRunAt: Date;
}

export function assertPlannedEndsOnScope(
  editScope: 'occurrence' | 'future' | 'series',
  endsOn: string | null | undefined,
): void {
  if (editScope === 'occurrence' && endsOn !== undefined) {
    throw new Error('单次日程不能修改系列结束日期');
  }
}

function formatterFor(timezone: string, includeTime: boolean): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      ...(includeTime
        ? {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hourCycle: 'h23',
          }
        : {}),
    });
  } catch {
    throw new Error('时区无效');
  }
}

function readParts(formatter: Intl.DateTimeFormat, date: Date): CalendarParts {
  const values = new Map(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: values.get('year') ?? 0,
    month: values.get('month') ?? 0,
    day: values.get('day') ?? 0,
    hour: values.get('hour') ?? 0,
    minute: values.get('minute') ?? 0,
    second: values.get('second') ?? 0,
  };
}

function parseDateOnly(value: string): Pick<CalendarParts, 'year' | 'month' | 'day'> {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error('结束日期无效');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    throw new Error('结束日期无效');
  }
  return { year, month, day };
}

function nextCalendarDay(value: Pick<CalendarParts, 'year' | 'month' | 'day'>) {
  const next = new Date(Date.UTC(value.year, value.month - 1, value.day + 1));
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
}

function localMidnightToUtc(
  value: Pick<CalendarParts, 'year' | 'month' | 'day'>,
  timezone: string,
): Date {
  const formatter = formatterFor(timezone, true);
  const targetEpoch = Date.UTC(value.year, value.month - 1, value.day);
  let instant = targetEpoch;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const observed = readParts(formatter, new Date(instant));
    const observedEpoch = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
      observed.second,
    );
    const adjustment = targetEpoch - observedEpoch;
    if (adjustment === 0) break;
    instant += adjustment;
  }
  const result = new Date(instant);
  const final = readParts(formatter, result);
  if (
    final.year !== value.year ||
    final.month !== value.month ||
    final.day !== value.day ||
    final.hour !== 0 ||
    final.minute !== 0 ||
    final.second !== 0
  ) {
    throw new Error('结束日期在所选时区中无效');
  }
  return result;
}

export function endDateToExclusiveUtc(endsOn: string, timezone: string): Date {
  const selectedDay = parseDateOnly(endsOn);
  return localMidnightToUtc(nextCalendarDay(selectedDay), timezone);
}

export function exclusiveUtcToEndDate(endsAt: Date, timezone: string): string {
  if (Number.isNaN(endsAt.getTime())) throw new Error('结束日期无效');
  const formatter = formatterFor(timezone, false);
  const parts = readParts(formatter, new Date(endsAt.getTime() - 1));
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

export function resolvePlannedEndsAt(input: ResolvePlannedEndsAtInput): Date | null {
  formatterFor(input.timezone, false);
  if (input.repeatType === 'once') return null;

  let resolved: Date | null;
  if (input.endsOn === null) {
    resolved = null;
  } else if (input.endsOn !== undefined) {
    resolved = endDateToExclusiveUtc(input.endsOn, input.timezone);
  } else if (!input.existingEndsAt) {
    resolved = null;
  } else if (!input.existingTimezone || input.existingTimezone === input.timezone) {
    resolved = new Date(input.existingEndsAt);
  } else {
    resolved = endDateToExclusiveUtc(
      exclusiveUtcToEndDate(input.existingEndsAt, input.existingTimezone),
      input.timezone,
    );
  }

  if (resolved && input.firstEligibleRunAt.getTime() >= resolved.getTime()) {
    throw new Error('结束日期早于下一次执行');
  }
  return resolved;
}
