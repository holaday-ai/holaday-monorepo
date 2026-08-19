import { describe, expect, it } from 'vitest';
import {
  buildCustomWeeklyRRule,
  buildPlannedLoadMetric,
  calendarEventFromOccurrence,
  defaultPlannedCalendarView,
  friendlyLegacyTaskTitle,
  legacyScheduledEvent,
  nextPlannedEndState,
  plannedCalendarEmptyState,
  plannedEndsOnPayload,
  ownedPlannedTaskQueryTarget,
  plannedRepeatLabel,
  plannedRefreshTargets,
  plannedStatusGroup,
  stablePlannedCalendarRange,
  stockRiskRunSummary,
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
      legacyLabel: '旧任务',
      scheduledTaskInternalId: 42,
      repeatType: 'daily',
    });
  });

  it('replaces legacy system markers with user-facing titles', () => {
    expect(
      friendlyLegacyTaskTitle(
        '__ashare_premarket_briefing__',
        '__ashare_premarket_briefing__',
      ),
    ).toBe('A股盘前简报');
    expect(
      friendlyLegacyTaskTitle(
        '__ashare_postmarket_briefing__',
        '__ashare_postmarket_briefing__',
      ),
    ).toBe('A股盘后复盘');
    expect(friendlyLegacyTaskTitle('__internal_job__', 'sch_1')).toBe('旧定时任务');
    expect(friendlyLegacyTaskTitle('生成每日销售摘要', 'sch_2')).toBe(
      '生成每日销售摘要',
    );
  });

  it('uses friendly titles when mapping legacy calendar events', () => {
    const event = legacyScheduledEvent({
      scheduledTaskId: '__ashare_premarket_briefing__',
      intent: '__ashare_premarket_briefing__',
      repeatType: 'daily',
      timezone: 'Asia/Shanghai',
      nextRunAt: '2026-08-11T01:00:00.000Z',
      status: 'active',
      lastRunStatus: null,
    });

    expect(event.title).toBe('A股盘前简报');
  });

  it('distinguishes a fully empty month from a legacy-only month', () => {
    expect(
      plannedCalendarEmptyState({
        loading: false,
        plannedCount: 0,
        legacyCount: 0,
      }),
    ).toEqual({
      title: '这个月还没有规划',
      description: '点击日期或新建规划，安排未来要做的任务。',
    });
    expect(
      plannedCalendarEmptyState({
        loading: false,
        plannedCount: 0,
        legacyCount: 2,
      }),
    ).toEqual({
      title: '这个月还没有规划任务',
      description: '日历中的灰色项目是旧任务，可前往旧任务记录管理。',
    });
    expect(
      plannedCalendarEmptyState({
        loading: true,
        plannedCount: 0,
        legacyCount: 0,
      }),
    ).toBeNull();
    expect(
      plannedCalendarEmptyState({
        loading: false,
        plannedCount: 1,
        legacyCount: 0,
      }),
    ).toBeNull();
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

  it('only accepts deep links for an exactly matched owned plan', () => {
    const plans = [{ plannedTaskId: 'pln_owned' }, { plannedTaskId: 'pln_other' }];

    expect(ownedPlannedTaskQueryTarget('pln_owned', plans)).toBe('pln_owned');
    expect(ownedPlannedTaskQueryTarget('pln_foreign', plans)).toBeNull();
    expect(ownedPlannedTaskQueryTarget(' pln_owned ', plans)).toBeNull();
    expect(ownedPlannedTaskQueryTarget('', plans)).toBeNull();
    expect(ownedPlannedTaskQueryTarget(null, plans)).toBeNull();
  });

  it('turns a versioned stock risk result into a bounded run summary', () => {
    expect(
      stockRiskRunSummary({
        kind: 'stock-risk-monitor',
        version: 1,
        outcome: 'changed',
        dataAsOf: '2026-08-19',
        summary: '新增成交量异常，估值风险已缓解。',
        added: [{ key: 'volume' }],
        upgraded: [{ key: 'price' }],
        resolved: [{ key: 'valuation' }],
        unavailableChecks: ['news'],
      }),
    ).toEqual({
      outcome: 'changed',
      outcomeLabel: '风险发生变化',
      dataAsOf: '2026-08-19',
      summary: '新增成交量异常，估值风险已缓解。',
      changeCount: 3,
      unavailableCount: 1,
    });
  });

  it('falls back for malformed or unknown risk result payloads', () => {
    expect(stockRiskRunSummary(null)).toBeNull();
    expect(stockRiskRunSummary({ kind: 'stock-risk-monitor', version: 2 })).toBeNull();
    expect(
      stockRiskRunSummary({
        kind: 'stock-risk-monitor',
        version: 1,
        outcome: 'changed',
        summary: 42,
      }),
    ).toBeNull();
  });
});

describe('planned task initial-load metric', () => {
  it('rounds bounded timings and marks loads above the budget as slow', () => {
    expect(
      buildPlannedLoadMetric({
        view: 'dayGridMonth',
        plansMs: 410.4,
        calendarMs: 2510.6,
        totalMs: 2700.2,
        plannedCount: 3.8,
        legacyCount: -2,
      }),
    ).toEqual({
      view: 'dayGridMonth',
      plansMs: 410,
      calendarMs: 2511,
      totalMs: 2700,
      plannedCount: 3,
      legacyCount: 0,
      slow: true,
    });
  });

  it('rejects non-finite timings before telemetry is sent', () => {
    expect(() =>
      buildPlannedLoadMetric({
        view: 'listMonth',
        plansMs: Number.NaN,
        calendarMs: 100,
        totalMs: 120,
        plannedCount: 0,
        legacyCount: 0,
      }),
    ).toThrow('加载耗时无效');
  });

  it('does not refetch the plan list when only the visible range changes', () => {
    expect(plannedRefreshTargets('mount')).toEqual({
      plans: true,
      calendar: false,
    });
    expect(plannedRefreshTargets('range')).toEqual({
      plans: false,
      calendar: true,
    });
    expect(plannedRefreshTargets('mutation')).toEqual({
      plans: true,
      calendar: true,
    });
  });
});
