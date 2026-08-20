// @vitest-environment happy-dom

import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  StockRiskRadar,
  type StockRiskRadarApi,
  type StockRiskRadarResult,
} from './StockRiskRadar';

const SNAPSHOT_A = 'stkshot_0123456789abcdef01234567';
const SNAPSHOT_B = 'stkshot_fedcba9876543210fedcba98';
const DATA_AS_OF = '2026-08-17';

afterEach(() => {
  cleanup();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
});

function result(overrides: Partial<StockRiskRadarResult> = {}): StockRiskRadarResult {
  return {
    snapshotId: SNAPSHOT_A,
    dataAsOf: DATA_AS_OF,
    generatedAt: '2026-08-17T12:00:00.000Z',
    requestedStockCount: 2,
    checkedStockCount: 2,
    truncated: false,
    signals: [
      {
        signalId: 'risk_signal_aaaaaaaaaaaaaaaaaaaaaaaa',
        evidenceId: 'risk:aaaaaaaaaaaaaaaaaaaaaaaa',
        symbol: '600001',
        name: '测试股份',
        key: 'pledge',
        label: '质押',
        severity: '高风险',
        fact: '整体质押比例较高，要留意可能触发的平仓压力。',
        trigger: '质押比例超过 50%',
        whyRelevant: '需要同时关注担保品价值变化和后续补充质押披露。',
        observedAt: '2026-08-14',
        sourceDataAsOf: '2026-08-14',
        source: 'akshare:stock_gpzy_pledge_ratio_em',
        fetchedAt: '2026-08-17T11:30:00.000Z',
        evidenceUrl: null,
      },
      {
        signalId: 'risk_signal_bbbbbbbbbbbbbbbbbbbbbbbb',
        evidenceId: 'risk:bbbbbbbbbbbbbbbbbbbbbbbb',
        symbol: '600001',
        name: '测试股份',
        key: 'inquiry',
        label: '问询函',
        severity: '警示',
        fact: '近期收到交易所问询函（1 件），要留意公司回复。',
        trigger: '最近 180 日公告标题包含问询函、关注函或监管函',
        whyRelevant: '相关事项需要进一步说明，应跟踪公司回复和后续处置。',
        observedAt: '2026-08-05',
        sourceDataAsOf: '2026-08-05',
        source: 'akshare:stock_zh_a_disclosure_report_cninfo',
        fetchedAt: '2026-08-17T11:30:00.000Z',
        evidenceUrl: 'https://example.com/inquiry.pdf',
      },
      {
        signalId: 'risk_signal_cccccccccccccccccccccccc',
        evidenceId: 'risk:cccccccccccccccccccccccc',
        symbol: '000002',
        name: '示例科技',
        key: 'insider',
        label: '减持',
        severity: '关注',
        fact: '近期有董监高减持，需要留意内部人持股变化。',
        trigger: '最近 180 日存在董监高减持记录',
        whyRelevant: '需要结合规模、原因和后续披露复核。',
        observedAt: '2026-08-01',
        sourceDataAsOf: '2026-08-01',
        source: 'akshare:stock_share_hold_change',
        fetchedAt: '2026-08-17T11:30:00.000Z',
        evidenceUrl: null,
      },
      {
        signalId: 'risk_signal_eeeeeeeeeeeeeeeeeeeeeeee',
        evidenceId: 'risk:eeeeeeeeeeeeeeeeeeeeeeee',
        symbol: '600001',
        name: '测试股份',
        key: 'forecast',
        label: '业绩预告',
        severity: '关注',
        fact: '第三条需要展开的风险事实。',
        trigger: '业绩预告出现需继续核验的变化',
        whyRelevant: '需要结合正式财报和后续修正公告复核。',
        observedAt: '2026-07-30',
        sourceDataAsOf: '2026-07-30',
        source: 'akshare:stock_yjyg_em',
        fetchedAt: '2026-08-17T11:30:00.000Z',
        evidenceUrl: null,
      },
    ],
    checks: [
      {
        symbol: '000002',
        name: '示例科技',
        key: 'goodwill',
        status: 'unavailable',
        source: 'akshare:stock_sy_em',
        fetchedAt: '2026-08-17T11:30:00.000Z',
        sourceDataAsOf: null,
        errorCode: 'UPSTREAM_UNAVAILABLE',
      },
      {
        symbol: '600001',
        name: '测试股份',
        key: 'pledge',
        status: 'checked',
        source: 'akshare:stock_gpzy_pledge_ratio_em',
        fetchedAt: '2026-08-17T11:30:00.000Z',
        sourceDataAsOf: '2026-08-14',
        errorCode: null,
      },
    ],
    ...overrides,
  };
}

