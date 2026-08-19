// @vitest-environment happy-dom

import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  StockPreferenceProfile,
  type StockPreferenceProfileApi,
  type StockPreferenceProfileResult,
} from './StockPreferenceProfile';

afterEach(cleanup);

function profile(
  overrides: Partial<StockPreferenceProfileResult> = {},
): StockPreferenceProfileResult {
  return {
    state: 'ready',
    enabled: true,
    confidence: {
      level: 'medium',
      label: '中置信度',
      score: 60,
      basis: '共有 6 个证据权重，仍需更多重复行为确认。',
    },
    window: { days: 90, from: '2026-05-20', to: '2026-08-18' },
    sample: { screeningRuns: 2, watchlistStocks: 1, manualDimensions: 1 },
    facts: [
      {
        id: 'screening-valuation',
        dimension: 'valuation',
        source: 'screening',
        title: '筛选时持续关注估值',
        detail: '最近 2 次成功筛选都使用了估值条件。',
      },
    ],
    possibleStrengths: [
      {
        id: 'strength-evidence',
        title: '有明确的条件意识',
        detail: '会先确认可核验条件，再查看符合与不符合项。',
      },
    ],
    blindSpots: [
      {
        id: 'blind-coverage',
        title: '研究维度仍较集中',
        detail: '目前主要证据集中在估值维度。',
      },
    ],
    supplementaryViews: [
      {
        id: 'supplement-cash-flow',
        title: '补看现金流',
        detail: '可以把经营现金流作为补充核对维度。',
      },
    ],
    basis: [
      {
        id: 'basis-screening',
        source: 'screening',
        title: '成功条件筛选',
        detail: '近 90 天',
        count: 2,
      },
      {
        id: 'basis-watchlist',
        source: 'watchlist',
        title: '当前关注列表',
        detail: '清空后新增',
        count: 1,
      },
    ],
    manualPreferences: {
      industries: [],
      marketCaps: [],
      valuation: ['低估值'],
      profitability: [],
      growth: [],
      cashFlow: [],
      volatility: [],
      liquidity: [],
      events: [],
      holdingPeriods: [],
    },
    ...overrides,
  };
}

function apiFor(initial: StockPreferenceProfileResult = profile()): StockPreferenceProfileApi {
  return {
    load: vi.fn(async () => initial),
    update: vi.fn(async (input) =>
      profile({
        enabled: input.enabled,
        state: input.enabled ? 'ready' : 'disabled',
        manualPreferences: input.manualPreferences,
      }),
    ),
    clear: vi.fn(async () =>
      profile({
        state: 'empty',
        confidence: {
          level: 'insufficient',
          label: '样本不足',
          score: 0,
          basis: '尚无清空后的明确设置或行为样本。',
        },
        sample: { screeningRuns: 0, watchlistStocks: 0, manualDimensions: 0 },
        facts: [],
        possibleStrengths: [],
        blindSpots: [],
        supplementaryViews: [],
        basis: [],
      }),
    ),
  };
}

