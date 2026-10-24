// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ latest: vi.fn(), run: vi.fn() }));
vi.mock('@/lib/trpc', () => ({
  trpc: { selfCheck: { latest: { query: api.latest }, run: { mutate: api.run } } },
}));
import { AdminSelfCheckPage } from './AdminSelfCheckPage';

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const RESULT = {
  cached: false,
  cachedAt: '2026-10-04T08:00:00.000Z',
  report: {
    startedAt: '',
    finishedAt: '',
    brainId: 'qwen',
    region: 'intl',
    summary: { ok: 1, warn: 0, fail: 1 },
    items: [
      {
        id: 'model.generate',
        group: 'model',
        label: '生成通道（千问） · qwen3.8-max',
        status: 'fail',
        reason: '免费额度已用完，账号处于"仅使用免费额度"模式（403 FreeTierOnly）',
        advice: '在百炼控制台完成实名 / 手机验证',
        httpStatus: 403,
        errorCode: 'AllocationQuota.FreeTierOnly',
      },
      {
        id: 'infra.mysql',
        group: 'infra',
        label: 'MySQL 数据库',
        status: 'ok',
        reason: '可连接（3 ms）',
      },
    ],
  },
};

it('runs on click and shows status, error code, reason and advice per group', async () => {
  api.latest.mockResolvedValue(null);
  api.run.mockResolvedValue(RESULT);
  render(<AdminSelfCheckPage />);
  fireEvent.click(screen.getByRole('button', { name: '开始自检' }));
  const models = await screen.findByRole('region', { name: '模型通道' });
  expect(within(models).getByText(/免费额度已用完/)).toBeTruthy();
  expect(within(models).getByText('403 · AllocationQuota.FreeTierOnly')).toBeTruthy();
  expect(within(models).getByText(/建议：在百炼控制台/)).toBeTruthy();
  expect(
    within(screen.getByRole('region', { name: '基础设施' })).getByText('可连接（3 ms）'),
  ).toBeTruthy();
  expect(api.run).toHaveBeenCalledWith({});
});

it('shows the cached result on load and forces a fresh run on 重新检查', async () => {
  api.latest.mockResolvedValue({ ...RESULT, cached: true });
  api.run.mockResolvedValue(RESULT);
  render(<AdminSelfCheckPage />);
  expect(await screen.findByText(/缓存结果/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '重新检查' }));
  expect(api.run).toHaveBeenCalledWith({ force: true });
});
