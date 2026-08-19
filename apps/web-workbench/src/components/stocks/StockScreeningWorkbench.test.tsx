// @vitest-environment happy-dom

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  StockScreeningWorkbench,
  type StockScreeningWorkbenchApi,
} from './StockScreeningWorkbench';

const SNAPSHOT_A = 'stkshot_0123456789abcdef01234567';
const SNAPSHOT_B = 'stkshot_fedcba9876543210fedcba98';
const DATA_AS_OF = '2026-08-17';

afterEach(cleanup);

describe('StockScreeningWorkbench', () => {
  it('publishes idle, criteria, and results view states from trusted UI state', async () => {
    const api: StockScreeningWorkbenchApi = {
      preview: vi.fn(async () => ({
        criteria: [
          {
            id: 'pe-1',
            field: 'pe_ttm',
            operator: 'lte',
            value: 30,
            unit: null,
            label: '市盈率不超过 30',
            sourceField: '市盈率TTM',
            status: 'ready',
          },
        ],
        unparsedClauses: [],
      })) as StockScreeningWorkbenchApi['preview'],
      run: vi.fn(async () => ({
        snapshotId: SNAPSHOT_A,
        dataAsOf: DATA_AS_OF,
        coverage: {
          universeCount: 1,
          marketPrefilterCount: 1,
          deepCheckedCount: 1,
          deepCheckLimit: 20,
          truncated: false,
        },
        candidates: [],
        zeroResult: true,
      })) as StockScreeningWorkbenchApi['run'],
    };
    const onViewStateChange = vi.fn();
    const user = userEvent.setup();

    render(
      <StockScreeningWorkbench
        snapshotId={SNAPSHOT_A}
        dataAsOf={DATA_AS_OF}
        trustMode="current"
        onAddToWatchlist={vi.fn(async () => undefined)}
        onViewStateChange={onViewStateChange}
        api={api}
      />,
    );

    await waitFor(() => expect(onViewStateChange).toHaveBeenLastCalledWith('idle'));
    await user.type(screen.getByRole('textbox'), '市盈率低于30');
    await user.click(screen.getByRole('button', { name: '识别条件' }));
    await waitFor(() => expect(onViewStateChange).toHaveBeenLastCalledWith('criteria'));
    await user.click(screen.getByRole('button', { name: '按这些条件查找' }));
    await waitFor(() => expect(onViewStateChange).toHaveBeenLastCalledWith('results'));
    await user.click(screen.getByRole('button', { name: '清空筛选条件' }));
    await waitFor(() => expect(onViewStateChange).toHaveBeenLastCalledWith('idle'));
  });

  it('keeps the last trusted result visible when a later preview fails', async () => {
    const api: StockScreeningWorkbenchApi = {
      preview: vi
        .fn()
        .mockResolvedValueOnce({
          criteria: [
            {
              id: 'pe-1',
              field: 'pe_ttm',
              operator: 'lte',
              value: 30,
              unit: null,
              label: '市盈率不超过 30',
              sourceField: '市盈率TTM',
              status: 'ready',
            },
          ],
          unparsedClauses: [],
        })
        .mockRejectedValueOnce(
          new Error('预览服务暂时不可用'),
        ) as StockScreeningWorkbenchApi['preview'],
      run: vi.fn(async () => ({
        snapshotId: SNAPSHOT_A,
        dataAsOf: DATA_AS_OF,
        coverage: {
          universeCount: 5_538,
          marketPrefilterCount: 1_133,
          deepCheckedCount: 20,
          deepCheckLimit: 20,
          truncated: true,
        },
        candidates: [
          {
            symbol: '600519',
            name: '贵州茅台',
            snapshotId: SNAPSHOT_A,
            dataAsOf: DATA_AS_OF,
            matchedCriteria: ['市盈率不超过 30'],
            unmetCriteria: [],
            missingCriteria: [],
            warnings: [],
            evidence: [],
          },
        ],
        zeroResult: false,
      })) as StockScreeningWorkbenchApi['run'],
    };
    const user = userEvent.setup();

    render(
      <StockScreeningWorkbench
        snapshotId={SNAPSHOT_A}
        dataAsOf={DATA_AS_OF}
        trustMode="current"
        onAddToWatchlist={vi.fn(async () => undefined)}
        api={api}
      />,
    );

    const prompt = screen.getByRole('textbox');
    await user.type(prompt, '市盈率低于30');
    await user.click(screen.getByRole('button', { name: '识别条件' }));
    await user.click(await screen.findByRole('button', { name: '按这些条件查找' }));
    expect(await screen.findByRole('heading', { name: '完整符合 1 只' })).toBeTruthy();

    await user.clear(prompt);
    await user.type(prompt, '资产负债率低于50%');
    await user.click(screen.getByRole('button', { name: '识别条件' }));

    expect(await screen.findByText('预览服务暂时不可用')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '完整符合 1 只' })).toBeTruthy();
    expect(screen.getByText('贵州茅台')).toBeTruthy();
  });

  it('reports a successful screening so the preference profile can refresh', async () => {
    const api: StockScreeningWorkbenchApi = {
      preview: vi.fn(async () => ({
        criteria: [
          {
            id: 'pe-1',
            field: 'pe_ttm',
            operator: 'lte',
            value: 30,
            unit: null,
            label: '市盈率不超过 30',
            sourceField: '市盈率TTM',
            status: 'ready',
          },
        ],
        unparsedClauses: [],
      })) as StockScreeningWorkbenchApi['preview'],
      run: vi.fn(async () => ({
        snapshotId: SNAPSHOT_A,
        dataAsOf: DATA_AS_OF,
        coverage: {
          universeCount: 1,
          marketPrefilterCount: 1,
          deepCheckedCount: 1,
          deepCheckLimit: 20,
          truncated: false,
        },
        candidates: [],
        zeroResult: true,
      })) as StockScreeningWorkbenchApi['run'],
    };
    const onScreeningRecorded = vi.fn();
    const user = userEvent.setup();
    render(
      <StockScreeningWorkbench
        snapshotId={SNAPSHOT_A}
        dataAsOf={DATA_AS_OF}
        trustMode="current"
        onAddToWatchlist={vi.fn(async () => undefined)}
        onScreeningRecorded={onScreeningRecorded}
        api={api}
      />,
    );

    await user.type(screen.getByRole('textbox'), '市盈率低于30');
    await user.click(screen.getByRole('button', { name: '识别条件' }));
    await user.click(await screen.findByRole('button', { name: '按这些条件查找' }));
    await waitFor(() => expect(onScreeningRecorded).toHaveBeenCalledTimes(1));
  });

  it('keeps an in-flight result when the dashboard rotates to a same-day snapshot', async () => {
    let resolveRun: ((value: unknown) => void) | undefined;
    const runPromise = new Promise((resolve) => {
      resolveRun = resolve;
    });
    const api: StockScreeningWorkbenchApi = {
      preview: vi.fn(async () => ({
        criteria: [
          {
            id: 'pe-1',
            field: 'pe_ttm',
            operator: 'lte',
            value: 30,
            unit: null,
            label: '市盈率不超过 30',
            sourceField: '市盈率TTM',
            status: 'ready',
          },
        ],
        unparsedClauses: [],
      })) as StockScreeningWorkbenchApi['preview'],
      run: vi.fn(() => runPromise) as StockScreeningWorkbenchApi['run'],
    };
    const onAddToWatchlist = vi.fn(async () => undefined);
    const user = userEvent.setup();
    const view = render(
      <StockScreeningWorkbench
        snapshotId={SNAPSHOT_A}
        dataAsOf={DATA_AS_OF}
        trustMode="current"
        onAddToWatchlist={onAddToWatchlist}
        api={api}
      />,
    );

    await user.type(screen.getByRole('textbox'), '市盈率低于30');
    await user.click(screen.getByRole('button', { name: '识别条件' }));
    await user.click(await screen.findByRole('button', { name: '按这些条件查找' }));
    expect(screen.getByRole('button', { name: '正在查找…' })).toBeTruthy();

    view.rerender(
      <StockScreeningWorkbench
        snapshotId={SNAPSHOT_B}
        dataAsOf={DATA_AS_OF}
        trustMode="delayed"
        onAddToWatchlist={onAddToWatchlist}
        api={api}
      />,
    );

    await act(async () => {
      resolveRun?.({
        snapshotId: SNAPSHOT_A,
        dataAsOf: DATA_AS_OF,
        coverage: {
          universeCount: 5_538,
          marketPrefilterCount: 1_133,
          deepCheckedCount: 20,
          deepCheckLimit: 20,
          truncated: true,
        },
        candidates: [
          {
            symbol: '600519',
            name: '贵州茅台',
            snapshotId: SNAPSHOT_A,
            dataAsOf: DATA_AS_OF,
            matchedCriteria: ['市盈率不超过 30'],
            unmetCriteria: [],
            missingCriteria: [],
            warnings: [],
            evidence: [],
          },
        ],
        zeroResult: false,
      });
      await runPromise;
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '完整符合 1 只' })).toBeTruthy();
    });
    expect(screen.getByText(/全市场 5,538 只 · 初筛 1,133 只/)).toBeTruthy();

    view.rerender(
      <StockScreeningWorkbench
        snapshotId={SNAPSHOT_B}
        dataAsOf="2026-08-18"
        trustMode="current"
        onAddToWatchlist={onAddToWatchlist}
        api={api}
      />,
    );
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: '完整符合 1 只' })).toBeNull();
    });
  });

  it('keeps exact matches primary and reveals secondary outcomes on demand', async () => {
    const api: StockScreeningWorkbenchApi = {
      preview: vi.fn(async () => ({
        criteria: [
          {
            id: 'profit-1',
            field: 'net_profit_3y_positive',
            operator: 'eq',
            value: true,
            unit: null,
            label: '近三年持续盈利',
            sourceField: '近3年净利润',
            status: 'ready',
          },
        ],
        unparsedClauses: [],
      })) as StockScreeningWorkbenchApi['preview'],
      run: vi.fn(async () => ({
        snapshotId: SNAPSHOT_A,
        dataAsOf: DATA_AS_OF,
        coverage: {
          universeCount: 5_540,
          marketPrefilterCount: 5_540,
          deepCheckedCount: 3,
          deepCheckLimit: 20,
          truncated: true,
        },
        candidates: [
          {
            symbol: '300502',
            name: '精确匹配',
            snapshotId: SNAPSHOT_A,
            dataAsOf: DATA_AS_OF,
            matchedCriteria: ['近三年持续盈利'],
            unmetCriteria: [],
            missingCriteria: [],
            warnings: [],
            evidence: [
              {
                id: 'evidence-exact',
                label: '近三年持续盈利',
                source: 'akshare:stock_financial_abstract_ths(report+annual+quarter)',
                asOf: DATA_AS_OF,
              },
            ],
          },
          {
            symbol: '300308',
            name: '资料待补',
            snapshotId: SNAPSHOT_A,
            dataAsOf: DATA_AS_OF,
            matchedCriteria: [],
            unmetCriteria: [],
            missingCriteria: ['近三年持续盈利'],
            warnings: [],
            evidence: [],
          },
          {
            symbol: '688256',
            name: '条件未满足',
            snapshotId: SNAPSHOT_A,
            dataAsOf: DATA_AS_OF,
            matchedCriteria: [],
            unmetCriteria: ['近三年持续盈利'],
            missingCriteria: [],
            warnings: [],
            evidence: [],
          },
        ],
        zeroResult: false,
      })) as StockScreeningWorkbenchApi['run'],
    };
    const user = userEvent.setup();
    render(
      <StockScreeningWorkbench
        snapshotId={SNAPSHOT_A}
        dataAsOf={DATA_AS_OF}
        trustMode="current"
        onAddToWatchlist={vi.fn(async () => undefined)}
        api={api}
      />,
    );

    await user.type(screen.getByRole('textbox'), '近三年持续盈利');
    await user.click(screen.getByRole('button', { name: '识别条件' }));
    await user.click(await screen.findByRole('button', { name: '按这些条件查找' }));

    expect(await screen.findByText('精确匹配')).toBeTruthy();
    const missingGroup = screen.getByText('查看缺少数据 1 只').closest('details');
    const unmetGroup = screen.getByText('查看未满足 1 只').closest('details');
    expect(missingGroup?.open).toBe(false);
    expect(unmetGroup?.open).toBe(false);

    await user.click(screen.getByText('查看缺少数据 1 只'));
    expect(missingGroup?.open).toBe(true);
    expect(screen.getByText('资料待补')).toBeTruthy();
    expect(unmetGroup?.open).toBe(false);

    await user.click(screen.getByText('查看未满足 1 只'));
    expect(unmetGroup?.open).toBe(true);
    expect(screen.getByText('条件未满足')).toBeTruthy();

    await user.click(screen.getByText('查看 1 条数据来源'));
    expect(await screen.findByText(`数据日期 ${DATA_AS_OF}`)).toBeTruthy();
    expect(
      screen.getByText('akshare:stock_financial_abstract_ths(report+annual+quarter)'),
    ).toBeTruthy();
  });
});
