export type StockRiskSeverity = '高风险' | '警示' | '关注';

export interface GroupableStockRiskSignal {
  signalId: string;
  symbol: string;
  name: string;
  severity: StockRiskSeverity;
  sourceDataAsOf: string | null;
}

export interface StockRiskSignalGroup<T extends GroupableStockRiskSignal> {
  symbol: string;
  name: string;
  severity: StockRiskSeverity;
  latestSourceDataAsOf: string | null;
  signals: T[];
}

const SEVERITY_RANK: Record<StockRiskSeverity, number> = {
  高风险: 0,
  警示: 1,
  关注: 2,
};

function compareDatesDescending(left: string | null, right: string | null): number {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return right.localeCompare(left);
}

function compareSignals<T extends GroupableStockRiskSignal>(left: T, right: T): number {
  return (
    SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity] ||
    compareDatesDescending(left.sourceDataAsOf, right.sourceDataAsOf) ||
    left.signalId.localeCompare(right.signalId)
  );
}

export function groupStockRiskSignals<T extends GroupableStockRiskSignal>(
  signals: readonly T[],
): StockRiskSignalGroup<T>[] {
  const grouped = new Map<string, T[]>();

  for (const signal of signals) {
    const group = grouped.get(signal.symbol);
    if (group) group.push(signal);
    else grouped.set(signal.symbol, [signal]);
  }

  return Array.from(grouped.entries(), ([symbol, stockSignals]) => {
    const orderedSignals = [...stockSignals].sort(compareSignals);
    const leadingSignal = orderedSignals[0];
    if (!leadingSignal) throw new Error(`Risk signal group ${symbol} is unexpectedly empty`);

    return {
      symbol,
      name: leadingSignal.name,
      severity: leadingSignal.severity,
      latestSourceDataAsOf: orderedSignals.reduce<string | null>((latest, signal) => {
        if (!signal.sourceDataAsOf) return latest;
        if (!latest || signal.sourceDataAsOf > latest) return signal.sourceDataAsOf;
        return latest;
      }, null),
      signals: orderedSignals,
    };
  }).sort(
    (left, right) =>
      SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity] ||
      compareDatesDescending(left.latestSourceDataAsOf, right.latestSourceDataAsOf) ||
      left.symbol.localeCompare(right.symbol),
  );
}
