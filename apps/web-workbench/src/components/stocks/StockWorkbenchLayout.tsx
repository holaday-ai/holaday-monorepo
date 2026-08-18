import { cn } from '@/lib/utils';
import type * as React from 'react';
import type { StockScreeningViewState } from './StockScreeningWorkbench';

export function StockTaskWorkspaceLayout({
  highlights,
  riskRadar,
  screening,
  preferenceProfile,
  briefing,
  screeningView,
}: {
  highlights: React.ReactNode;
  riskRadar: React.ReactNode;
  screening: React.ReactNode;
  preferenceProfile: React.ReactNode;
  briefing: React.ReactNode;
  screeningView: StockScreeningViewState;
}): JSX.Element {
  const showsResults = screeningView === 'results';

  return (
    <section aria-label="核心股市任务" className="min-w-0 space-y-5">
      <div className="min-w-0">{highlights}</div>
      <div className="min-w-0">{riskRadar}</div>
      <div className="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-12">
        <div className={cn('min-w-0', showsResults ? 'lg:col-span-12' : 'lg:col-span-7')}>
          {screening}
        </div>
        <div className={cn('min-w-0', showsResults ? 'lg:col-span-12' : 'lg:col-span-5')}>
          {preferenceProfile}
        </div>
      </div>
      <div className="min-w-0">{briefing}</div>
    </section>
  );
}

export function StockMarketContextLayout({
  discovery,
  temperature,
  sectors,
  leaderboard,
  marketTable,
  starStocks,
}: {
  discovery: React.ReactNode;
  temperature: React.ReactNode;
  sectors: React.ReactNode;
  leaderboard: React.ReactNode;
  marketTable: React.ReactNode;
  starStocks: React.ReactNode;
}): JSX.Element {
  return (
    <section aria-labelledby="stock-market-context-title" className="min-w-0 space-y-3">
      <div className="px-0.5">
        <h2
          id="stock-market-context-title"
          className="text-[16px] font-semibold tracking-tight text-[#344054]"
        >
          市场背景
        </h2>
        <p className="mt-1 text-[12px] text-[#7D8493]">用于核对任务判断的市场动态与横向参照</p>
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-8">{discovery}</div>
        <div className="min-w-0 space-y-5 lg:col-span-4">
          {temperature}
          {sectors}
          {leaderboard}
        </div>
        <div className="min-w-0 lg:col-span-6">{marketTable}</div>
        <div className="min-w-0 lg:col-span-6">{starStocks}</div>
      </div>
    </section>
  );
}