describe('StockRiskRadar', () => {
  it('shows only the highest-priority signal by default on a narrow viewport', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    const api: StockRiskRadarApi = { load: vi.fn(async () => result()) };

    render(
      <StockRiskRadar
        snapshotId={SNAPSHOT_A}
        dataAsOf={DATA_AS_OF}
        trustMode="current"
        api={api}
      />,
    );

    const testedStock = (await screen.findAllByTestId('risk-stock-group'))[0];
    if (!testedStock) throw new Error('expected grouped events for 测试股份');
    await waitFor(() => expect(within(testedStock).getAllByTestId('risk-signal')).toHaveLength(1));
    expect(
      within(testedStock).getByText('整体质押比例较高，要留意可能触发的平仓压力。'),
    ).toBeTruthy();
    expect(
      within(testedStock).queryByText('近期收到交易所问询函（1 件），要留意公司回复。'),
    ).toBeNull();
    expect(within(testedStock).getByRole('button', { name: '查看全部 3 条' })).toBeTruthy();
  });

  it('announces the initial risk check without forcing motion', () => {
    const api: StockRiskRadarApi = {
      load: vi.fn(() => new Promise<StockRiskRadarResult>(() => undefined)),
    };
    render(
      <StockRiskRadar
        snapshotId={SNAPSHOT_A}
        dataAsOf={DATA_AS_OF}
        trustMode="current"
        api={api}
      />,
    );

    const loading = screen.getByLabelText('正在检查风险来源');
    expect(loading.getAttribute('role')).toBe('status');
    expect(loading.getAttribute('aria-live')).toBe('polite');
    expect(loading.getAttribute('aria-busy')).toBe('true');
    for (const skeleton of loading.children) {
      expect(skeleton.className).toContain('motion-reduce:animate-none');
    }
  });

  it('groups events by stock while preserving event evidence and explicit unknown coverage', async () => {
    const api: StockRiskRadarApi = { load: vi.fn(async () => result()) };
    const user = userEvent.setup();
    render(
      <StockRiskRadar
        snapshotId={SNAPSHOT_A}
        dataAsOf={DATA_AS_OF}
        trustMode="current"
        api={api}
      />,
    );

    expect(await screen.findByText('整体质押比例较高，要留意可能触发的平仓压力。')).toBeTruthy();
    const groups = screen.getAllByTestId('risk-stock-group');
    expect(groups).toHaveLength(2);
    expect(groups.map((group) => within(group).getByTestId('risk-severity').textContent)).toEqual([
      '高风险',
      '关注',
    ]);
    const testedStock = groups[0];
    if (!testedStock) throw new Error('expected grouped events for 测试股份');
    expect(within(testedStock).getByText('3 条事项')).toBeTruthy();
    expect(
      within(testedStock).getByText('整体质押比例较高，要留意可能触发的平仓压力。'),
    ).toBeTruthy();
    expect(
      within(testedStock).getByText('近期收到交易所问询函（1 件），要留意公司回复。'),
    ).toBeTruthy();
    expect(screen.queryByText('第三条需要展开的风险事实。')).toBeNull();
    await user.click(within(testedStock).getByRole('button', { name: '查看全部 3 条' }));
    expect(screen.getByText('第三条需要展开的风险事实。')).toBeTruthy();
    expect(screen.getByText('这些项目暂时无法判断')).toBeTruthy();
    expect(screen.getByText('示例科技 · 商誉')).toBeTruthy();
    expect(screen.queryByText(/无风险|安全/)).toBeNull();

    const evidenceButtons = within(testedStock).getAllByRole('button', { name: '查看依据' });
    expect(evidenceButtons).toHaveLength(3);
    const inquiryEvidenceButton = evidenceButtons.at(1);
    if (!inquiryEvidenceButton) throw new Error('expected an inquiry evidence control');
    await user.click(inquiryEvidenceButton);
    expect(screen.getByText('规则：最近 180 日公告标题包含问询函、关注函或监管函')).toBeTruthy();
    expect(screen.getByText('证据编号：risk:bbbbbbbbbbbbbbbbbbbbbbbb')).toBeTruthy();
    expect(screen.getByText('来源：akshare:stock_zh_a_disclosure_report_cninfo')).toBeTruthy();
    expect(screen.getByRole('link', { name: '查看来源' }).getAttribute('href')).toBe(
      'https://example.com/inquiry.pdf',
    );
    const refresh = screen.getByRole('button', { name: '刷新风险雷达' });
    expect(refresh.getAttribute('title')).toBe('刷新风险雷达');
  });

  it('uses an unknown-coverage empty state and never queries an unavailable snapshot', async () => {
    const api: StockRiskRadarApi = {
      load: vi.fn(async () => result({ signals: [], checks: [] })),
    };
    const view = render(
      <StockRiskRadar
        snapshotId={SNAPSHOT_A}
        dataAsOf={DATA_AS_OF}
        trustMode="current"
        api={api}
      />,
    );
    expect(await screen.findByText('本轮暂无可用核验结果')).toBeTruthy();
    expect(screen.queryByText('本轮规则未触发')).toBeNull();
    expect(screen.queryByText('没有风险')).toBeNull();
    expect(screen.queryByText('无风险')).toBeNull();
    expect(api.load).toHaveBeenCalledTimes(1);

    view.rerender(
      <StockRiskRadar
        snapshotId={SNAPSHOT_A}
        dataAsOf={DATA_AS_OF}
        trustMode="unavailable"
        api={api}
      />,
    );
    await waitFor(() => {
      expect(screen.queryByText('本轮规则未触发')).toBeNull();
      expect(screen.getByText('可信快照恢复后再检查风险')).toBeTruthy();
    });
    expect(api.load).toHaveBeenCalledTimes(1);
  });

  it('keeps the last verified result visible when a same-snapshot refresh fails', async () => {
    let requestCount = 0;
    const api: StockRiskRadarApi = {
      load: vi.fn(async () => {
        requestCount += 1;
        if (requestCount === 1) return result();
        throw new Error('temporary upstream failure');
      }),
    };
    const user = userEvent.setup();
    render(
      <StockRiskRadar
        snapshotId={SNAPSHOT_A}
        dataAsOf={DATA_AS_OF}
        trustMode="current"
        api={api}
      />,
    );

    expect(await screen.findByText('整体质押比例较高，要留意可能触发的平仓压力。')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '刷新风险雷达' }));

    expect(await screen.findByText('本次刷新未完成，继续展示数据日期 08/17 的已核验结果。')).toBeTruthy();
    expect(screen.getByText('整体质押比例较高，要留意可能触发的平仓压力。')).toBeTruthy();
    expect(screen.queryByText('本次风险检查未完成')).toBeNull();
  });

  it('uses a mobile-safe refresh target without enlarging the desktop control', async () => {
    const api: StockRiskRadarApi = { load: vi.fn(async () => result()) };
    render(
      <StockRiskRadar
        snapshotId={SNAPSHOT_A}
        dataAsOf={DATA_AS_OF}
        trustMode="current"
        api={api}
      />,
    );

    await screen.findByText('整体质押比例较高，要留意可能触发的平仓压力。');
    const refresh = screen.getByRole('button', { name: '刷新风险雷达' });
    expect(refresh.className).toContain('h-11');
    expect(refresh.className).toContain('sm:h-9');
  });

  it('drops an obsolete in-flight result when the dashboard snapshot changes', async () => {
    const baseSignal = result().signals[0];
    if (!baseSignal) throw new Error('expected a base risk signal');
    let resolveFirst: ((value: StockRiskRadarResult) => void) | undefined;
    const first = new Promise<StockRiskRadarResult>((resolve) => {
      resolveFirst = resolve;
    });
    const api: StockRiskRadarApi = {
      load: vi.fn((input) =>
        input.snapshotId === SNAPSHOT_A
          ? first
          : Promise.resolve(
              result({
                snapshotId: SNAPSHOT_B,
                dataAsOf: '2026-08-18',
                signals: [
                  {
                    ...baseSignal,
                    signalId: 'risk_signal_dddddddddddddddddddddddd',
                    fact: '新快照风险事实',
                  },
                ],
              }),
            ),
      ),
    };
    const view = render(
      <StockRiskRadar
        snapshotId={SNAPSHOT_A}
        dataAsOf={DATA_AS_OF}
        trustMode="current"
        api={api}
      />,
    );

    view.rerender(
      <StockRiskRadar
        snapshotId={SNAPSHOT_B}
        dataAsOf="2026-08-18"
        trustMode="current"
        api={api}
      />,
    );
    expect(await screen.findByText('新快照风险事实')).toBeTruthy();

    await act(async () => {
      resolveFirst?.(
        result({
          signals: [{ ...baseSignal, fact: '旧快照风险事实' }],
        }),
      );
      await first;
    });

    expect(screen.queryByText('旧快照风险事实')).toBeNull();
    expect(screen.getByText('新快照风险事实')).toBeTruthy();
  });

  it('preserves an expanded stock across passive snapshot refreshes and resets it for an explicit refresh', async () => {
    const api: StockRiskRadarApi = {
      load: vi.fn(async (input) =>
        result({
          snapshotId: input.snapshotId,
          dataAsOf: input.dataAsOf,
        }),
      ),
    };
    const user = userEvent.setup();
    const view = render(
      <StockRiskRadar
        snapshotId={SNAPSHOT_A}
        dataAsOf={DATA_AS_OF}
        trustMode="current"
        api={api}
      />,
    );

    const testedStock = (await screen.findAllByTestId('risk-stock-group'))[0];
    if (!testedStock) throw new Error('expected grouped events for 测试股份');
    await user.click(within(testedStock).getByRole('button', { name: '查看全部 3 条' }));
    expect(screen.getByText('第三条需要展开的风险事实。')).toBeTruthy();

    view.rerender(
      <StockRiskRadar
        snapshotId={SNAPSHOT_B}
        dataAsOf={DATA_AS_OF}
        trustMode="current"
        api={api}
      />,
    );

    expect(await screen.findByText('第三条需要展开的风险事实。')).toBeTruthy();
    expect(screen.getByRole('button', { name: '收起其他事项' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '刷新风险雷达' }));
    await waitFor(() => expect(api.load).toHaveBeenCalledTimes(3));
    expect(screen.queryByText('第三条需要展开的风险事实。')).toBeNull();
    expect(screen.getByRole('button', { name: '查看全部 3 条' })).toBeTruthy();
  });

  it('drops expansion state when a refreshed snapshot no longer contains that stock', async () => {
    const api: StockRiskRadarApi = {
      load: vi.fn(async (input) => {
        const next = result({ snapshotId: input.snapshotId, dataAsOf: input.dataAsOf });
        return input.snapshotId === SNAPSHOT_B
          ? { ...next, signals: next.signals.filter((signal) => signal.symbol === '000002') }
          : next;
      }),
    };
    const user = userEvent.setup();
    const view = render(
      <StockRiskRadar
        snapshotId={SNAPSHOT_A}
        dataAsOf={DATA_AS_OF}
        trustMode="current"
        api={api}
      />,
    );

    const testedStock = (await screen.findAllByTestId('risk-stock-group'))[0];
    if (!testedStock) throw new Error('expected grouped events for 测试股份');
    await user.click(within(testedStock).getByRole('button', { name: '查看全部 3 条' }));
    expect(screen.getByText('第三条需要展开的风险事实。')).toBeTruthy();

    view.rerender(
      <StockRiskRadar
        snapshotId={SNAPSHOT_B}
        dataAsOf={DATA_AS_OF}
        trustMode="current"
        api={api}
      />,
    );
    expect(await screen.findByText('示例科技')).toBeTruthy();

    view.rerender(
      <StockRiskRadar
        snapshotId={SNAPSHOT_A}
        dataAsOf={DATA_AS_OF}
        trustMode="current"
        api={api}
      />,
    );
    expect(await screen.findByText('整体质押比例较高，要留意可能触发的平仓压力。')).toBeTruthy();
    expect(screen.queryByText('第三条需要展开的风险事实。')).toBeNull();
    expect(screen.getByRole('button', { name: '查看全部 3 条' })).toBeTruthy();
  });

  it('states partial A-share coverage truthfully and distinguishes an empty universe', async () => {
    const truncatedApi: StockRiskRadarApi = {
      load: vi.fn(async () =>
        result({
          requestedStockCount: 10,
          checkedStockCount: 8,
          truncated: true,
        }),
      ),
    };
    const view = render(
      <StockRiskRadar
        snapshotId={SNAPSHOT_A}
        dataAsOf={DATA_AS_OF}
        trustMode="current"
        api={truncatedApi}
      />,
    );

    expect(await screen.findByText('A股检查 8/10 只 · 其余 2 只未纳入本轮')).toBeTruthy();
    expect(screen.queryByText(/后续批次/)).toBeNull();

    const emptyApi: StockRiskRadarApi = {
      load: vi.fn(async () =>
        result({
          requestedStockCount: 0,
          checkedStockCount: 0,
          truncated: false,
          signals: [],
          checks: [],
        }),
      ),
    };
    view.rerender(
      <StockRiskRadar
        snapshotId={SNAPSHOT_A}
        dataAsOf={DATA_AS_OF}
        trustMode="current"
        api={emptyApi}
      />,
    );

    expect(await screen.findByText('暂无可检查的 A 股自选股')).toBeTruthy();
    expect(screen.queryByText('本轮规则未触发')).toBeNull();
  });

  it('creates monitoring only after confirming the bounded deterministic rules', async () => {
    const monitor = {
      monitorId: 'srm_1',
      plannedTaskId: 'pln_1',
      symbol: '600001',
      status: 'active' as const,
      nextRunAt: '2026-08-18T08:30:00.000Z',
      lastRunAt: null,
      lastOutcome: null,
      lastSummary: null,
    };
    const api: StockRiskRadarApi = {
      load: vi.fn(async () => result()),
      loadMonitors: vi.fn(async () => []),
      createMonitor: vi.fn(async () => ({ created: true, monitor })),
      toggleMonitor: vi.fn(async () => ({ status: 'paused' as const })),
      runMonitorNow: vi.fn(async () => ({ runId: 'plr_1', status: 'starting' as const })),
      archiveMonitor: vi.fn(async () => ({ ok: true as const })),
    };
    const user = userEvent.setup();
    render(
      <StockRiskRadar
        snapshotId={SNAPSHOT_A}
        dataAsOf={DATA_AS_OF}
        trustMode="current"
        api={api}
      />,
    );

    const group = (await screen.findAllByTestId('risk-stock-group'))[0];
    if (!group) throw new Error('expected grouped stock');
    await user.click(within(group).getByRole('button', { name: '持续监控测试股份' }));
    expect(screen.getByRole('dialog', { name: '持续监控测试股份风险' })).toBeTruthy();
    expect(screen.getByText('每天 16:30 · Asia/Shanghai')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '确认开始监控' }));

    expect(api.createMonitor).toHaveBeenCalledWith({
      snapshotId: SNAPSHOT_A,
      dataAsOf: DATA_AS_OF,
      trustMode: 'current',
      symbol: '600001',
    });
    expect(await within(group).findByText('监控中')).toBeTruthy();
    const recordLink = within(group).getByRole('link', { name: '查看测试股份监控记录' });
    expect(recordLink.getAttribute('href')).toBe('/planned?plan=pln_1');
  });

  it('offers monitoring for a checked watchlist stock with no currently triggered signal', async () => {
    const quietCheck = {
      symbol: '300001',
      name: '沉默股份',
      key: 'pledge' as const,
      status: 'checked' as const,
      source: 'akshare:stock_gpzy_pledge_ratio_em',
      fetchedAt: '2026-08-17T11:30:00.000Z',
      sourceDataAsOf: '2026-08-17',
      errorCode: null,
    };
    const api: StockRiskRadarApi = {
      load: vi.fn(async () => result({
        requestedStockCount: 3,
        checkedStockCount: 3,
        checks: [...result().checks, quietCheck],
      })),
      loadMonitors: vi.fn(async () => []),
      createMonitor: vi.fn(async () => ({
        created: true,
        monitor: {
          monitorId: 'srm_quiet',
          plannedTaskId: 'pln_quiet',
          symbol: '300001',
          status: 'active' as const,
          nextRunAt: '2026-08-18T08:30:00.000Z',
          lastRunAt: null,
          lastOutcome: null,
          lastSummary: null,
        },
      })),
    };
    const user = userEvent.setup();
    render(
      <StockRiskRadar
        snapshotId={SNAPSHOT_A}
        dataAsOf={DATA_AS_OF}
        trustMode="current"
        api={api}
      />,
    );

    const quietGroup = (await screen.findAllByTestId('risk-stock-group')).find(
      (group) => group.getAttribute('data-stock-symbol') === '300001',
    );
    if (!quietGroup) throw new Error('expected risk coverage group for 沉默股份');
    expect(within(quietGroup).getByText('本轮未触发已配置阈值')).toBeTruthy();
    await user.click(within(quietGroup).getByRole('button', { name: '持续监控沉默股份' }));
    await user.click(screen.getByRole('button', { name: '确认开始监控' }));

    expect(api.createMonitor).toHaveBeenCalledWith(expect.objectContaining({ symbol: '300001' }));
  });

  it('does not describe an all-unavailable stock as checked or untriggered', async () => {
    const unavailableCheck = {
      symbol: '300002',
      name: '待核验股份',
      key: 'pledge' as const,
      status: 'unavailable' as const,
      source: 'akshare:stock_gpzy_pledge_ratio_em',
      fetchedAt: '2026-08-17T11:30:00.000Z',
      sourceDataAsOf: null,
      errorCode: 'UPSTREAM_UNAVAILABLE',
    };
    const api: StockRiskRadarApi = {
      load: vi.fn(async () => result({
        requestedStockCount: 1,
        checkedStockCount: 1,
        signals: [],
        checks: [unavailableCheck],
      })),
      loadMonitors: vi.fn(async () => []),
    };
    render(
      <StockRiskRadar
        snapshotId={SNAPSHOT_A}
        dataAsOf={DATA_AS_OF}
        trustMode="current"
        api={api}
      />,
    );

    const unavailableGroup = (await screen.findAllByTestId('risk-stock-group')).find(
      (group) => group.getAttribute('data-stock-symbol') === '300002',
    );
    if (!unavailableGroup) throw new Error('expected unavailable coverage group for 待核验股份');
    expect(screen.getByText('本轮暂无可用核验结果')).toBeTruthy();
    expect(screen.queryByText('本轮规则未触发')).toBeNull();
    expect(within(unavailableGroup).getByText('本轮来源暂不可判断')).toBeTruthy();
    expect(within(unavailableGroup).getByText('本轮无可用核验结果')).toBeTruthy();
    expect(within(unavailableGroup).queryByText('本轮未触发已配置阈值')).toBeNull();
  });

  it('keeps verified risk facts visible when monitor status loading fails', async () => {
    const api: StockRiskRadarApi = {
      load: vi.fn(async () => result()),
      loadMonitors: vi.fn(async () => { throw new Error('monitor offline'); }),
    };
    render(
      <StockRiskRadar
        snapshotId={SNAPSHOT_A}
        dataAsOf={DATA_AS_OF}
        trustMode="current"
        api={api}
      />,
    );

    expect(await screen.findByText('整体质押比例较高，要留意可能触发的平仓压力。')).toBeTruthy();
    expect(screen.queryByText('本次风险检查未完成')).toBeNull();
    expect(screen.queryByRole('button', { name: /持续监控/ })).toBeNull();
  });

  it('renders paused and failed monitor states with explicit actions and native titles', async () => {
    const api: StockRiskRadarApi = {
      load: vi.fn(async () => result()),
      loadMonitors: vi.fn(async () => [
        {
          monitorId: 'srm_1',
          plannedTaskId: 'pln_1',
          symbol: '600001',
          status: 'paused' as const,
          nextRunAt: null,
          lastRunAt: '2026-08-18T09:00:00.000Z',
          lastOutcome: 'unchanged' as const,
          lastSummary: '风险状态无变化',
        },
        {
          monitorId: 'srm_2',
          plannedTaskId: 'pln_2',
          symbol: '000002',
          status: 'failed' as const,
          nextRunAt: '2026-08-19T08:30:00.000Z',
          lastRunAt: '2026-08-18T09:00:00.000Z',
          lastOutcome: 'failed' as const,
          lastSummary: '本次风险检查未完成',
        },
      ]),
      toggleMonitor: vi.fn(async () => ({ status: 'active' as const })),
      runMonitorNow: vi.fn(async () => ({ runId: 'plr_1', status: 'starting' as const })),
    };
    render(
      <StockRiskRadar
        snapshotId={SNAPSHOT_A}
        dataAsOf={DATA_AS_OF}
        trustMode="current"
        api={api}
      />,
    );

    expect(await screen.findByText('已暂停')).toBeTruthy();
    expect(screen.getByText('需要处理')).toBeTruthy();
    expect(screen.getByRole('button', { name: '恢复测试股份监控' }).getAttribute('title'))
      .toBe('恢复测试股份监控');
    expect(screen.getByRole('button', { name: '立即重试示例科技监控' }).getAttribute('title'))
      .toBe('立即重试示例科技监控');
  });
});
