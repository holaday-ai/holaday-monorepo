import { describe, expect, it } from 'vitest';
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
} from './planned-task-state';

describe('planned task presentation state', () => {
  it('uses a month calendar on desktop and an agenda on mobile', () => {
    expect(defaultPlannedCalendarView(false, null)).toBe('dayGridMonth');
    expect(defaultPlannedCalendarView(true, null)).toBe('listMonth');
    expect(defaultPlannedCalendarView(false, 'listMonth')).toBe('listMonth');
  });

  it('keeps plan state separate from the latest run state', () => {
    expect(plannedStatusGroup({ status: 'active', lastRunStatus: 'failed' })).toEqual({
      group: 'attention',
      label: '上次执行失败',
    });
    expect(plannedStatusGroup({ status: 'paused', lastRunStatus: 'completed' })).toEqual({
      group: 'paused',
      label: '已暂停',
    });
  });

  it('renders a multi-item plan as one calendar event with a count badge', () => {
    expect(
      calendarEventFromOccurrence({
        occurrenceId: 'pln_a:2026-08-10T09:00:00.000Z',
        plannedTaskId: 'pln_a',
        title: '每日竞品检查',
        scheduledFor: '2026-08-10T09:00:00.000Z',
        originalScheduledFor: '2026-08-10T09:00:00.000Z',
        changed: false,
        status: 'active',
        repeatType: 'daily',
        itemCount: 8,
        timezone: 'Asia/Shanghai',
      }),
    ).toMatchObject({
      id: 'pln_a:2026-08-10T09:00:00.000Z',
      title: '每日竞品检查',
      start: '2026-08-10T09:00:00.000Z',
      extendedProps: { plannedTaskId: 'pln_a', itemCount: 8 },
    });
  });

  it('keeps an old scheduled task visible without making it draggable', () => {
    const event = legacyScheduledEvent({
      scheduledTaskInternalId: 42,
      scheduledTaskId: 'sch_legacy',
      intent: '生成每日销售摘要',
      repeatType: 'daily',
      timezone: 'Asia/Shanghai',
      nextRunAt: '2026-08-11T01:00:00.000Z',
      status: 'active',
      lastRunStatus: null,
    });

    expect(event.id).toBe('legacy:sch_legacy');
    expect(event.title).toBe('生成每日销售摘要');
    expect(event.editable).toBe(false);
    expect(event.extendedProps).toMatchObject({
      legacy: true,
      scheduledTaskInternalId: 42,
      repeatType: 'daily',
    });
  });

  it('builds a readable weekly rule without exposing raw RRULE input', () => {
    expect(buildCustomWeeklyRRule(['MO', 'WE', 'FR'])).toBe('RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR');
    expect(buildCustomWeeklyRRule([])).toBeNull();
  });

  it('uses direct repeat labels and non-blocking workload guidance', () => {
    expect(plannedRepeatLabel('weekly')).toBe('每周');
    expect(workloadHint(1)).toContain('1 个任务');
    expect(workloadHint(18)).toContain('分批启动');
  });

  it('clears an ending only when switching to a one-time plan', () => {
    expect(nextPlannedEndState('once', '2026-08-31')).toBeNull();
    expect(nextPlannedEndState('weekly', '2026-08-31')).toBe('2026-08-31');
  });

  it('omits the series ending from occurrence-only updates', () => {
    expect(plannedEndsOnPayload('occurrence', '2026-08-31')).toEqual({});
    expect(plannedEndsOnPayload('future', null)).toEqual({ endsOn: null });
    expect(plannedEndsOnPayload('series', '2026-08-31')).toEqual({
      endsOn: '2026-08-31',
    });
  });

  it('preserves the visible calendar range when FullCalendar reports the same dates again', () => {
    const current = {
      start: new Date('2026-08-01T00:00:00.000Z'),
      end: new Date('2026-09-01T00:00:00.000Z'),
    };
    const repeated = {
      start: new Date('2026-08-01T00:00:00.000Z'),
      end: new Date('2026-09-01T00:00:00.000Z'),
    };

    expect(stablePlannedCalendarRange(current, repeated)).toBe(current);

    const changed = { ...repeated, end: new Date('2026-10-01T00:00:00.000Z') };
    expect(stablePlannedCalendarRange(current, changed)).toBe(changed);
  });
});
