import { describe, expect, it } from 'vitest';
import {
  buildStockPreferenceProfile,
  emptyManualStockPreferences,
  type StockPreferenceSignalInput,
} from './stock-preference-profile.js';

const NOW = new Date('2026-08-18T02:00:00.000Z');

function screeningSignal(
  fields: StockPreferenceSignalInput['payload']['criteria'][number]['field'][],
  occurredAt = new Date('2026-08-17T02:00:00.000Z'),
): StockPreferenceSignalInput {
  return {
    kind: 'screening_run',
    occurredAt,
    dataAsOf: '2026-08-17',
    payload: {
      snapshotId: 'stkshot_0123456789abcdef01234567',
      criteria: fields.map((field, index) => ({
        field,
        operator: field === 'exclude_st' ? 'eq' : 'lte',
        value: field === 'exclude_st' ? true : 30 + index,
      })),
    },
  };
}

function watchlist(count: number, market = 'A') {
  return Array.from({ length: count }, (_, index) => ({
    symbol: String(600000 + index),
    market,
    createdAt: new Date(`2026-08-${String(10 + index).padStart(2, '0')}T00:00:00.000Z`),
  }));
}

describe('buildStockPreferenceProfile', () => {
  it('returns a disabled state without silently continuing to profile the user', () => {
    const result = buildStockPreferenceProfile({
      now: NOW,
      enabled: false,
      manualPreferences: emptyManualStockPreferences(),
      signals: [screeningSignal(['pe_ttm'])],
      watchlist: watchlist(3),
    });

    expect(result.state).toBe('disabled');
    expect(result.facts).toEqual([]);
    expect(result.possibleStrengths).toEqual([]);
    expect(result.blindSpots).toEqual([]);
  });

  it('labels a profile with no post-clear evidence as insufficient instead of guessing', () => {
    const result = buildStockPreferenceProfile({
      now: NOW,
      enabled: true,
      clearedAt: new Date('2026-08-16T00:00:00.000Z'),
      manualPreferences: emptyManualStockPreferences(),
      signals: [screeningSignal(['pe_ttm'], new Date('2026-08-15T00:00:00.000Z'))],
      watchlist: [{ symbol: '600519', market: 'A', createdAt: new Date('2026-08-15T00:00:00Z') }],
    });

    expect(result.state).toBe('empty');
    expect(result.confidence).toMatchObject({ level: 'insufficient', label: '样本不足' });
    expect(result.sample).toEqual({ screeningRuns: 0, watchlistStocks: 0, manualDimensions: 0 });
    expect(result.window.days).toBe(90);
  });

  it('ignores screening evidence outside the 90-day window', () => {
    const result = buildStockPreferenceProfile({
      now: NOW,
      enabled: true,
      manualPreferences: emptyManualStockPreferences(),
      signals: [
        screeningSignal(['pe_ttm'], new Date('2026-05-19T00:00:00.000Z')),
        screeningSignal(['roe'], new Date('2026-08-17T00:00:00.000Z')),
      ],
      watchlist: [],
    });

    expect(result.sample.screeningRuns).toBe(1);
    expect(result.facts.map((item) => item.dimension)).toContain('profitability');
    expect(result.facts.map((item) => item.dimension)).not.toContain('valuation');
  });

  it('combines explicit settings, screening fields, and watchlist structure with high confidence', () => {
    const manual = emptyManualStockPreferences();
    manual.industries = ['半导体', '医药'];
    manual.holdingPeriods = ['中长期'];

    const result = buildStockPreferenceProfile({
      now: NOW,
      enabled: true,
      manualPreferences: manual,
      signals: [
        screeningSignal(['pe_ttm', 'roe']),
        screeningSignal(['net_profit_3y_positive', 'debt_ratio']),
        screeningSignal(['amount', 'insider_reduction_recent']),
      ],
      watchlist: watchlist(5),
    });

    expect(result.state).toBe('ready');
    expect(result.confidence.level).toBe('high');
    expect(result.sample).toEqual({ screeningRuns: 3, watchlistStocks: 5, manualDimensions: 2 });
    expect(result.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ dimension: 'industry', source: 'manual' }),
      expect.objectContaining({ dimension: 'valuation', source: 'screening' }),
      expect.objectContaining({ dimension: 'liquidity', source: 'screening' }),
    ]));
    expect(result.possibleStrengths.length).toBeGreaterThan(0);
    expect(result.blindSpots).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'market-concentration' }),
    ]));
    expect(result.basis.map((item) => item.source)).toEqual(
      expect.arrayContaining(['manual', 'screening', 'watchlist']),
    );
  });

  it('calls out repeated single-factor use without turning it into a suitability claim', () => {
    const result = buildStockPreferenceProfile({
      now: NOW,
      enabled: true,
      manualPreferences: emptyManualStockPreferences(),
      signals: [screeningSignal(['pe_ttm']), screeningSignal(['pb'])],
      watchlist: [],
    });

    expect(result.blindSpots).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'single-factor' }),
    ]));
    expect(result.supplementaryViews.map((item) => item.id)).toEqual(
      expect.arrayContaining(['add-liquidity', 'add-cash-flow', 'clarify-holding-period']),
    );
    expect(JSON.stringify(result)).not.toMatch(/聪明|保守|激进|风险承受|适合|买入|卖出|持有建议|推荐指数|目标价/);
  });

  it('keeps low-volume observations explicitly low confidence', () => {
    const result = buildStockPreferenceProfile({
      now: NOW,
      enabled: true,
      manualPreferences: emptyManualStockPreferences(),
      signals: [],
      watchlist: watchlist(1),
    });

    expect(result.state).toBe('ready');
    expect(result.confidence).toMatchObject({ level: 'low', label: '低置信度' });
  });
});
