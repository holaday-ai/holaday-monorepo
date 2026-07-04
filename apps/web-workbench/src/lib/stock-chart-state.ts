export type StockChartKind = 'daily_close' | 'intraday';

export function stockChartAxisTicks(
  labels: string[],
  kind: StockChartKind,
  left = 0,
  right = 100,
): Array<{ x: number; label: string }> {
  if (kind === 'intraday') {
    const fixedTicks = [
      { x: left, label: '09:30' },
      { x: left + 0.25 * (right - left), label: '10:30' },
      { x: left + 0.5 * (right - left), label: '11:30' },
      { x: left + 0.75 * (right - left), label: '14:00' },
      { x: right, label: '15:00' },
    ];
    const observedRatios = labels
      .map((label) => intradayRatioFromLabel(label))
      .filter((ratio): ratio is number => ratio !== null);
    if (observedRatios.length === 0) return fixedTicks.slice(0, 1);
    const maxObservedRatio = Math.max(...observedRatios);
    const visibleTicks = fixedTicks.filter((tick) => {
      const ratio = intradayRatioFromLabel(tick.label);
      return ratio !== null && ratio <= maxObservedRatio + 0.0001;
    });
    const lastTick = visibleTicks[visibleTicks.length - 1];
    const lastTickRatio = lastTick ? intradayRatioFromLabel(lastTick.label) : null;
    const lastObservedLabel = labels[labels.length - 1];
    const lastObservedText = formatStockDateLabel(lastObservedLabel ?? '');
    const shouldShowLastObserved =
      lastObservedText !== '-' &&
      lastTick?.label !== lastObservedText &&
      (lastTickRatio === null || maxObservedRatio - lastTickRatio > 0.08);
    if (shouldShowLastObserved) {
      visibleTicks.push({
        x: left + maxObservedRatio * (right - left),
        label: lastObservedText,
      });
    }
    return visibleTicks.length > 0 ? visibleTicks : fixedTicks.slice(0, 1);
  }

  if (labels.length === 0) {
    return [
      { x: left, label: '首日' },
      { x: right, label: '末日' },
    ];
  }
  const last = labels.length - 1;
  const indexes = Array.from(new Set([
    0,
    Math.round(last / 2),
    last,
  ])).sort((a, b) => a - b);
  return indexes.map((index) => ({
    x: left + (index / Math.max(1, last)) * (right - left),
    label: formatStockDateLabel(labels[index] ?? ''),
  }));
}

export function intradayRatioFromLabel(value: string): number | null {
  const match = /(\d{1,2}):(\d{2})/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  const total = hour * 60 + minute;
  const morningStart = 9 * 60 + 30;
  const morningEnd = 11 * 60 + 30;
  const afternoonStart = 13 * 60;
  const afternoonEnd = 15 * 60;
  if (total <= morningStart) return 0;
  if (total <= morningEnd) return (total - morningStart) / 240;
  if (total < afternoonStart) return 0.5;
  if (total >= afternoonEnd) return 1;
  return (120 + (total - afternoonStart)) / 240;
}

export function formatStockDateLabel(value: string): string {
  const trimmed = value.trim();
  const timeMatch = /(\d{1,2}):(\d{2})/.exec(trimmed);
  if (timeMatch) return `${timeMatch[1]}:${timeMatch[2]}`;
  const match = /^(\d{4})[-/]?(\d{2})[-/]?(\d{2})$/.exec(trimmed);
  if (!match) return trimmed || '-';
  return `${match[2]}-${match[3]}`;
}

export function stockLabelDatePart(value: string | undefined): string | null {
  const trimmed = String(value ?? '').trim();
  const match = /^(\d{4})[-/]?(\d{2})[-/]?(\d{2})/.exec(trimmed);
  if (!match) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

export function formatStockTradeDateLabel(value: string | null | undefined): string {
  const date = stockLabelDatePart(value ?? undefined);
  if (!date) return '-';
  return `${date.slice(5, 7)}-${date.slice(8, 10)}`;
}

export function formatStockDateTimeLabel(value: string): string {
  const date = formatStockTradeDateLabel(value);
  const time = formatStockDateLabel(value);
  if (date === '-') return time;
  if (time === '-' || time === date) return date;
  return `${date} ${time}`;
}
