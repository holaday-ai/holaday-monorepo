// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  StockMarketContextLayout,
  StockResearchTable,
  StockTaskWorkspaceLayout,
} from './StockWorkbenchLayout';

afterEach(cleanup);

function node(label: string): JSX.Element {
  return <div data-testid={label}>{label}</div>;
}

describe('StockTaskWorkspaceLayout', () => {
  it('opens on the watchlist research desk and keeps secondary tasks out of the reading flow', () => {
    render(
      <StockTaskWorkspaceLayout
        highlights={node('highlights')}
        riskRadar={node('risk')}
        screening={node('screening')}
        preferenceProfile={node('profile')}
        briefing={node('briefing')}
        screeningView="idle"
      />,
    );

    expect(screen.getByRole('navigation', { name: '股市任务视图' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '关注股票' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByTestId('highlights')).toBeTruthy();
    expect(screen.queryByTestId('risk')).toBeNull();
    expect(screen.queryByTestId('screening')).toBeNull();
    expect(screen.queryByTestId('profile')).toBeNull();
    expect(screen.queryByTestId('briefing')).toBeNull();
    expect(screen.getByRole('complementary', { name: '下一步' })).toBeTruthy();
  });

  it('switches task destinations without stacking every stock module on the page', async () => {
    const user = userEvent.setup();
    render(
      <StockTaskWorkspaceLayout
        highlights={node('highlights')}
        riskRadar={node('risk')}
        screening={node('screening')}
        preferenceProfile={node('profile')}
        briefing={node('briefing')}
        screeningView="idle"
      />,
    );

    await user.click(screen.getByRole('button', { name: '风险证据' }));
    expect(screen.getByTestId('risk')).toBeTruthy();
    expect(screen.queryByTestId('highlights')).toBeNull();

    await user.click(screen.getByRole('button', { name: '条件选股' }));
    expect(screen.getByTestId('screening')).toBeTruthy();
    expect(screen.getByTestId('profile')).toBeTruthy();
    expect(screen.queryByTestId('risk')).toBeNull();

    await user.click(screen.getByRole('button', { name: '今日简报' }));
    expect(screen.getByTestId('briefing')).toBeTruthy();
    expect(screen.queryByTestId('screening')).toBeNull();
  });

  it('routes next-step actions to the matching research task', async () => {
    const user = userEvent.setup();
    render(
      <StockTaskWorkspaceLayout
        highlights={node('highlights')}
        riskRadar={node('risk')}
        screening={node('screening')}
        preferenceProfile={node('profile')}
        briefing={node('briefing')}
        screeningView="results"
      />,
    );

    const nextStep = screen.getByRole('complementary', { name: '下一步' });
    expect(nextStep.querySelectorAll('button')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: '生成关注简报' })).toBeNull();
    expect(screen.queryByRole('button', { name: '设置跟踪任务' })).toBeNull();
    expect(screen.queryByText('核对触发条件与来源')).toBeNull();
    expect(screen.queryByText('按条件筛选并看偏好盲点')).toBeNull();

    await user.click(screen.getByRole('button', { name: '查看风险证据' }));
    expect(screen.getByTestId('risk')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '关注股票' }));
    await user.click(screen.getByRole('button', { name: '今日简报' }));
    expect(screen.getByTestId('briefing')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '关注股票' }));
    await user.click(screen.getByRole('button', { name: '打开选股与偏好' }));
    expect(screen.getByTestId('screening')).toBeTruthy();
    expect(screen.getByTestId('profile')).toBeTruthy();
  });
});

describe('StockResearchTable', () => {
  it('keeps the full watchlist scannable and opens one selected stock at a time', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <StockResearchTable
        rows={[
          {
            symbol: '603528',
            name: '多伦科技',
            price: '6.30',
            changePct: -1.56,
            turnover: '0.68亿',
            note: '事件跟踪：业务/估值',
            updatedAt: '12:51',
          },
          {
            symbol: '600497',
            name: '驰宏锌锗',
            price: '5.12',
            changePct: 0.79,
            turnover: '1.32亿',
            note: '金属价格弹性',
            updatedAt: '12:50',
          },
        ]}
        selectedSymbol="603528"
        onSelect={onSelect}
      />,
    );

    expect(screen.getByRole('table', { name: '关注股票列表' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '查看多伦科技研究详情' }).getAttribute('aria-current')).toBe('true');

    await user.click(screen.getByRole('button', { name: '查看驰宏锌锗研究详情' }));
    expect(onSelect).toHaveBeenCalledWith('600497');
  });
});

describe('StockMarketContextLayout', () => {
  it('keeps broad-market references available without forcing them into the default task flow', async () => {
    const user = userEvent.setup();
    render(
      <StockMarketContextLayout
        discovery={node('discovery')}
        temperature={node('temperature')}
        sectors={node('sectors')}
        leaderboard={node('leaderboard')}
        marketTable={node('market-table')}
        starStocks={node('star-stocks')}
      />,
    );

    expect(screen.getByRole('heading', { name: '市场背景' })).toBeTruthy();
    expect(screen.queryByTestId('discovery')).toBeNull();
    expect(screen.getByRole('button', { name: '展开市场背景' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '展开市场背景' }));
    expect(
      [...document.querySelectorAll('[data-testid]')].map((element) =>
        element.getAttribute('data-testid'),
      ),
    ).toEqual([
      'discovery',
      'temperature',
      'sectors',
      'leaderboard',
      'market-table',
      'star-stocks',
    ]);

    await user.click(screen.getByRole('button', { name: '收起市场背景' }));
    expect(screen.queryByTestId('discovery')).toBeNull();
  });
});
