// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
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

describe('PlannedTasksPage choice semantics', () => {
  it('announces every selected view, task, repeat, weekday, and ending choice', async () => {
    renderPage('/planned');

    const month = await screen.findByRole('button', { name: '月历' });
    const agenda = screen.getByRole('button', { name: '日程' });
    expect(month.getAttribute('aria-pressed')).toBe('true');
    expect(agenda.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(await screen.findByRole('button', { name: '新建规划' }));

    const single = screen.getByRole('button', { name: '单个任务' });
    const multiple = screen.getByRole('button', { name: '多个任务' });
    const once = screen.getByRole('button', { name: '不重复' });
    const daily = screen.getByRole('button', { name: '每天' });
    const custom = screen.getByRole('button', { name: '指定星期' });

    expect(single.getAttribute('aria-pressed')).toBe('true');
    expect(multiple.getAttribute('aria-pressed')).toBe('false');
    expect(once.getAttribute('aria-pressed')).toBe('true');
    expect(daily.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(multiple);
    fireEvent.click(daily);

    expect(single.getAttribute('aria-pressed')).toBe('false');
    expect(multiple.getAttribute('aria-pressed')).toBe('true');
    expect(once.getAttribute('aria-pressed')).toBe('false');
    expect(daily.getAttribute('aria-pressed')).toBe('true');

    const neverEnds = screen.getByRole('button', { name: '永不结束' });
    const endDate = screen.getByRole('button', { name: '结束日期' });
    expect(neverEnds.getAttribute('aria-pressed')).toBe('true');
    expect(endDate.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(endDate);
    expect(neverEnds.getAttribute('aria-pressed')).toBe('false');
    expect(endDate.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(custom);
    const monday = screen.getByRole('button', { name: '一' });
    expect(monday.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(monday);
    expect(monday.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('PlannedTasksPage mobile editor', () => {
  it('opens as a modal sheet, moves focus inside, and restores focus on Escape', async () => {
    vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
      matches: query === '(max-width: 820px)',
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    renderPage('/planned');

    const trigger = (await screen.findAllByRole('button', { name: '新建规划' }))[0];
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = await screen.findByRole('dialog', { name: '新建规划' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('任务说明')));

    fireEvent.keyDown(document.activeElement ?? dialog, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog', { name: '新建规划' })).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it('keeps the unsaved-changes confirmation accessible above the modal sheet', async () => {
    const user = userEvent.setup();
    vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
      matches: query === '(max-width: 820px)',
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    renderPage('/planned');

    fireEvent.click((await screen.findAllByRole('button', { name: '新建规划' }))[0]);
    const instruction = await screen.findByLabelText('任务说明');
    fireEvent.change(instruction, { target: { value: '整理本周行业变化' } });
    fireEvent.keyDown(instruction, { key: 'Escape' });

    const discardDialog = await screen.findByRole('dialog', { name: '放弃未保存的更改？' });
    const keepEditing = screen.getByRole('button', { name: '继续编辑' });
    const discard = screen.getByRole('button', { name: '放弃更改' });
    expect(discardDialog).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: '新建规划' })).toBeNull();
    expect(document.activeElement).toBe(keepEditing);

    await user.tab();
    expect(document.activeElement).toBe(discard);
    await user.tab();
    expect(document.activeElement).toBe(keepEditing);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(discard);

    await user.click(keepEditing);
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '放弃未保存的更改？' })).toBeNull(),
    );
    expect(screen.getByRole('dialog', { name: '新建规划' })).toBeTruthy();
    expect(document.activeElement).toBe(instruction);
  });
});
