// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ summary: vi.fn(), costBreakdown: vi.fn(), costByDay: vi.fn(), topCostlyTasks: vi.fn() }));
vi.mock('@/lib/trpc', () => ({ trpc: { admin: { finance: {
  summary: { query: api.summary }, costBreakdown: { query: api.costBreakdown },
  costByDay: { query: api.costByDay }, topCostlyTasks: { query: api.topCostlyTasks },
  revenueByPlan: { query: () => new Promise(() => {}) },
  revenueByMonth: { query: () => new Promise(() => {}) },
  conversionFunnel: { query: () => new Promise(() => {}) },
} } } }));
import { AdminFinancePage } from './AdminFinancePage';
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it('incomplete costs do not render zero profit, average cost, or an unpriced task as free', async () => {
  api.summary.mockResolvedValue({ monthRevenueCnyCents: 10000, monthCostCnyCents: null,
    monthLlmCostCnyCents: null, monthKnownLlmCostCnyCents: 720,
    monthServerCostCnyCents: 38640, monthProfitCnyCents: null, unknownCostCalls: 1 });
  api.costBreakdown.mockResolvedValue({ models: [{ model: 'qwen-test', provider: 'alibaba-model-studio',
    costCnyCents: null, knownCostCnyCents: 0, unknownCostCalls: 1, callCount: 1, totalTokens: null, incompleteUsageCalls: 1 }] });
  api.costByDay.mockResolvedValue({ series: [{ date: '2026-09-15', costCnyCents: null, unknownCostCalls: 1 }] });
  api.topCostlyTasks.mockResolvedValue({ tasks: [{ taskId: 'tsk_test', title: '千问浏览任务',
    costCnyCents: null, knownCostCnyCents: 123, unknownCostCalls: 1, callCount: 2, totalTokens: null, incompleteUsageCalls: 1 }] });
  render(<AdminFinancePage />);
  expect(await screen.findByText('利润待核算')).toBeTruthy();
  expect(screen.queryByText('¥0.00')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '成本明细' }));
  const row = await screen.findByRole('row', { name: /千问浏览任务/ });
  expect(within(row).getByText('待核算')).toBeTruthy();
  expect(within(row).getByText('已知 ¥1.23 · 1 次待核算')).toBeTruthy();
  expect(within(row).queryByText('¥0.00')).toBeNull();
  expect(screen.getByText(/1 次调用费用待核算/)).toBeTruthy();
  expect(screen.getByText('单次调用均价').parentElement?.textContent).toContain('待核算');
});
