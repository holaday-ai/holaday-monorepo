import { createHash } from 'node:crypto';
import type {
  StockRiskCheckKey,
  StockRiskSeverity,
  StockRiskSignalRecord,
  StockRiskSourceCheck,
} from './stock-risk-radar-service.js';

export const STOCK_RISK_CHECK_KEYS = [
  'pledge',
  'goodwill',
  'forecast',
  'insider',
  'announcements',
] as const satisfies readonly StockRiskCheckKey[];

type StockRiskSignalKey = StockRiskSignalRecord['key'];

const SIGNAL_KEY_ORDER: readonly StockRiskSignalKey[] = [
  'pledge',
  'goodwill',
  'forecast',
  'insider',
  'reduction_plan',
  'inquiry',
];

const SEVERITY_RANK: Record<StockRiskSeverity, number> = {
  高风险: 0,
  警示: 1,
  关注: 2,
};

const SOURCE_CHECK_FOR_SIGNAL: Record<StockRiskSignalKey, StockRiskCheckKey> = {
  pledge: 'pledge',
  goodwill: 'goodwill',
  forecast: 'forecast',
  insider: 'insider',
  reduction_plan: 'announcements',
  inquiry: 'announcements',
};

export interface CanonicalStockRiskMonitorSignal {
  symbol: string;
  key: StockRiskSignalKey;
  severity: StockRiskSeverity;
  signalId: string;
  evidenceId: string;
  sourceDataAsOf: string | null;
}

export interface StockRiskChangeItem {
  key: StockRiskSignalKey;
  severity: StockRiskSeverity;
  previousSeverity?: StockRiskSeverity;
  signalId: string;
  evidenceId: string;
  sourceDataAsOf: string | null;
}

export interface StockRiskMonitorStateComparison {
  added: StockRiskChangeItem[];
  upgraded: StockRiskChangeItem[];
  resolved: StockRiskChangeItem[];
  unavailableChecks: StockRiskCheckKey[];
}

export interface StockRiskMonitorRunResultV1 extends StockRiskMonitorStateComparison {
  kind: 'stock-risk-monitor';
  version: 1;
  monitorId: string;
  symbol: string;
  name: string;
  dataAsOf: string | null;
  outcome: 'changed' | 'unavailable' | 'unchanged' | 'skipped' | 'failed';
  summary: string;
}

function signalSort(left: CanonicalStockRiskMonitorSignal, right: CanonicalStockRiskMonitorSignal) {
  return SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity]
    || SIGNAL_KEY_ORDER.indexOf(left.key) - SIGNAL_KEY_ORDER.indexOf(right.key)
    || left.symbol.localeCompare(right.symbol);
}

function changeSort(left: StockRiskChangeItem, right: StockRiskChangeItem) {
  return SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity]
    || SIGNAL_KEY_ORDER.indexOf(left.key) - SIGNAL_KEY_ORDER.indexOf(right.key);
}

function changeItem(
  signal: CanonicalStockRiskMonitorSignal,
  previousSeverity?: StockRiskSeverity,
): StockRiskChangeItem {
  return {
    key: signal.key,
    severity: signal.severity,
    ...(previousSeverity ? { previousSeverity } : {}),
    signalId: signal.signalId,
    evidenceId: signal.evidenceId,
    sourceDataAsOf: signal.sourceDataAsOf,
  };
}

export function canonicalStockRiskMonitorSignals(
  signals: readonly StockRiskSignalRecord[],
): CanonicalStockRiskMonitorSignal[] {
  const byIdentity = new Map<string, CanonicalStockRiskMonitorSignal>();
  for (const signal of signals) {
    const current: CanonicalStockRiskMonitorSignal = {
      symbol: signal.symbol,
      key: signal.key,
      severity: signal.severity,
      signalId: signal.signalId,
      evidenceId: signal.evidenceId,
      sourceDataAsOf: signal.sourceDataAsOf,
    };
    const identity = `${signal.symbol}:${signal.key}`;
    const existing = byIdentity.get(identity);
    if (!existing || signalSort(current, existing) < 0) byIdentity.set(identity, current);
  }
  return [...byIdentity.values()].sort(signalSort);
}

export function compareStockRiskMonitorState(
  previous: readonly CanonicalStockRiskMonitorSignal[],
  current: readonly CanonicalStockRiskMonitorSignal[],
  checks: readonly StockRiskSourceCheck[],
): StockRiskMonitorStateComparison {
  const previousByIdentity = new Map(previous.map((signal) => [`${signal.symbol}:${signal.key}`, signal]));
  const currentByIdentity = new Map(current.map((signal) => [`${signal.symbol}:${signal.key}`, signal]));
  const checkStatus = new Map(checks.map((check) => [check.key, check.status]));

  const added: StockRiskChangeItem[] = [];
  const upgraded: StockRiskChangeItem[] = [];
  const resolved: StockRiskChangeItem[] = [];

  for (const [identity, signal] of currentByIdentity) {
    const before = previousByIdentity.get(identity);
    if (!before) {
      added.push(changeItem(signal));
    } else if (SEVERITY_RANK[signal.severity] < SEVERITY_RANK[before.severity]) {
      upgraded.push(changeItem(signal, before.severity));
    }
  }

  for (const [identity, signal] of previousByIdentity) {
    if (currentByIdentity.has(identity)) continue;
    if (checkStatus.get(SOURCE_CHECK_FOR_SIGNAL[signal.key]) === 'checked') {
      resolved.push(changeItem(signal));
    }
  }

  const unavailableChecks = STOCK_RISK_CHECK_KEYS.filter(
    (key) => checkStatus.get(key) === 'unavailable',
  );
  return {
    added: added.sort(changeSort),
    upgraded: upgraded.sort(changeSort),
    resolved: resolved.sort(changeSort),
    unavailableChecks,
  };
}

export function stockRiskNotificationFingerprint(input: {
  monitorId: string;
  dataAsOf: string | null;
  added: readonly StockRiskChangeItem[];
  upgraded: readonly StockRiskChangeItem[];
  resolved: readonly StockRiskChangeItem[];
  unavailableChecks: readonly StockRiskCheckKey[];
}): string {
  const normalizeChanges = (items: readonly StockRiskChangeItem[]) => [...items]
    .sort(changeSort)
    .map((item) => ({
      key: item.key,
      severity: item.severity,
      previousSeverity: item.previousSeverity ?? null,
      signalId: item.signalId,
      evidenceId: item.evidenceId,
      sourceDataAsOf: item.sourceDataAsOf,
    }));
  const payload = {
    monitorId: input.monitorId,
    dataAsOf: input.dataAsOf,
    added: normalizeChanges(input.added),
    upgraded: normalizeChanges(input.upgraded),
    resolved: normalizeChanges(input.resolved),
    unavailableChecks: STOCK_RISK_CHECK_KEYS.filter((key) => input.unavailableChecks.includes(key)),
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function nextShanghaiPostmarketRun(now: Date): Date {
  if (Number.isNaN(now.getTime())) throw new Error('当前时间无效');
  const shanghai = new Date(now.getTime() + 8 * 60 * 60 * 1_000);
  const cutoff = new Date(Date.UTC(
    shanghai.getUTCFullYear(),
    shanghai.getUTCMonth(),
    shanghai.getUTCDate(),
    8,
    30,
  ));
  if (now.getTime() < cutoff.getTime()) return cutoff;
  cutoff.setUTCDate(cutoff.getUTCDate() + 1);
  return cutoff;
}

export function boundedStockRiskSummary(summary: string): string {
  return summary.trim().slice(0, 500);
}
