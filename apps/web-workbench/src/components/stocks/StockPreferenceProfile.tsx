import {
  BrainCircuit,
  Check,
  ClipboardList,
  Eye,
  Gauge,
  Lightbulb,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  SlidersHorizontal,
  Telescope,
  TriangleAlert,
} from 'lucide-react';
import * as React from 'react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';

export type StockPreferenceProfileResult = Awaited<
  ReturnType<typeof trpc.stocks.preferenceProfile.query>
>;
type UpdateInput = Parameters<typeof trpc.stocks.updatePreferenceProfile.mutate>[0];
type ManualPreferences = UpdateInput['manualPreferences'];
type PreferenceKey = keyof ManualPreferences;

export interface StockPreferenceProfileApi {
  load(): Promise<StockPreferenceProfileResult>;
  update(input: UpdateInput): Promise<StockPreferenceProfileResult>;
  clear(): Promise<StockPreferenceProfileResult>;
}

const LIVE_PROFILE_API: StockPreferenceProfileApi = {
  load: () => trpc.stocks.preferenceProfile.query(),
  update: (input) => trpc.stocks.updatePreferenceProfile.mutate(input),
  clear: () => trpc.stocks.clearPreferenceProfile.mutate(),
};

const PREFERENCE_OPTIONS: ReadonlyArray<{
  key: PreferenceKey;
  label: string;
  options: readonly string[];
}> = [
  { key: 'industries', label: '关注行业', options: ['半导体', '科技', '医药', '消费', '金融', '新能源', '先进制造', '周期资源'] },
  { key: 'marketCaps', label: '市值范围', options: ['大盘', '中盘', '小盘'] },
  { key: 'valuation', label: '估值关注', options: ['低估值', '均衡估值', '可接受成长溢价'] },
  { key: 'profitability', label: '盈利质量', options: ['连续盈利', '高ROE', '低负债'] },
  { key: 'growth', label: '成长指标', options: ['收入增长', '利润增长', '稳定增长'] },
  { key: 'cashFlow', label: '现金流', options: ['经营现金流优先', '自由现金流优先'] },
  { key: 'volatility', label: '波动关注', options: ['低波动', '均衡波动', '关注高波动'] },
  { key: 'liquidity', label: '流动性', options: ['高流动性', '普通流动性'] },
  { key: 'events', label: '事件关注', options: ['回避ST', '回避近期减持', '关注重要公告'] },
  { key: 'holdingPeriods', label: '研究周期', options: ['短期观察', '波段研究', '中长期'] },
];

function copyManualPreferences(value: ManualPreferences): ManualPreferences {
  return Object.fromEntries(
    Object.entries(value).map(([key, values]) => [key, [...values]]),
  ) as ManualPreferences;
}

