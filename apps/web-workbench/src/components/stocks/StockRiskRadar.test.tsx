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

afterEach(cleanup);

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
  it('renders ordered facts, rule evidence, and explicit unknown coverage', async () => {
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
    const cards = screen.getAllByTestId('risk-signal');
    expect(cards.map((card) => within(card).getByTestId('risk-severity').textContent)).toEqual([
      '高风险',
      '警示',
      '关注',
    ]);
    expect(screen.getByText('这些项目暂时无法判断')).toBeTruthy();
    expect(screen.getByText('示例科技 · 商誉')).toBeTruthy();
    expect(screen.queryByText(/无风险|安全/)).toBeNull();

    const evidenceButtons = screen.getAllByRole('button', { name: '查看依据' });
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

  it('uses a non-safety empty state and never queries an unavailable snapshot', async () => {
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
    expect(await screen.findByText('本轮规则未触发')).toBeTruthy();
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
});
