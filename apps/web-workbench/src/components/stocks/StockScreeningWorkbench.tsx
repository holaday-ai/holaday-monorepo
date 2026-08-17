import {
  Check,
  CircleAlert,
  Database,
  Filter,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
} from 'lucide-react';
import * as React from 'react';
import { pageErrorMessage } from '@/lib/page-error-copy';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import {
  canRunStockScreening,
  criterionStateLabel,
  groupScreeningCandidates,
  isStockScreeningResultCurrent,
  screeningCoverageCopy,
  updateNumericCriterionValue,
  type EditableStockScreenCriterion,
  type StockScreeningTrustMode,
} from './stock-screening-state';

type PreviewResult = Awaited<ReturnType<typeof trpc.stocks.previewScreening.query>>;
type ScreeningResult = Awaited<ReturnType<typeof trpc.stocks.runScreening.mutate>>;
type ScreeningCandidate = ScreeningResult['candidates'][number];
type RunInput = Parameters<typeof trpc.stocks.runScreening.mutate>[0];

export interface StockScreeningWorkbenchApi {
  preview(prompt: string): Promise<PreviewResult>;
  run(input: RunInput): Promise<ScreeningResult>;
}

const LIVE_SCREENING_API: StockScreeningWorkbenchApi = {
  preview: (prompt) => trpc.stocks.previewScreening.query({ prompt }),
  run: (input) => trpc.stocks.runScreening.mutate(input),
};

const EXAMPLES = [
  '排除ST，市盈率低于30，资产负债率低于50%',
  '近三年持续盈利，ROE高于10%，近期无减持',
];

