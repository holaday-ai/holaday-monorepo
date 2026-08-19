// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { PlannedTasksPage } from './PlannedTasksPage';

const api = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
  runs: vi.fn(),
  reportLoadMetric: vi.fn(),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    plannedTasks: {
      list: { query: api.list },
      detail: { query: api.detail },
      runs: { query: api.runs },
      reportLoadMetric: { mutate: api.reportLoadMetric },
      calendar: { query: vi.fn(async () => []) },
      create: { mutate: vi.fn() },
      update: { mutate: vi.fn() },
      toggle: { mutate: vi.fn() },
      runNow: { mutate: vi.fn() },
      removeOccurrence: { mutate: vi.fn() },
      rescheduleOccurrence: { mutate: vi.fn() },
    },
    scheduledTasks: { list: { query: vi.fn(async () => []) } },
  },
}));

vi.mock('@fullcalendar/react', async () => {
  const React = await import('react');
  const Calendar = React.forwardRef(function CalendarMock(_props, ref) {
    React.useImperativeHandle(ref, () => ({
      getApi: () => ({ changeView: vi.fn(), next: vi.fn(), prev: vi.fn(), today: vi.fn() }),
    }));
    return <div aria-label="测试日历" />;
  });
  return { default: Calendar };
});

const OWNED_PLAN = {
  plannedTaskId: 'pln_owned',
  title: '监控多伦科技风险变化',
  instruction: '系统专用：检查多伦科技（603528）风险变化',
  notes: null,
  scope: 'single',
  items: ['检查风险变化'],
  itemCount: 1,
  repeatType: 'daily',
  rrule: null,
  firstRunAt: '2026-08-20T08:30:00.000Z',
  endsAt: null,
  endsOn: null,
  nextRunAt: '2026-08-20T08:30:00.000Z',
  timezone: 'Asia/Shanghai',
  reminderMinutes: null,
  status: 'active',
  lastRunAt: null,
  lastRunStatus: null,
  lastError: null,
  createdAt: '2026-08-19T08:00:00.000Z',
  updatedAt: '2026-08-19T08:00:00.000Z',
};

beforeEach(() => {
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: { getItem: vi.fn(() => null), setItem: vi.fn() },
  });
  api.list.mockReset().mockResolvedValue([OWNED_PLAN]);
  api.detail.mockReset().mockResolvedValue(OWNED_PLAN);
  api.runs.mockReset().mockResolvedValue([]);
  api.reportLoadMetric.mockReset().mockResolvedValue(undefined);
});

afterEach(cleanup);

function renderPage(url: string): void {
  render(
    <MemoryRouter initialEntries={[url]}>
      <PlannedTasksPage />
    </MemoryRouter>,
  );
}

describe('PlannedTasksPage plan deep link', () => {
  it('opens a plan only after it matches the current user plan list', async () => {
    renderPage('/planned?plan=pln_owned');

    expect(await screen.findByLabelText('编辑规划')).toBeTruthy();
    expect(screen.getByDisplayValue('监控多伦科技风险变化')).toBeTruthy();
    expect(api.detail).toHaveBeenCalledTimes(1);
    expect(api.detail).toHaveBeenCalledWith({ plannedTaskId: 'pln_owned' });
  });

  it('silently ignores a plan id absent from the current user plan list', async () => {
    renderPage('/planned?plan=pln_foreign');

    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(1));
    await screen.findByText('1 个已启用');
    expect(api.detail).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('编辑规划')).toBeNull();
  });
});
