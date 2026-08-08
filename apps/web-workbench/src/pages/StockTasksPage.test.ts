import { describe, expect, it } from 'vitest';
import {
  formatStockDateTimeLabel,
  stockChartHoverTooltipKind,
  stockChartAxisTicks,
} from '@/lib/stock-chart-state';

describe('StockTasksPage chart helpers', () => {
  it('does not render future intraday axis labels past the latest real minute', () => {
    const labels = [
      '2026-06-30 09:30:00',
      '2026-06-30 11:30:00',
      '2026-06-30 14:09:00',
    ];

    const ticks = stockChartAxisTicks(labels, 'intraday');

    expect(ticks.map((tick) => tick.label)).toEqual(['09:30', '10:30', '11:30', '14:00']);
  });

  it('keeps the trade date in hover labels for intraday points', () => {
    expect(formatStockDateTimeLabel('2026-06-30 14:09:00')).toBe('06-30 14:09');
  });

  it('shows yesterday close only when the pointer is on its dotted baseline', () => {
    expect(stockChartHoverTooltipKind({ pointerY: 18.4, baselineY: 18 })).toBe('baseline');
    expect(stockChartHoverTooltipKind({ pointerY: 21, baselineY: 18 })).toBe('point');
  });
});
