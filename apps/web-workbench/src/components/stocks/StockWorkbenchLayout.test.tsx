// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StockMarketContextLayout, StockTaskWorkspaceLayout } from './StockWorkbenchLayout';

afterEach(cleanup);

function node(label: string): JSX.Element {
  return <div data-testid={label}>{label}</div>;
}

describe('StockTaskWorkspaceLayout', () => {
  it('keeps the core task order and gives idle screening a bounded companion profile', () => {
    const { container } = render(
      <StockTaskWorkspaceLayout
        highlights={node('highlights')}
        riskRadar={node('risk')}
        screening={node('screening')}
        preferenceProfile={node('profile')}
        briefing={node('briefing')}
        screeningView="idle"
      />,
    );

    expect(
      [...container.querySelectorAll('[data-testid]')].map((element) =>
        element.getAttribute('data-testid'),
      ),
    ).toEqual(['highlights', 'risk', 'screening', 'profile', 'briefing']);
    expect(screen.getByTestId('screening').parentElement?.className).toContain('lg:col-span-7');
    expect(screen.getByTestId('profile').parentElement?.className).toContain('lg:col-span-5');
  });

  it('expands both screening results and the profile to full width', () => {
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

    expect(screen.getByTestId('screening').parentElement?.className).toContain('lg:col-span-12');
    expect(screen.getByTestId('profile').parentElement?.className).toContain('lg:col-span-12');
  });
});

describe('StockMarketContextLayout', () => {
  it('places the bounded market context below a visible section heading', () => {
    const { container } = render(
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
    expect(container.querySelector('.lg\\:grid-cols-12')).toBeTruthy();
    expect(
      [...container.querySelectorAll('[data-testid]')].map((element) =>
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
  });
});