export function StockScreeningWorkbench({
  snapshotId,
  dataAsOf,
  trustMode,
  onAddToWatchlist,
  api = LIVE_SCREENING_API,
}: {
  snapshotId: string | null;
  dataAsOf: string | null;
  trustMode: StockScreeningTrustMode;
  onAddToWatchlist: (symbol: string, name: string) => Promise<void>;
  api?: StockScreeningWorkbenchApi;
}): JSX.Element {
  const [prompt, setPrompt] = React.useState('');
  const [criteria, setCriteria] = React.useState<EditableStockScreenCriterion[]>([]);
  const [unparsedClauses, setUnparsedClauses] = React.useState<string[]>([]);
  const [previewing, setPreviewing] = React.useState(false);
  const [running, setRunning] = React.useState(false);
  const [addingSymbol, setAddingSymbol] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<ScreeningResult | null>(null);
  const currentTrust = { snapshotId, dataAsOf, trustMode };
  const currentTrustRef = React.useRef(currentTrust);
  currentTrustRef.current = currentTrust;

  React.useEffect(() => {
    setResult(null);
    setError(null);
  }, [dataAsOf, snapshotId, trustMode]);

  const readyToRun = canRunStockScreening(criteria, { snapshotId, dataAsOf, trustMode });
  const grouped = result ? groupScreeningCandidates(result) : null;

  const preview = React.useCallback(async () => {
    const trimmed = prompt.trim();
    if (!trimmed || previewing) return;
    setPreviewing(true);
    setError(null);
    setResult(null);
    try {
      const next: PreviewResult = await api.preview(trimmed);
      setCriteria(next.criteria);
      setUnparsedClauses(next.unparsedClauses);
    } catch (caught) {
      setError(pageErrorMessage(caught));
    } finally {
      setPreviewing(false);
    }
  }, [api, previewing, prompt]);

  const run = React.useCallback(async () => {
    if (!readyToRun || !snapshotId || !dataAsOf || running) return;
    setRunning(true);
    setError(null);
    try {
      const input: RunInput = {
        snapshotId,
        dataAsOf,
        criteria: criteria as RunInput['criteria'],
      };
      const nextResult = await api.run(input);
      if (isStockScreeningResultCurrent(nextResult, currentTrustRef.current)) {
        setResult(nextResult);
      }
    } catch (caught) {
      setError(pageErrorMessage(caught));
    } finally {
      setRunning(false);
    }
  }, [api, criteria, dataAsOf, readyToRun, running, snapshotId]);

  const reset = React.useCallback(() => {
    setCriteria([]);
    setUnparsedClauses([]);
    setResult(null);
    setError(null);
  }, []);

  const addCandidate = React.useCallback(async (candidate: ScreeningCandidate) => {
    if (addingSymbol) return;
    setAddingSymbol(candidate.symbol);
    try {
      await onAddToWatchlist(candidate.symbol, candidate.name);
    } catch (caught) {
      setError(pageErrorMessage(caught));
    } finally {
      setAddingSymbol(null);
    }
  }, [addingSymbol, onAddToWatchlist]);

  return (
    <section className="overflow-hidden rounded-[8px] border border-[#E1E3E8] bg-white shadow-[0_8px_24px_rgba(18,24,38,0.035)]">
      <div className="border-b border-[#ECEEF2] px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] bg-[#FFF0F4] text-[#D91952]">
                <Filter className="h-4 w-4" aria-hidden />
              </span>
              <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-[#121826]">
                按你的要求找股票
              </h2>
            </div>
            <p className="mt-2 max-w-[680px] text-[12px] leading-5 text-[#667085]">
              先把描述转换为明确条件，由你确认后查询。数据缺失会单独标出，不会算作符合。
            </p>
          </div>
          <TrustStatus trustMode={trustMode} dataAsOf={dataAsOf} />
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void preview();
          }}
          className="mt-4 flex min-h-[48px] items-center gap-2 rounded-[8px] border border-[#DADDE4] bg-[#FCFCFD] p-1.5 focus-within:border-[#EA1F59]/45 focus-within:ring-2 focus-within:ring-[#EA1F59]/10"
        >
          <Search className="ml-2 h-4 w-4 shrink-0 text-[#98A2B3]" aria-hidden />
          <input
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="例如：排除 ST，市盈率低于 30，近三年持续盈利"
            className="min-w-0 flex-1 bg-transparent px-1 text-[13px] text-[#202939] outline-none placeholder:text-[#98A2B3]"
          />
          <button
            type="submit"
            disabled={!prompt.trim() || previewing}
            className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-[7px] bg-[#EA1F59] px-3 text-[12px] font-semibold text-white transition hover:bg-[#D91952] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {previewing ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
            识别条件
          </button>
        </form>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => setPrompt(example)}
              className="text-left text-[11px] leading-5 text-[#7A8290] transition hover:text-[#D91952]"
            >
              {example}
            </button>
          ))}
        </div>
      </div>

      {criteria.length > 0 ? (
        <div className="border-b border-[#ECEEF2] bg-[#FCFCFD] px-4 py-4 sm:px-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-[13px] font-semibold text-[#202939]">确认筛选条件</h3>
              <p className="mt-0.5 text-[11px] text-[#7A8290]">共 {criteria.length} 项；带输入框的阈值可以修改。</p>
            </div>
            <button
              type="button"
              onClick={reset}
              aria-label="清空筛选条件"
              title="清空筛选条件"
              className="inline-flex h-8 w-8 items-center justify-center rounded-[7px] border border-[#DDE0E6] bg-white text-[#667085] transition hover:border-[#EA1F59]/30 hover:text-[#D91952]"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>

          <div className="mt-3 divide-y divide-[#E8EAF0] rounded-[8px] border border-[#E1E3E8] bg-white px-3">
            {criteria.map((criterion) => (
              <CriterionEditor
                key={criterion.id}
                criterion={criterion}
                onChange={(next) => {
                  setCriteria((current) => current.map((item) => item.id === next.id ? next : item));
                  setResult(null);
                }}
              />
            ))}
          </div>

          {unparsedClauses.length > 0 ? (
            <div className="mt-3 flex gap-2 rounded-[7px] border border-[#F4D9A7] bg-[#FFF9EC] px-3 py-2.5 text-[11px] leading-5 text-[#7A5313]">
              <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>暂未识别：{unparsedClauses.join('；')}。这些描述不会悄悄参与筛选，请改成明确数值条件。</span>
            </div>
          ) : null}

          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[11px] leading-5 text-[#7A8290]">
              {trustMode === 'current'
                ? `将使用 ${dataAsOf ?? '当前'} 的受信行情快照。`
                : '只有当前受信行情可以运行条件筛选。'}
            </p>
            <button
              type="button"
              onClick={() => void run()}
              disabled={!readyToRun || running}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[7px] border border-[#EA1F59] bg-white px-4 text-[12px] font-semibold text-[#D91952] transition hover:bg-[#FFF0F4] disabled:cursor-not-allowed disabled:border-[#DADDE4] disabled:text-[#98A2B3]"
            >
              {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Database className="h-3.5 w-3.5" aria-hidden />}
              {running ? '正在查找…' : '按这些条件查找'}
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="border-b border-[#F0D4DC] bg-[#FFF5F7] px-4 py-3 text-[12px] text-[#B4234D] sm:px-5">
          {error}
        </div>
      ) : null}

      {result && grouped ? (
        <div className="px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="text-[14px] font-semibold text-[#121826]">
                {result.zeroResult ? '没有完整符合全部条件的股票' : `完整符合 ${grouped.exact.length} 只`}
              </h3>
              <p className="mt-1 text-[11px] leading-5 text-[#667085]">
                {result.zeroResult
                  ? '我们保留了原条件，没有自动降低阈值。下方列出缺数据或未满足项，方便你判断下一步。'
                  : screeningCoverageCopy(result.coverage)}
              </p>
              {result.zeroResult ? (
                <p className="mt-0.5 text-[11px] text-[#8B92A1]">{screeningCoverageCopy(result.coverage)}</p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-1.5 text-[10px]">
              <ResultCount label="完整符合" value={grouped.exact.length} tone="matched" />
              <ResultCount label="缺少数据" value={grouped.missing.length} tone="missing" />
              <ResultCount label="未满足" value={grouped.unmet.length} tone="unmet" />
            </div>
          </div>

          {result.candidates.length > 0 ? (
            <div className="mt-4 divide-y divide-[#E8EAF0] border-y border-[#E1E3E8]">
              {result.candidates.map((candidate) => (
                <CandidateRow
                  key={candidate.symbol}
                  candidate={candidate}
                  adding={addingSymbol === candidate.symbol}
                  onAdd={() => void addCandidate(candidate)}
                />
              ))}
            </div>
          ) : (
            <div className="mt-4 rounded-[8px] border border-dashed border-[#DADDE4] bg-[#FCFCFD] px-4 py-8 text-center">
              <p className="text-[13px] font-medium text-[#4F5868]">市场初筛后没有进入深查的股票</p>
              <p className="mt-1 text-[11px] text-[#8B92A1]">原条件保持不变，可以返回上方自行调整。</p>
            </div>
          )}
        </div>
      ) : null}

      <footer className="flex items-center gap-2 border-t border-[#ECEEF2] bg-[#FCFCFD] px-4 py-3 text-[10px] leading-4 text-[#7A8290] sm:px-5">
        <ShieldAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
        条件匹配不等于投资建议；结果仅说明数据是否满足你确认的条件，风险提示也不预测价格。
      </footer>
    </section>
  );
}

function TrustStatus({
  trustMode,
  dataAsOf,
}: {
  trustMode: StockScreeningTrustMode;
  dataAsOf: string | null;
}): JSX.Element {
  const current = trustMode === 'current';
  return (
    <div className={cn(
      'inline-flex w-fit items-center gap-1.5 rounded-[7px] border px-2.5 py-1.5 text-[10px] font-medium',
      current
        ? 'border-[#BFE8D8] bg-[#F2FBF7] text-[#087A55]'
        : 'border-[#E1E3E8] bg-[#F7F7F9] text-[#667085]',
    )}>
      <span className={cn('h-1.5 w-1.5 rounded-full', current ? 'bg-[#12A875]' : 'bg-[#98A2B3]')} />
      {current ? `${dataAsOf ?? '当前'} 可筛选` : '等待当前可信行情'}
    </div>
  );
}

function CriterionEditor({
  criterion,
  onChange,
}: {
  criterion: EditableStockScreenCriterion;
  onChange: (criterion: EditableStockScreenCriterion) => void;
}): JSX.Element {
  const booleanValue = typeof criterion.value === 'boolean';
  const rangeValue = Array.isArray(criterion.value) ? criterion.value : null;
  return (
    <div className="flex min-h-[54px] flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-[12px] font-medium text-[#303846]">
          {criterion.status === 'ready' ? (
            <Check className="h-3.5 w-3.5 shrink-0 text-[#12A875]" aria-hidden />
          ) : (
            <CircleAlert className="h-3.5 w-3.5 shrink-0 text-[#D28A17]" aria-hidden />
          )}
          <span>{criterion.label}</span>
        </div>
        <p className="mt-0.5 pl-5 text-[10px] text-[#8B92A1]">数据字段：{criterion.sourceField}</p>
      </div>
      {booleanValue ? (
        <span className="pl-5 text-[11px] font-medium text-[#4F5868] sm:pl-0">
          {criterion.value ? '是' : '否'}
        </span>
      ) : rangeValue ? (
        <div className="flex items-center gap-1.5 pl-5 sm:pl-0">
          {rangeValue.map((value, index) => (
            <input
              key={`${criterion.id}-${index}`}
              type="number"
              value={value}
              aria-label={`${criterion.label}${index === 0 ? '下限' : '上限'}`}
              onChange={(event) => {
                const next = [...rangeValue] as [number, number];
                next[index] = Number(event.target.value);
                onChange({ ...criterion, value: next });
              }}
              className="h-8 w-20 rounded-[6px] border border-[#DADDE4] bg-white px-2 text-[11px] tabular-nums text-[#303846] outline-none focus:border-[#EA1F59]/45"
            />
          ))}
          <span className="text-[10px] text-[#7A8290]">{criterion.unit}</span>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 pl-5 sm:pl-0">
          <input
            type="number"
            value={typeof criterion.value === 'number' ? criterion.value : ''}
            onChange={(event) => onChange(updateNumericCriterionValue(criterion, event.target.value))}
            placeholder="补充数值"
            aria-label={`设置${criterion.label}阈值`}
            className="h-8 w-28 rounded-[6px] border border-[#DADDE4] bg-white px-2 text-[11px] tabular-nums text-[#303846] outline-none placeholder:text-[#A7ADBA] focus:border-[#EA1F59]/45"
          />
          <span className="text-[10px] text-[#7A8290]">{criterion.unit}</span>
        </div>
      )}
    </div>
  );
}

function ResultCount({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'matched' | 'missing' | 'unmet';
}): JSX.Element {
  return (
    <span className={cn(
      'rounded-[6px] border px-2 py-1',
      tone === 'matched' && 'border-[#BFE8D8] bg-[#F2FBF7] text-[#087A55]',
      tone === 'missing' && 'border-[#F4D9A7] bg-[#FFF9EC] text-[#8A5A12]',
      tone === 'unmet' && 'border-[#E1E3E8] bg-[#F7F7F9] text-[#667085]',
    )}>
      {label} {value}
    </span>
  );
}

function CandidateRow({
  candidate,
  adding,
  onAdd,
}: {
  candidate: ScreeningCandidate;
  adding: boolean;
  onAdd: () => void;
}): JSX.Element {
  const complete = candidate.unmetCriteria.length === 0 && candidate.missingCriteria.length === 0;
  const state = complete ? 'matched' : candidate.unmetCriteria.length > 0 ? 'unmet' : 'missing';
  return (
    <article className="py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h4 className="text-[14px] font-semibold text-[#121826]">{candidate.name}</h4>
            <span className="font-mono text-[11px] text-[#8B92A1]">{candidate.symbol}</span>
            <span className={cn(
              'rounded-[5px] px-1.5 py-0.5 text-[9px] font-semibold',
              state === 'matched' && 'bg-[#EAF8F2] text-[#087A55]',
              state === 'missing' && 'bg-[#FFF4DB] text-[#8A5A12]',
              state === 'unmet' && 'bg-[#F0F1F4] text-[#667085]',
            )}>
              {criterionStateLabel(state)}
            </span>
          </div>
          <p className="mt-1 text-[10px] text-[#8B92A1]">数据截至 {candidate.dataAsOf}</p>
        </div>
        <button
          type="button"
          onClick={onAdd}
          disabled={adding}
          className="inline-flex h-8 w-fit shrink-0 items-center justify-center gap-1 rounded-[7px] border border-[#DADDE4] bg-white px-2.5 text-[11px] font-medium text-[#4F5868] transition hover:border-[#EA1F59]/30 hover:text-[#D91952] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {adding ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <Plus className="h-3 w-3" aria-hidden />}
          加入关注
        </button>
      </div>

      <div className="mt-3 grid gap-2 lg:grid-cols-3">
        <CriterionList tone="matched" title="符合" items={candidate.matchedCriteria} />
        <CriterionList tone="missing" title="缺少数据" items={candidate.missingCriteria} />
        <CriterionList tone="unmet" title="未满足" items={candidate.unmetCriteria} />
      </div>

      {candidate.warnings.length > 0 ? (
        <div className="mt-3 space-y-1.5 rounded-[7px] border border-[#F1D1DB] bg-[#FFF6F8] px-3 py-2.5">
          {candidate.warnings.map((warning) => (
            <div key={warning.key} className="flex gap-2 text-[11px] leading-5 text-[#783044]">
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#D91952]" aria-hidden />
              <span><strong>{warning.severity} · {warning.label}：</strong>{warning.finding}</span>
            </div>
          ))}
        </div>
      ) : null}

      <details className="mt-2 text-[10px] text-[#7A8290]">
        <summary className="w-fit cursor-pointer select-none py-1 transition hover:text-[#D91952]">
          查看 {candidate.evidence.length} 条数据来源
        </summary>
        <ul className="mt-1 grid gap-1 rounded-[7px] bg-[#F7F7F9] px-3 py-2 sm:grid-cols-2">
          {candidate.evidence.map((item) => (
            <li key={item.id} className="min-w-0 truncate" title={`${item.source} · ${item.asOf ?? '日期未知'}`}>
              {item.label} · {item.source} · {item.asOf ?? '日期未知'}
            </li>
          ))}
        </ul>
      </details>
    </article>
  );
}

function CriterionList({
  tone,
  title,
  items,
}: {
  tone: 'matched' | 'missing' | 'unmet';
  title: string;
  items: string[];
}): JSX.Element {
  return (
    <div className={cn(
      'min-h-[68px] rounded-[7px] border px-3 py-2',
      tone === 'matched' && 'border-[#D5ECE3] bg-[#F7FCFA]',
      tone === 'missing' && 'border-[#F2E0BA] bg-[#FFFCF4]',
      tone === 'unmet' && 'border-[#E4E6EB] bg-[#FAFAFB]',
    )}>
      <div className="text-[10px] font-semibold text-[#667085]">{title} · {items.length}</div>
      {items.length > 0 ? (
        <ul className="mt-1 space-y-0.5 text-[10px] leading-4 text-[#4F5868]">
          {items.map((item) => <li key={item}>• {item}</li>)}
        </ul>
      ) : (
        <div className="mt-1 text-[10px] text-[#A0A6B2]">无</div>
      )}
    </div>
  );
}