describe('StockPreferenceProfile', () => {
  it('loads an explainable ready profile with window, samples, and bounded observations', async () => {
    const api = apiFor();
    render(<StockPreferenceProfile api={api} />);

    expect(screen.getByText('正在整理你的明确偏好…')).toBeTruthy();
    expect(await screen.findByRole('heading', { name: '你的选股偏好' })).toBeTruthy();
    expect(screen.getByText('中置信度')).toBeTruthy();
    expect(screen.getAllByText('近 90 天')).toHaveLength(2);
    expect(screen.getByText('2 次筛选')).toBeTruthy();
    expect(screen.getByText('1 只关注')).toBeTruthy();
    expect(screen.getByText('1 项主动设置')).toBeTruthy();
    expect(screen.getByText('偏好事实')).toBeTruthy();
    expect(screen.getByText('筛选时持续关注估值')).toBeTruthy();
    expect(screen.getByText('可能优势')).toBeTruthy();
    expect(screen.getByText('潜在盲点')).toBeTruthy();
    expect(screen.getByText('补充视角')).toBeTruthy();
    expect(screen.getByText('依据与控制')).toBeTruthy();
    expect(screen.getByText(/画像不会改变筛选条件，也不会触发交易/)).toBeTruthy();
    expect(screen.queryByText(/适合|买入|卖出|收益目标/)).toBeNull();

    const refresh = screen.getByRole('button', { name: '刷新选股偏好' });
    expect(refresh.getAttribute('title')).toBe('刷新选股偏好');
  });

  it('keeps profile controls on their own non-wrapping row with mobile-safe targets', async () => {
    const api = apiFor();
    render(<StockPreferenceProfile api={api} />);

    const heading = await screen.findByRole('heading', { name: '你的选股偏好' });
    const header = heading.closest('header');
    if (!header) throw new Error('expected the profile heading inside a header');
    expect(header.className).not.toContain('sm:flex-row');

    const refresh = screen.getByRole('button', { name: '刷新选股偏好' });
    const pause = screen.getByRole('button', { name: '暂停画像' });
    const edit = screen.getByRole('button', { name: '调整画像' });
    for (const control of [refresh, pause, edit]) {
      expect(control.className).toContain('h-11');
      expect(control.className).toContain('sm:h-9');
    }
    expect(edit.className).toContain('whitespace-nowrap');
  });

  it('keeps the compact profile bounded while exposing the complete profile', async () => {
    const richProfile = profile({
      facts: [
        {
          id: 'fact-1',
          dimension: 'valuation',
          source: 'screening',
          title: '事实 1',
          detail: '事实详情 1',
        },
        {
          id: 'fact-2',
          dimension: 'industry',
          source: 'screening',
          title: '事实 2',
          detail: '事实详情 2',
        },
        {
          id: 'fact-3',
          dimension: 'growth',
          source: 'manual',
          title: '事实 3',
          detail: '事实详情 3',
        },
        {
          id: 'fact-4',
          dimension: 'cashFlow',
          source: 'manual',
          title: '事实 4',
          detail: '事实详情 4',
        },
      ],
      possibleStrengths: [
        { id: 'strength-1', title: '优势 1', detail: '优势详情 1' },
        { id: 'strength-2', title: '优势 2', detail: '优势详情 2' },
      ],
      blindSpots: [
        { id: 'blind-1', title: '盲点 1', detail: '盲点详情 1' },
        { id: 'blind-2', title: '盲点 2', detail: '盲点详情 2' },
      ],
      supplementaryViews: [
        { id: 'supplement-1', title: '补充 1', detail: '补充详情 1' },
        { id: 'supplement-2', title: '补充 2', detail: '补充详情 2' },
      ],
    });

    render(<StockPreferenceProfile api={apiFor(richProfile)} presentation="compact" />);

    expect(await screen.findByText('事实 1')).toBeTruthy();
    expect(screen.getByText('事实 3')).toBeTruthy();
    expect(screen.queryByText('事实 4')).toBeNull();
    expect(screen.getByText('优势 1')).toBeTruthy();
    expect(screen.queryByText('优势 2')).toBeNull();
    expect(screen.getByText('盲点 1')).toBeTruthy();
    expect(screen.queryByText('盲点 2')).toBeNull();
    expect(screen.getByText('补充 1')).toBeTruthy();
    expect(screen.queryByText('补充 2')).toBeNull();
    expect(screen.queryByText('依据与控制')).toBeNull();
    const completeProfileTrigger = screen.getByRole('button', { name: '查看完整画像' });
    await userEvent.click(completeProfileTrigger);
    const completeProfile = await screen.findByRole('dialog', { name: '完整选股画像' });
    expect(within(completeProfile).getByText('事实 4')).toBeTruthy();
    expect(within(completeProfile).getByText('优势 2')).toBeTruthy();
    expect(within(completeProfile).getByText('盲点 2')).toBeTruthy();
    expect(within(completeProfile).getByText('补充 2')).toBeTruthy();
    expect(within(completeProfile).getByText('依据与控制')).toBeTruthy();

    await userEvent.click(within(completeProfile).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '完整选股画像' })).toBeNull());
    expect(document.activeElement).toBe(completeProfileTrigger);
  });

  it('shows truthful empty, disabled, and retryable error states', async () => {
    const empty = profile({
      state: 'empty',
      confidence: {
        level: 'insufficient',
        label: '样本不足',
        score: 0,
        basis: '尚无清空后的明确设置或行为样本。',
      },
      sample: { screeningRuns: 0, watchlistStocks: 0, manualDimensions: 0 },
      facts: [],
      possibleStrengths: [],
      blindSpots: [],
      supplementaryViews: [],
      basis: [],
    });
    const emptyView = render(<StockPreferenceProfile api={apiFor(empty)} />);
    expect(await screen.findByText('样本还不够形成画像')).toBeTruthy();
    expect(screen.getByRole('button', { name: '主动设置偏好' })).toBeTruthy();
    emptyView.unmount();

    render(<StockPreferenceProfile api={apiFor(profile({ state: 'disabled', enabled: false }))} />);
    expect(await screen.findByText('选股偏好已暂停')).toBeTruthy();
    expect(screen.getByRole('button', { name: '重新开启' })).toBeTruthy();
    cleanup();

    const errorApi = apiFor();
    vi.mocked(errorApi.load).mockRejectedValueOnce(new Error('network'));
    render(<StockPreferenceProfile api={errorApi} />);
    expect(await screen.findByText('选股偏好暂时无法加载')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText('筛选时持续关注估值')).toBeTruthy();
    expect(errorApi.load).toHaveBeenCalledTimes(2);
  });

  it('edits bounded preferences and can disable then re-enable the profile', async () => {
    const api = apiFor();
    const user = userEvent.setup();
    render(<StockPreferenceProfile api={api} />);
    await screen.findByText('筛选时持续关注估值');

    await user.click(screen.getByRole('button', { name: '调整画像' }));
    const dialog = screen.getByRole('dialog', { name: '调整选股偏好' });
    expect(within(dialog).getByText('这些设置只用于解释画像，不会自动改写筛选条件。')).toBeTruthy();
    await user.click(within(dialog).getByRole('checkbox', { name: '半导体' }));
    await user.click(within(dialog).getByRole('checkbox', { name: '经营现金流优先' }));
    await user.click(within(dialog).getByRole('button', { name: '保存偏好' }));

    await waitFor(() =>
      expect(api.update).toHaveBeenCalledWith(
        expect.objectContaining({
          enabled: true,
          manualPreferences: expect.objectContaining({
            industries: ['半导体'],
            valuation: ['低估值'],
            cashFlow: ['经营现金流优先'],
          }),
        }),
      ),
    );

    await user.click(screen.getByRole('button', { name: '暂停画像' }));
    await waitFor(() =>
      expect(api.update).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false })),
    );
    expect(await screen.findByText('选股偏好已暂停')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '重新开启' }));
    await waitFor(() =>
      expect(api.update).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: true })),
    );
  });

  it('returns focus to the adjust-profile trigger after cancelling the editor', async () => {
    const user = userEvent.setup();
    render(<StockPreferenceProfile api={apiFor()} />);
    await screen.findByText('筛选时持续关注估值');

    const trigger = screen.getByRole('button', { name: '调整画像' });
    await user.click(trigger);
    const dialog = screen.getByRole('dialog', { name: '调整选股偏好' });
    expect(document.activeElement).toBe(within(dialog).getByRole('checkbox', { name: '半导体' }));

    await user.click(within(dialog).getByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '调整选股偏好' })).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it('returns focus to the persistent trigger when saving replaces the empty-state trigger', async () => {
    const empty = profile({
      state: 'empty',
      confidence: {
        level: 'insufficient',
        label: '样本不足',
        score: 0,
        basis: '尚无清空后的明确设置或行为样本。',
      },
      sample: { screeningRuns: 0, watchlistStocks: 0, manualDimensions: 0 },
      facts: [],
      possibleStrengths: [],
      blindSpots: [],
      supplementaryViews: [],
      basis: [],
    });
    const user = userEvent.setup();
    render(<StockPreferenceProfile api={apiFor(empty)} />);
    await screen.findByText('样本还不够形成画像');

    const persistentTrigger = screen.getByRole('button', { name: '调整画像' });
    await user.click(screen.getByRole('button', { name: '主动设置偏好' }));
    const dialog = screen.getByRole('dialog', { name: '调整选股偏好' });
    await user.click(within(dialog).getByRole('button', { name: '保存偏好' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: '调整选股偏好' })).toBeNull());
    expect(document.activeElement).toBe(persistentTrigger);
  });

  it('requires a second action before clearing and states that the watchlist remains', async () => {
    const api = apiFor();
    const user = userEvent.setup();
    render(<StockPreferenceProfile api={api} />);
    await screen.findByText('筛选时持续关注估值');

    await user.click(screen.getByRole('button', { name: '调整画像' }));
    const dialog = screen.getByRole('dialog', { name: '调整选股偏好' });
    await user.click(within(dialog).getByRole('button', { name: '清空画像' }));
    expect(api.clear).not.toHaveBeenCalled();
    expect(within(dialog).getByText(/不会删除关注股票/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: '确认清空画像' }));
    await waitFor(() => expect(api.clear).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('样本还不够形成画像')).toBeTruthy();
  });

  it('reloads when the page reports a new explicit behavior', async () => {
    const api = apiFor();
    const view = render(<StockPreferenceProfile refreshKey={0} api={api} />);
    await screen.findByText('筛选时持续关注估值');
    view.rerender(<StockPreferenceProfile refreshKey={1} api={api} />);
    await waitFor(() => expect(api.load).toHaveBeenCalledTimes(2));
  });

  it('does not let an older background refresh overwrite a saved preference', async () => {
    let resolveRefresh: ((value: StockPreferenceProfileResult) => void) | undefined;
    const refresh = new Promise<StockPreferenceProfileResult>((resolve) => {
      resolveRefresh = resolve;
    });
    const api = apiFor();
    vi.mocked(api.load).mockResolvedValueOnce(profile()).mockReturnValueOnce(refresh);
    const user = userEvent.setup();
    const view = render(<StockPreferenceProfile refreshKey={0} api={api} />);
    await screen.findByText('筛选时持续关注估值');

    view.rerender(<StockPreferenceProfile refreshKey={1} api={api} />);
    await waitFor(() => expect(api.load).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole('button', { name: '调整画像' }));
    await user.click(screen.getByRole('checkbox', { name: '半导体' }));
    await user.click(screen.getByRole('button', { name: '保存偏好' }));
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));

    await act(async () => {
      resolveRefresh?.(profile());
      await refresh;
    });
    await user.click(screen.getByRole('button', { name: '调整画像' }));
    expect((screen.getByRole('checkbox', { name: '半导体' }) as HTMLInputElement).checked).toBe(
      true,
    );
  });

  it('rechecks once after an explicit behavior so eventual database visibility reaches the card', async () => {
    const stale = profile({
      sample: { screeningRuns: 0, watchlistStocks: 1, manualDimensions: 0 },
    });
    const fresh = profile({
      sample: { screeningRuns: 1, watchlistStocks: 1, manualDimensions: 0 },
    });
    const api = apiFor();
    vi.mocked(api.load)
      .mockResolvedValueOnce(stale)
      .mockResolvedValueOnce(stale)
      .mockResolvedValueOnce(fresh);
    const view = render(<StockPreferenceProfile refreshKey={0} api={api} />);
    await screen.findByText('0 次筛选');

    view.rerender(<StockPreferenceProfile refreshKey={1} api={api} />);
    await waitFor(() => expect(api.load).toHaveBeenCalledTimes(2));
    expect(screen.getByText('0 次筛选')).toBeTruthy();
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 1_300));
    });

    await waitFor(() => expect(api.load).toHaveBeenCalledTimes(3));
    expect(screen.getByText('1 次筛选')).toBeTruthy();
  });
});
