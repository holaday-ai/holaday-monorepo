import { pageErrorMessage } from '@/lib/page-error-copy';
import { groupStockRiskSignals } from '@/lib/stock-risk-presentation';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import {
  AlertTriangle,
  BellRing,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  ExternalLink,
  Loader2,
  PauseCircle,
  Play,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import * as React from 'react';
import { StockRiskMonitorSheet } from './StockRiskMonitorSheet';

type RiskRadarQueryInput = Parameters<typeof trpc.stocks.riskRadar.query>[0];
export type StockRiskRadarResult = Awaited<ReturnType<typeof trpc.stocks.riskRadar.query>>;
type StockRiskSignal = StockRiskRadarResult['signals'][number];
type StockRiskMonitorView = Awaited<ReturnType<typeof trpc.stocks.riskMonitors.query>>[number];
type StockRiskMonitorListInput = Parameters<typeof trpc.stocks.riskMonitors.query>[0];
type StockRiskMonitorCreateInput = Parameters<typeof trpc.stocks.createRiskMonitor.mutate>[0];

export interface StockRiskRadarApi {
  load(input: RiskRadarQueryInput): Promise<StockRiskRadarResult>;
  loadMonitors?(input: StockRiskMonitorListInput): Promise<StockRiskMonitorView[]>;
  createMonitor?(input: StockRiskMonitorCreateInput): ReturnType<typeof trpc.stocks.createRiskMonitor.mutate>;
  toggleMonitor?(input: { plannedTaskId: string }): ReturnType<typeof trpc.plannedTasks.toggle.mutate>;
  runMonitorNow?(input: { plannedTaskId: string }): ReturnType<typeof trpc.plannedTasks.runNow.mutate>;
  archiveMonitor?(input: { plannedTaskId: string }): ReturnType<typeof trpc.plannedTasks.archive.mutate>;
}

const LIVE_API: StockRiskRadarApi = {
  load: (input) => trpc.stocks.riskRadar.query(input),
  loadMonitors: (input) => trpc.stocks.riskMonitors.query(input),
  createMonitor: (input) => trpc.stocks.createRiskMonitor.mutate(input),
  toggleMonitor: (input) => trpc.plannedTasks.toggle.mutate(input),
  runMonitorNow: (input) => trpc.plannedTasks.runNow.mutate(input),
  archiveMonitor: (input) => trpc.plannedTasks.archive.mutate(input),
};

const SEVERITY_STYLE = {
  高风险: 'border-[#F4B8C5] bg-[#FFF6F8] text-[#B4234D]',
  警示: 'border-[#F1D4A9] bg-[#FFF9EF] text-[#9A5B13]',
  关注: 'border-[#C9D7F2] bg-[#F6F9FF] text-[#315E9A]',
} as const;

const CHECK_LABEL = {
  pledge: '质押',
  goodwill: '商誉',
  forecast: '业绩预告',
  insider: '内部人变动',
  announcements: '公告风险',
} as const;

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

type RiskTrustMode = 'current' | 'delayed' | 'historical' | 'unavailable' | 'unverified';

function canLoadRiskRadar(args: {
  snapshotId: string | null;
  dataAsOf: string | null;
  trustMode: RiskTrustMode;
}): args is {
  snapshotId: string;
  dataAsOf: string;
  trustMode: 'current' | 'delayed' | 'historical';
} {
  return Boolean(
    args.snapshotId &&
      args.dataAsOf &&
      (args.trustMode === 'current' ||
        args.trustMode === 'delayed' ||
        args.trustMode === 'historical'),
  );
}

function compactDate(value: string | null): string {
  if (!value) return '日期待核验';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[2]}/${match[3]}` : value;
}

function formatDateTime(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return DATE_TIME_FORMATTER.format(date);
}

function signalCount(signals: StockRiskSignal[], severity: StockRiskSignal['severity']): number {
  return signals.filter((signal) => signal.severity === severity).length;
}

export function StockRiskRadar({
  snapshotId,
  dataAsOf,
  trustMode,
  api = LIVE_API,
}: {
  snapshotId: string | null;
  dataAsOf: string | null;
  trustMode: RiskTrustMode;
  api?: StockRiskRadarApi;
}): JSX.Element {
  const [result, setResult] = React.useState<StockRiskRadarResult | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [expandedGroupSymbol, setExpandedGroupSymbol] = React.useState<string | null>(null);
  const [expandedSignalId, setExpandedSignalId] = React.useState<string | null>(null);
  const [monitors, setMonitors] = React.useState<Map<string, StockRiskMonitorView>>(new Map());
  const [monitorCapability, setMonitorCapability] = React.useState(false);
  const [selectedMonitorStock, setSelectedMonitorStock] = React.useState<{
    symbol: string;
    name: string;
    trigger: HTMLButtonElement;
  } | null>(null);
  const [monitorPendingSymbol, setMonitorPendingSymbol] = React.useState<string | null>(null);
  const [monitorError, setMonitorError] = React.useState<string | null>(null);
  const requestSequence = React.useRef(0);
  const loadable = canLoadRiskRadar({ snapshotId, dataAsOf, trustMode });

  const load = React.useCallback(async (resetExpansion = false) => {
    const requestTrust = { snapshotId, dataAsOf, trustMode };
    const request = requestSequence.current + 1;
    requestSequence.current = request;
    if (resetExpansion) {
      setExpandedGroupSymbol(null);
      setExpandedSignalId(null);
    }
    setMonitorCapability(false);
    setMonitors(new Map());
    setError(null);
    setResult((current) =>
      canLoadRiskRadar(requestTrust) &&
      current?.snapshotId === requestTrust.snapshotId &&
      current.dataAsOf === requestTrust.dataAsOf
        ? current
        : null,
    );
    if (!canLoadRiskRadar(requestTrust)) {
      setExpandedGroupSymbol(null);
      setExpandedSignalId(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const next = await api.load(requestTrust);
      if (
        requestSequence.current === request &&
        next.snapshotId === snapshotId &&
        next.dataAsOf === dataAsOf
      ) {
        setResult(next);
        setExpandedGroupSymbol((current) =>
          current && next.signals.some((signal) => signal.symbol === current) ? current : null,
        );
        setExpandedSignalId((current) =>
          current && next.signals.some((signal) => signal.signalId === current) ? current : null,
        );
        if (api.loadMonitors) {
          void api.loadMonitors(requestTrust).then((rows) => {
            if (requestSequence.current !== request) return;
            setMonitors(new Map(rows.map((row) => [row.symbol, row])));
            setMonitorCapability(true);
          }).catch(() => {
            if (requestSequence.current !== request) return;
            setMonitors(new Map());
            setMonitorCapability(false);
          });
        }
      }
    } catch (caught) {
      if (requestSequence.current === request) setError(pageErrorMessage(caught));
    } finally {
      if (requestSequence.current === request) setLoading(false);
    }
  }, [api, dataAsOf, snapshotId, trustMode]);

  React.useEffect(() => {
    void load(false);
    return () => {
      requestSequence.current += 1;
    };
  }, [load]);

  const unavailableChecks = result?.checks.filter((check) => check.status === 'unavailable') ?? [];

  const replaceMonitor = React.useCallback((monitor: StockRiskMonitorView) => {
    setMonitors((current) => {
      const next = new Map(current);
      next.set(monitor.symbol, monitor);
      return next;
    });
  }, []);

  const createMonitor = React.useCallback(async () => {
    if (
      !selectedMonitorStock
      || !api.createMonitor
      || !snapshotId
      || !dataAsOf
      || trustMode !== 'current'
    ) return;
    setMonitorPendingSymbol(selectedMonitorStock.symbol);
    setMonitorError(null);
    try {
      const response = await api.createMonitor({
        snapshotId,
        dataAsOf,
        trustMode: 'current',
        symbol: selectedMonitorStock.symbol,
      });
      replaceMonitor(response.monitor);
      setSelectedMonitorStock(null);
    } catch (caught) {
      setMonitorError(pageErrorMessage(caught));
    } finally {
      setMonitorPendingSymbol(null);
    }
  }, [api, dataAsOf, replaceMonitor, selectedMonitorStock, snapshotId, trustMode]);

  const toggleMonitor = React.useCallback(async (monitor: StockRiskMonitorView) => {
    if (!api.toggleMonitor) return;
    setMonitorPendingSymbol(monitor.symbol);
    try {
      const response = await api.toggleMonitor({ plannedTaskId: monitor.plannedTaskId });
      replaceMonitor({ ...monitor, status: response.status === 'paused' ? 'paused' : 'active' });
    } finally {
      setMonitorPendingSymbol(null);
    }
  }, [api, replaceMonitor]);

  const runMonitorNow = React.useCallback(async (monitor: StockRiskMonitorView) => {
    if (!api.runMonitorNow) return;
    setMonitorPendingSymbol(monitor.symbol);
    try {
      await api.runMonitorNow({ plannedTaskId: monitor.plannedTaskId });
    } finally {
      setMonitorPendingSymbol(null);
    }
  }, [api]);

  return (
    <section className="overflow-hidden rounded-[8px] border border-[#E1E3E8] bg-white shadow-[0_8px_24px_rgba(18,24,38,0.035)]">
      <header className="flex flex-col gap-3 border-b border-[#ECEEF2] px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] bg-[#FFF1F4] text-[#C72654]">
              <ShieldAlert className="h-4 w-4" aria-hidden />
            </span>
            <div>
              <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-[#121826]">
                自选股风险雷达
              </h2>
              <p className="mt-0.5 text-[11px] text-[#8B92A1]">
                规则检查 · 数据日期 {compactDate(dataAsOf)}
              </p>
            </div>
          </div>
          <p className="mt-2 max-w-[720px] text-[12px] leading-5 text-[#667085]">
            只展示已核验事实、触发阈值和来源状态；数据缺失会明确标为无法判断。
          </p>
        </div>
        <button
          type="button"
          aria-label="刷新风险雷达"
          title="刷新风险雷达"
          disabled={!loadable || loading}
          onClick={() => void load(true)}
          className="inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-[8px] border border-[#DADDE4] bg-white px-3 text-[12px] font-medium text-[#4F5868] transition hover:border-[#EA1F59]/30 hover:bg-[#FFF7F9] hover:text-[#C72654] disabled:cursor-not-allowed disabled:opacity-50 sm:h-9"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          )}
          {loading ? '检查中' : '刷新'}
        </button>
      </header>

      <div className="px-4 py-4 sm:px-5">
        {error && result ? (
          <div
            className="mb-3 rounded-[8px] border border-[#F1D4A9] bg-[#FFF9EF] px-3 py-2.5 text-[11px] leading-5 text-[#8A5314]"
            role="status"
          >
            {`本次刷新未完成，继续展示数据日期 ${compactDate(result.dataAsOf)} 的已核验结果。`}
          </div>
        ) : null}
        {!loadable ? (
          <div className="rounded-[8px] border border-dashed border-[#DADDE4] bg-[#FCFCFD] px-4 py-8 text-center">
            <div className="text-[13px] font-semibold text-[#344054]">可信快照恢复后再检查风险</div>
            <p className="mt-1 text-[12px] text-[#8B92A1]">旧数值不会作为当前风险依据继续展示。</p>
          </div>
        ) : loading && !result ? (
          <div
            className="grid gap-3 md:grid-cols-3"
            aria-label="正在检查风险来源"
            aria-busy="true"
            aria-live="polite"
            role="status"
          >
            {[0, 1, 2].map((item) => (
              <div
                key={item}
                className="h-28 animate-pulse rounded-[8px] bg-[#F5F6F8] motion-reduce:animate-none"
              />
            ))}
          </div>
        ) : error && !result ? (
          <div className="rounded-[8px] border border-[#F1D4A9] bg-[#FFF9EF] px-4 py-4 text-[12px] text-[#8A5314]">
            <div className="font-semibold">本次风险检查未完成</div>
            <div className="mt-1">{error}</div>
          </div>
        ) : result ? (
          result.requestedStockCount === 0 ? (
            <div className="rounded-[8px] border border-dashed border-[#DADDE4] bg-[#FCFCFD] px-4 py-8 text-center">
              <div className="text-[13px] font-semibold text-[#344054]">
                暂无可检查的 A 股自选股
              </div>
              <p className="mt-1 text-[12px] text-[#8B92A1]">
                风险雷达当前仅覆盖六位代码的 A 股自选项。
              </p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <SummaryChip
                  label="高风险"
                  count={signalCount(result.signals, '高风险')}
                  tone="high"
                />
                <SummaryChip
                  label="警示"
                  count={signalCount(result.signals, '警示')}
                  tone="warning"
                />
                <SummaryChip
                  label="关注"
                  count={signalCount(result.signals, '关注')}
                  tone="attention"
                />
                <span className="ml-auto text-[#8B92A1]">
                  A股检查 {result.checkedStockCount}/{result.requestedStockCount} 只
                  {result.truncated
                    ? ` · 其余 ${result.requestedStockCount - result.checkedStockCount} 只未纳入本轮`
                    : ''}
                </span>
              </div>

              {result.signals.length === 0 ? (
                <div className="mt-4 rounded-[8px] border border-[#DDE5F3] bg-[#F8FAFD] px-4 py-6 text-center">
                  <div className="text-[13px] font-semibold text-[#344054]">本轮规则未触发</div>
                  <p className="mt-1 text-[12px] text-[#667085]">
                    这只代表当前规则没有命中，仍需结合数据覆盖和后续披露复核。
                  </p>
                </div>
              ) : (
                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  {groupStockRiskSignals(result.signals).map((group) => {
                    const groupExpanded = expandedGroupSymbol === group.symbol;
                    const visibleSignals = groupExpanded
                      ? group.signals
                      : group.signals.slice(0, 2);
                    const monitor = monitors.get(group.symbol) ?? null;
                    return (
                      <article
                        key={group.symbol}
                        data-testid="risk-stock-group"
                        className="overflow-hidden rounded-[8px] border border-[#E4E6EB] bg-[#FCFCFD]"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#E8EAF0] px-4 py-3.5">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="truncate text-[14px] font-semibold text-[#121826]">
                                {group.name}
                              </span>
                              <span className="font-mono text-[11px] text-[#8B92A1]">
                                {group.symbol}
                              </span>
                              <span
                                data-testid="risk-severity"
                                className={cn(
                                  'inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold',
                                  SEVERITY_STYLE[group.severity],
                                )}
                              >
                                {group.severity}
                              </span>
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] font-medium text-[#667085]">
                              <span>{group.signals.length} 条事项</span>
                              <span aria-hidden>·</span>
                              <span>最新事实 {compactDate(group.latestSourceDataAsOf)}</span>
                            </div>
                          </div>
                          <div className="flex min-w-0 shrink-0 flex-col items-end gap-1.5 max-[390px]:w-full max-[390px]:items-start">
                            <AlertTriangle className="h-4 w-4 text-[#C98228]" aria-hidden />
                            {monitorCapability ? (
                              <MonitorControl
                                name={group.name}
                                monitor={monitor}
                                canCreate={trustMode === 'current' && Boolean(api.createMonitor)}
                                pending={monitorPendingSymbol === group.symbol}
                                onCreate={(trigger) => {
                                  setMonitorError(null);
                                  setSelectedMonitorStock({
                                    symbol: group.symbol,
                                    name: group.name,
                                    trigger,
                                  });
                                }}
                                onToggle={() => monitor && void toggleMonitor(monitor)}
                                onRunNow={() => monitor && void runMonitorNow(monitor)}
                              />
                            ) : null}
                          </div>
                        </div>
                        <div className="divide-y divide-[#E8EAF0] px-4">
                          {visibleSignals.map((signal) => {
                            const evidenceExpanded = expandedSignalId === signal.signalId;
                            return (
                              <div
                                key={signal.signalId}
                                data-testid="risk-signal"
                                className="py-3.5"
                              >
                                <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium text-[#667085]">
                                  <span>{signal.label}</span>
                                  <span aria-hidden>·</span>
                                  <span>事实日期 {compactDate(signal.sourceDataAsOf)}</span>
                                  {signal.severity !== group.severity ? (
                                    <span
                                      className={cn(
                                        'inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold',
                                        SEVERITY_STYLE[signal.severity],
                                      )}
                                    >
                                      {signal.severity}
                                    </span>
                                  ) : null}
                                </div>
                                <p className="mt-2 text-[12px] leading-5 text-[#344054]">
                                  {signal.fact}
                                </p>
                                <p className="mt-1.5 text-[11px] leading-[18px] text-[#667085]">
                                  为什么相关：{signal.whyRelevant}
                                </p>
                                <button
                                  type="button"
                                  aria-expanded={evidenceExpanded}
                                  onClick={() =>
                                    setExpandedSignalId(evidenceExpanded ? null : signal.signalId)
                                  }
                                  className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-[#6B4AA0] hover:text-[#54377F]"
                                >
                                  {evidenceExpanded ? '收起依据' : '查看依据'}
                                  {evidenceExpanded ? (
                                    <ChevronUp className="h-3.5 w-3.5" aria-hidden />
                                  ) : (
                                    <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                                  )}
                                </button>
                                {evidenceExpanded ? (
                                  <div className="mt-3 space-y-1 rounded-[7px] border border-[#E4E1EC] bg-white px-3 py-3 text-[11px] leading-[18px] text-[#667085]">
                                    <div>规则：{signal.trigger}</div>
                                    <div>来源：{signal.source}</div>
                                    <div>抓取时间：{formatDateTime(signal.fetchedAt)}</div>
                                    <div className="break-all">证据编号：{signal.evidenceId}</div>
                                    {signal.evidenceUrl ? (
                                      <a
                                        href={signal.evidenceUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="inline-flex items-center gap-1 font-semibold text-[#6B4AA0] hover:text-[#54377F]"
                                      >
                                        查看来源
                                        <ExternalLink className="h-3 w-3" aria-hidden />
                                      </a>
                                    ) : null}
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                        {group.signals.length > 2 ? (
                          <div className="border-t border-[#E8EAF0] px-4 py-2.5">
                            <button
                              type="button"
                              aria-expanded={groupExpanded}
                              onClick={() =>
                                setExpandedGroupSymbol(groupExpanded ? null : group.symbol)
                              }
                              className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#6B4AA0] hover:text-[#54377F]"
                            >
                              {groupExpanded
                                ? '收起其他事项'
                                : `查看全部 ${group.signals.length} 条`}
                              {groupExpanded ? (
                                <ChevronUp className="h-3.5 w-3.5" aria-hidden />
                              ) : (
                                <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                              )}
                            </button>
                          </div>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              )}

              {unavailableChecks.length > 0 ? (
                <div className="mt-4 rounded-[8px] border border-[#E6E3EC] bg-[#FAF9FC] px-4 py-3">
                  <div className="text-[12px] font-semibold text-[#4F465C]">
                    这些项目暂时无法判断
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {unavailableChecks.map((check) => (
                      <span
                        key={`${check.symbol}-${check.key}`}
                        className="rounded-full border border-[#DED9E6] bg-white px-2.5 py-1 text-[10px] text-[#6F657C]"
                      >
                        {check.name} · {CHECK_LABEL[check.key]}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          )
        ) : null}
      </div>

      <footer className="border-t border-[#ECEEF2] bg-[#FCFCFD] px-4 py-3 text-[10px] leading-4 text-[#8B92A1] sm:px-5">
        风险雷达只展示已核验事实与规则触发结果；未触发不等于没有风险，也不构成投资建议。
      </footer>
      <StockRiskMonitorSheet
        open={selectedMonitorStock !== null}
        stock={selectedMonitorStock}
        dataAsOf={dataAsOf}
        pending={selectedMonitorStock?.symbol === monitorPendingSymbol}
        error={monitorError}
        restoreFocus={selectedMonitorStock?.trigger}
        onOpenChange={(open) => {
          if (!open && monitorPendingSymbol === null) {
            setSelectedMonitorStock(null);
            setMonitorError(null);
          }
        }}
        onConfirm={createMonitor}
      />
    </section>
  );
}

function MonitorControl({
  name,
  monitor,
  canCreate,
  pending,
  onCreate,
  onToggle,
  onRunNow,
}: {
  name: string;
  monitor: StockRiskMonitorView | null;
  canCreate: boolean;
  pending: boolean;
  onCreate(trigger: HTMLButtonElement): void;
  onToggle(): void;
  onRunNow(): void;
}): JSX.Element {
  if (!monitor) {
    if (!canCreate) return <></>;
    return (
      <button
        type="button"
        aria-label={`持续监控${name}`}
        title={`持续监控${name}`}
        onClick={(event) => onCreate(event.currentTarget)}
        className="inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-[#D8D0E6] bg-white px-3 text-[11px] font-semibold text-[#6B4AA0] hover:border-[#BFAFD5] hover:bg-[#FBF9FD] max-[390px]:h-11"
      >
        <BellRing className="h-3.5 w-3.5" aria-hidden />
        持续监控
      </button>
    );
  }
  const recordHref = `/planned?plan=${encodeURIComponent(monitor.plannedTaskId)}`;
  const label = monitor.status === 'paused' ? '已暂停' : monitor.status === 'failed' ? '需要处理' : '监控中';
  const Icon = monitor.status === 'paused' ? PauseCircle : monitor.status === 'failed' ? CircleAlert : BellRing;
  return (
    <div className="flex max-w-[240px] flex-col items-end gap-1 text-right max-[390px]:max-w-none max-[390px]:items-start max-[390px]:text-left">
      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#4F5868]">
        <Icon className={cn('h-3.5 w-3.5', monitor.status === 'failed' ? 'text-[#C72654]' : 'text-[#6B4AA0]')} aria-hidden />
        {label}
      </span>
      {monitor.nextRunAt && monitor.status === 'active' ? (
        <span className="text-[10px] text-[#8B92A1]">下次 {formatDateTime(monitor.nextRunAt)}</span>
      ) : null}
      {monitor.lastSummary ? (
        <span className="line-clamp-1 max-w-full text-[10px] text-[#8B92A1]">{monitor.lastSummary}</span>
      ) : null}
      <div className="flex flex-wrap justify-end gap-x-2 gap-y-1 max-[390px]:justify-start">
        {monitor.status === 'paused' ? (
          <button
            type="button"
            disabled={pending}
            aria-label={`恢复${name}监控`}
            title={`恢复${name}监控`}
            onClick={onToggle}
            className="inline-flex min-h-8 items-center gap-1 text-[10px] font-semibold text-[#6B4AA0] disabled:opacity-50 max-[390px]:min-h-11"
          >
            <Play className="h-3 w-3" aria-hidden />恢复
          </button>
        ) : null}
        {monitor.status === 'failed' ? (
          <button
            type="button"
            disabled={pending}
            aria-label={`立即重试${name}监控`}
            title={`立即重试${name}监控`}
            onClick={onRunNow}
            className="inline-flex min-h-8 items-center gap-1 text-[10px] font-semibold text-[#C72654] disabled:opacity-50 max-[390px]:min-h-11"
          >
            <RefreshCw className={cn('h-3 w-3', pending && 'animate-spin motion-reduce:animate-none')} aria-hidden />重试
          </button>
        ) : null}
        <a
          href={recordHref}
          aria-label={`查看${name}监控记录`}
          className="inline-flex min-h-8 items-center text-[10px] font-semibold text-[#6B4AA0] max-[390px]:min-h-11 max-[390px]:items-center"
        >
          查看记录
        </a>
      </div>
    </div>
  );
}

function SummaryChip({
  label,
  count,
  tone,
}: {
  label: string;
  count: number;
  tone: 'high' | 'warning' | 'attention';
}): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 font-medium',
        tone === 'high' && 'border-[#F4B8C5] bg-[#FFF6F8] text-[#B4234D]',
        tone === 'warning' && 'border-[#F1D4A9] bg-[#FFF9EF] text-[#9A5B13]',
        tone === 'attention' && 'border-[#C9D7F2] bg-[#F6F9FF] text-[#315E9A]',
      )}
    >
      {label} {count}
    </span>
  );
}
