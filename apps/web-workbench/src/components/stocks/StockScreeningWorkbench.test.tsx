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
  it('keeps an in-flight result when the dashboard rotates to a same-day snapshot', async () => {
    let resolveRun: ((value: unknown) => void) | undefined;
    const runPromise = new Promise((resolve) => {
      resolveRun = resolve;
    });
    const api: StockScreeningWorkbenchApi = {
      preview: vi.fn(async () => ({
        criteria: [{
          id: 'pe-1',
          field: 'pe_ttm',
          operator: 'lte',
          value: 30,
          unit: null,
          label: '市盈率不超过 30',
          sourceField: '市盈率TTM',
          status: 'ready',
        }],
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
        candidates: [{
          symbol: '600519',
          name: '贵州茅台',
          snapshotId: SNAPSHOT_A,
          dataAsOf: DATA_AS_OF,
          matchedCriteria: ['市盈率不超过 30'],
          unmetCriteria: [],
          missingCriteria: [],
          warnings: [],
          evidence: [],
        }],
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
});