export function StockPreferenceProfile({
  refreshKey = 0,
  api = LIVE_PROFILE_API,
}: {
  refreshKey?: number;
  api?: StockPreferenceProfileApi;
}): JSX.Element {
  const [profile, setProfile] = React.useState<StockPreferenceProfileResult | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(false);
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [confirmClear, setConfirmClear] = React.useState(false);
  const [draft, setDraft] = React.useState<ManualPreferences | null>(null);
  const requestVersion = React.useRef(0);

  const load = React.useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    setError(false);
    try {
      const next = await api.load();
      if (version === requestVersion.current) setProfile(next);
    } catch {
      if (version === requestVersion.current) setError(true);
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [api]);

  React.useEffect(() => {
    void load();
    const settleTimer = refreshKey > 0
      ? window.setTimeout(() => void load(), 1_200)
      : null;
    return () => {
      if (settleTimer !== null) window.clearTimeout(settleTimer);
      requestVersion.current += 1;
    };
  }, [load, refreshKey]);

  const openEditor = React.useCallback(() => {
    if (!profile) return;
    setDraft(copyManualPreferences(profile.manualPreferences));
    setConfirmClear(false);
    setSheetOpen(true);
  }, [profile]);

  const update = React.useCallback(async (
    enabled: boolean,
    manualPreferences: ManualPreferences,
    closeEditor = false,
  ) => {
    if (saving) return;
    requestVersion.current += 1;
    setLoading(false);
    setSaving(true);
    setError(false);
    try {
      const next = await api.update({ enabled, manualPreferences });
      setProfile(next);
      if (closeEditor) setSheetOpen(false);
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }, [api, saving]);

  const clear = React.useCallback(async () => {
    if (saving) return;
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    requestVersion.current += 1;
    setLoading(false);
    setSaving(true);
    setError(false);
    try {
      const next = await api.clear();
      setProfile(next);
      setSheetOpen(false);
      setConfirmClear(false);
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }, [api, confirmClear, saving]);

  return (
    <section className="overflow-hidden rounded-[8px] border border-[#E1E3E8] bg-white shadow-[0_8px_24px_rgba(18,24,38,0.035)]">
      <header className="flex flex-col gap-3 border-b border-[#ECEEF2] px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] bg-[#FFF0F4] text-[#D91952]">
              <BrainCircuit className="h-4 w-4" aria-hidden />
            </span>
            <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-[#121826]">你的选股偏好</h2>
            {profile ? <ConfidenceBadge profile={profile} /> : null}
          </div>
          <p className="mt-2 max-w-[680px] text-[12px] leading-5 text-[#667085]">
            汇总你主动设置、成功筛选和清空后新增关注的可核验迹象，只描述研究习惯，不推断投资者类型或风险承受能力。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            aria-label="刷新选股偏好"
            title="刷新选股偏好"
            className="inline-flex h-9 w-9 items-center justify-center rounded-[7px] border border-[#DDE0E6] bg-white text-[#667085] transition hover:border-[#EA1F59]/30 hover:text-[#D91952] disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} aria-hidden />
          </button>
          {profile?.enabled ? (
            <button
              type="button"
              onClick={() => void update(false, profile.manualPreferences)}
              disabled={saving}
              aria-label="暂停画像"
              title="暂停画像"
              className="inline-flex h-9 w-9 items-center justify-center rounded-[7px] border border-[#DDE0E6] bg-white text-[#667085] transition hover:border-[#EA1F59]/30 hover:text-[#D91952] disabled:opacity-50"
            >
              <Pause className="h-3.5 w-3.5" aria-hidden />
            </button>
          ) : null}
          {profile?.enabled ? (
            <button
              type="button"
              onClick={openEditor}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[7px] border border-[#DDE0E6] bg-white px-3 text-[12px] font-semibold text-[#4F5868] transition hover:border-[#EA1F59]/30 hover:text-[#D91952]"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
              调整画像
            </button>
          ) : null}
        </div>
      </header>

      {loading && !profile ? <LoadingState /> : null}
      {!loading && error && !profile ? <ErrorState onRetry={() => void load()} /> : null}
      {profile?.state === 'disabled' ? (
        <DisabledState
          saving={saving}
          onEnable={() => void update(true, profile.manualPreferences)}
        />
      ) : null}
      {profile?.state === 'empty' ? <EmptyState onEdit={openEditor} /> : null}
      {profile?.state === 'ready' ? <ReadyProfile profile={profile} /> : null}

      {error && profile ? (
        <div className="border-t border-[#F0D4DC] bg-[#FFF5F7] px-4 py-2.5 text-[11px] text-[#B4234D] sm:px-5">
          本次操作没有完成，请重试；已有画像保持不变。
        </div>
      ) : null}

      <footer className="flex items-start gap-2 border-t border-[#ECEEF2] bg-[#FCFCFD] px-4 py-3 text-[10px] leading-4 text-[#7A8290] sm:px-5">
        <Eye className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        画像不会改变筛选条件，也不会触发交易；它只帮助你看见自己的研究重点和可能遗漏的维度。
      </footer>

      <PreferenceEditor
        open={sheetOpen}
        profile={profile}
        draft={draft}
        saving={saving}
        confirmClear={confirmClear}
        onOpenChange={(open) => {
          setSheetOpen(open);
          if (!open) setConfirmClear(false);
        }}
        onDraftChange={setDraft}
        onSave={() => {
          if (profile && draft) void update(profile.enabled, draft, true);
        }}
        onClear={() => void clear()}
      />
    </section>
  );
}

function LoadingState(): JSX.Element {
  return (
    <div className="flex min-h-[150px] items-center justify-center gap-2 px-5 py-8 text-[12px] text-[#667085]">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      正在整理你的明确偏好…
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }): JSX.Element {
  return (
    <div className="px-5 py-8 text-center">
      <TriangleAlert className="mx-auto h-5 w-5 text-[#B4234D]" aria-hidden />
      <p className="mt-2 text-[13px] font-semibold text-[#303846]">选股偏好暂时无法加载</p>
      <p className="mt-1 text-[11px] text-[#7A8290]">没有使用旧数据代替，请稍后重试。</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 inline-flex h-8 items-center rounded-[7px] border border-[#DDE0E6] px-3 text-[11px] font-semibold text-[#4F5868]"
      >
        重试
      </button>
    </div>
  );
}

function DisabledState({ saving, onEnable }: { saving: boolean; onEnable: () => void }): JSX.Element {
  return (
    <div className="px-5 py-8 text-center">
      <Pause className="mx-auto h-5 w-5 text-[#7A8290]" aria-hidden />
      <p className="mt-2 text-[13px] font-semibold text-[#303846]">选股偏好已暂停</p>
      <p className="mt-1 text-[11px] leading-5 text-[#7A8290]">暂停期间保留你的控制设置，但不展示行为画像。</p>
      <button
        type="button"
        onClick={onEnable}
        disabled={saving}
        className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-[7px] border border-[#EA1F59] px-3 text-[11px] font-semibold text-[#D91952] disabled:opacity-50"
      >
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Play className="h-3.5 w-3.5" aria-hidden />}
        重新开启
      </button>
    </div>
  );
}

function EmptyState({ onEdit }: { onEdit: () => void }): JSX.Element {
  return (
    <div className="px-5 py-8 text-center">
      <Gauge className="mx-auto h-5 w-5 text-[#D28A17]" aria-hidden />
      <p className="mt-2 text-[13px] font-semibold text-[#303846]">样本还不够形成画像</p>
      <p className="mx-auto mt-1 max-w-[520px] text-[11px] leading-5 text-[#7A8290]">
        完成明确条件筛选、添加新的关注股票，或主动设置研究偏好后，画像会逐步形成；小样本不会被包装成确定结论。
      </p>
      <button
        type="button"
        onClick={onEdit}
        className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-[7px] border border-[#EA1F59] px-3 text-[11px] font-semibold text-[#D91952]"
      >
        <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
        主动设置偏好
      </button>
    </div>
  );
}

function ConfidenceBadge({ profile }: { profile: StockPreferenceProfileResult }): JSX.Element {
  const tone = profile.confidence.level === 'high'
    ? 'border-[#BFE8D8] bg-[#F2FBF7] text-[#087A55]'
    : profile.confidence.level === 'medium'
      ? 'border-[#CDE1FA] bg-[#F3F8FE] text-[#346A9A]'
      : 'border-[#F4D9A7] bg-[#FFF9EC] text-[#7A5313]';
  return (
    <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-semibold', tone)}>
      {profile.confidence.label}
    </span>
  );
}

function ReadyProfile({ profile }: { profile: StockPreferenceProfileResult }): JSX.Element {
  return (
    <div className="px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-center gap-2 border-b border-[#ECEEF2] pb-3 text-[10px] text-[#667085]">
        <span className="rounded-[6px] bg-[#F4F5F7] px-2 py-1 font-medium text-[#4F5868]">近 {profile.window.days} 天</span>
        <span>{profile.sample.screeningRuns} 次筛选</span>
        <span aria-hidden>·</span>
        <span>{profile.sample.watchlistStocks} 只关注</span>
        <span aria-hidden>·</span>
        <span>{profile.sample.manualDimensions} 项主动设置</span>
        <span className="basis-full text-[#8B92A1] sm:ml-auto sm:basis-auto">{profile.confidence.basis}</span>
      </div>

      <div className="grid gap-4 py-4 lg:grid-cols-2">
        <ProfileGroup icon={ClipboardList} title="偏好事实" items={profile.facts} tone="neutral" />
        <ProfileGroup icon={Lightbulb} title="可能优势" items={profile.possibleStrengths} tone="positive" />
        <ProfileGroup icon={TriangleAlert} title="潜在盲点" items={profile.blindSpots} tone="warning" />
        <ProfileGroup icon={Telescope} title="补充视角" items={profile.supplementaryViews} tone="info" />
      </div>

      <div className="rounded-[8px] border border-[#E1E3E8] bg-[#FCFCFD] px-3 py-3">
        <h3 className="text-[12px] font-semibold text-[#303846]">依据与控制</h3>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {profile.basis.map((item) => (
            <div key={item.id} className="flex items-start justify-between gap-3 rounded-[7px] bg-white px-3 py-2">
              <span className="min-w-0">
                <span className="block text-[11px] font-medium text-[#4F5868]">{item.title}</span>
                <span className="block text-[10px] text-[#8B92A1]">{item.detail}</span>
              </span>
              <span className="shrink-0 text-[11px] font-semibold tabular-nums text-[#D91952]">{item.count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ProfileGroup({
  icon: Icon,
  title,
  items,
  tone,
}: {
  icon: typeof ClipboardList;
  title: string;
  items: ReadonlyArray<{ id: string; title: string; detail: string }>;
  tone: 'neutral' | 'positive' | 'warning' | 'info';
}): JSX.Element {
  const iconTone = {
    neutral: 'bg-[#F4F5F7] text-[#667085]',
    positive: 'bg-[#F2FBF7] text-[#087A55]',
    warning: 'bg-[#FFF9EC] text-[#9A650E]',
    info: 'bg-[#F3F8FE] text-[#346A9A]',
  }[tone];
  return (
    <section aria-label={title}>
      <h3 className="flex items-center gap-2 text-[12px] font-semibold text-[#303846]">
        <span className={cn('inline-flex h-7 w-7 items-center justify-center rounded-[7px]', iconTone)}>
          <Icon className="h-3.5 w-3.5" aria-hidden />
        </span>
        {title}
      </h3>
      <div className="mt-2 space-y-2">
        {items.map((item) => (
          <div key={item.id} className="rounded-[8px] border border-[#E8EAF0] px-3 py-2.5">
            <p className="text-[11px] font-semibold text-[#4F5868]">{item.title}</p>
            <p className="mt-1 text-[10px] leading-4 text-[#7A8290]">{item.detail}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function PreferenceEditor({
  open,
  profile,
  draft,
  saving,
  confirmClear,
  onOpenChange,
  onDraftChange,
  onSave,
  onClear,
}: {
  open: boolean;
  profile: StockPreferenceProfileResult | null;
  draft: ManualPreferences | null;
  saving: boolean;
  confirmClear: boolean;
  onOpenChange: (open: boolean) => void;
  onDraftChange: (draft: ManualPreferences) => void;
  onSave: () => void;
  onClear: () => void;
}): JSX.Element {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full max-w-[460px] flex-col bg-white p-0 sm:max-w-[460px]">
        <SheetHeader className="border-b border-[#ECEEF3] px-5 py-4 pr-12">
          <SheetTitle className="text-[17px] text-[#121826]">调整选股偏好</SheetTitle>
          <SheetDescription className="text-[12px] leading-5 text-[#667085]">
            这些设置只用于解释画像，不会自动改写筛选条件。
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="space-y-5">
            {draft ? PREFERENCE_OPTIONS.map((group) => (
              <fieldset key={group.key}>
                <legend className="text-[12px] font-semibold text-[#303846]">{group.label}</legend>
                <div className="mt-2 flex flex-wrap gap-2">
                  {group.options.map((option) => {
                    const selected = (draft[group.key] as string[]).includes(option);
                    return (
                      <label
                        key={option}
                        className={cn(
                          'inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-[7px] border px-2.5 py-1.5 text-[11px] transition',
                          selected
                            ? 'border-[#EA1F59]/45 bg-[#FFF0F4] font-semibold text-[#B4234D]'
                            : 'border-[#DDE0E6] bg-white text-[#667085] hover:border-[#EA1F59]/30',
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => {
                            const current = draft[group.key] as string[];
                            const values = selected
                              ? current.filter((value) => value !== option)
                              : [...current, option];
                            onDraftChange({ ...draft, [group.key]: values } as ManualPreferences);
                          }}
                          className="sr-only"
                        />
                        {selected ? <Check className="h-3 w-3" aria-hidden /> : null}
                        {option}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            )) : null}
          </div>

          <div className="mt-6 rounded-[8px] border border-[#F0D4DC] bg-[#FFF8FA] p-3">
            <p className="text-[11px] font-semibold text-[#8F2143]">清空画像依据</p>
            <p className="mt-1 text-[10px] leading-4 text-[#8B5264]">
              不会删除关注股票；已有行为不再参与画像，之后的新筛选和新关注可以重新积累。
            </p>
            {confirmClear ? (
              <div className="mt-2 rounded-[7px] border border-[#EAB8C8] bg-white p-2.5">
                <p className="text-[10px] leading-4 text-[#8F2143]">确认后，主动设置和已记录的筛选依据会被清空。</p>
                <button
                  type="button"
                  onClick={onClear}
                  disabled={saving}
                  className="mt-2 inline-flex h-8 items-center rounded-[7px] bg-[#B4234D] px-3 text-[11px] font-semibold text-white disabled:opacity-50"
                >
                  确认清空画像
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={onClear}
                disabled={saving || !profile}
                className="mt-2 inline-flex h-8 items-center rounded-[7px] border border-[#EAB8C8] bg-white px-3 text-[11px] font-semibold text-[#B4234D] disabled:opacity-50"
              >
                清空画像
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-[#ECEEF3] px-5 py-4 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="h-9 rounded-[7px] border border-[#DDE0E6] px-4 text-[12px] font-semibold text-[#667085] disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving || !draft}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[7px] bg-[#EA1F59] px-4 text-[12px] font-semibold text-white disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
            保存偏好
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
